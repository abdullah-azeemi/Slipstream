"""
Celery task: ingest a single F1 session.

FastF1 session type strings (use these exactly):
  Conventional weekend: 'Qualifying', 'Race'
  Sprint weekend:       'Qualifying', 'Sprint Qualifying', 'Sprint', 'Race'
"""
from __future__ import annotations
import structlog
from workers.celery_app import app

log = structlog.get_logger()

# Map short names → FastF1 session identifiers
SESSION_MAP = {
    'Q':  'Qualifying',
    'R':  'Race',
    'SQ': 'Sprint Qualifying',
    'S':  'Sprint',
    'FP1': 'Practice 1',
    'FP2': 'Practice 2',
    'FP3': 'Practice 3',
}


@app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=1800,
    name='workers.tasks.ingest.ingest_session',
)
def ingest_session(
    self,
    year:           int,
    gp:             str,
    session_type:   str,        # short code: 'Q', 'R', 'SQ', 'S'
    skip_telemetry: bool = False,
):
    from ingestion.fastf1_client import (
        fetch_session, extract_session_info,
        extract_drivers, extract_laps, extract_telemetry,
    )
    from ingestion.loader import (
        upsert_session, load_drivers, load_laps, load_telemetry,
    )

    # Resolve short code → FastF1 string
    fastf1_session = SESSION_MAP.get(session_type, session_type)

    log.info("task.ingest.start",
             year=year, gp=gp,
             session=session_type, fastf1_name=fastf1_session)

    try:
        session      = fetch_session(year, gp, fastf1_session)
        session_info = extract_session_info(session)
        session_key  = upsert_session(session_info)

        drivers   = extract_drivers(session, session_key)
        load_drivers(drivers)

        laps      = extract_laps(session, session_key)
        lap_count = load_laps(laps, session_key)

        tel_count = 0
        if not skip_telemetry:
            tel       = extract_telemetry(session, session_key, all_drivers=True)
            tel_count = load_telemetry(tel, session_key)

        log.info("task.ingest.done",
                 session_key=session_key,
                 laps=lap_count,
                 telemetry=tel_count)

        return {
            "session_key":   session_key,
            "session_type":  session_type,
            "laps":          lap_count,
            "telemetry":     tel_count,
        }

    except Exception as exc:
        log.warning("task.ingest.retry",
                    year=year, gp=gp,
                    attempt=self.request.retries,
                    error=str(exc))
        raise self.retry(exc=exc)


@app.task(name='workers.tasks.ingest.ingest_weekend')
def ingest_weekend(year: int, gp: str, is_sprint: bool = False):
    """
    Ingest a full race weekend sequentially.

    Conventional: Q → R
    Sprint:       Q → SQ → S → R
    
    Telemetry only loaded for Qualifying.
    After completion, triggers stats computation for the quali session.
    """
    log.info("task.ingest_weekend.start",
             year=year, gp=gp, sprint=is_sprint)

    # (session_type, skip_telemetry)
    if is_sprint:
        sessions = [
            ('Q',  False),   # Qualifying — WITH telemetry
            ('SQ', True),    # Sprint Qualifying
            ('S',  True),    # Sprint
            ('R',  True),    # Race
        ]
    else:
        sessions = [
            ('Q', False),    # Qualifying — WITH telemetry
            ('R', True),     # Race
        ]

    results      = []
    quali_key    = None

    for stype, skip_tel in sessions:
        try:
            result = ingest_session.apply(
                args=(year, gp, stype, skip_tel)
            ).get(timeout=600)   # 10 min max per session
            results.append(result)

            if stype == 'Q':
                quali_key = result.get('session_key')

            log.info("task.ingest_weekend.session_done",
                     session_type=stype,
                     session_key=result.get('session_key'),
                     laps=result.get('laps'))

        except Exception as e:
            log.error("task.ingest_weekend.session_failed",
                      session_type=stype,
                      error=str(e))
            # Continue with remaining sessions — don't abort the weekend

    # Trigger downstream tasks
    if quali_key:
        from workers.tasks.stats import compute_stats
        from workers.tasks.train import retrain_model
        # Chain: compute stats → retrain model
        compute_stats.apply_async(
            args=(quali_key,),
            link=retrain_model.si()
        )
        log.info("task.ingest_weekend.downstream_triggered",
                 quali_key=quali_key)

    log.info("task.ingest_weekend.done",
             year=year, gp=gp,
             sessions_ingested=len(results))

    return {
        "year":    year,
        "gp":      gp,
        "results": results,
    }
