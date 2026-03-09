"""
Celery task: ingest a single F1 session.

Wraps the existing ingestion pipeline as an async task.
Chains to stats computation and optional ML retraining.
"""
from __future__ import annotations
from celery import chain
import structlog
from workers.celery_app import app

log = structlog.get_logger()


@app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=1800,  # retry after 30 min (FastF1 data may not be ready)
    name='workers.tasks.ingest.ingest_session',
)
def ingest_session(
    self,
    year:           int,
    gp:             str,
    session_type:   str,
    skip_telemetry: bool = False,
):
    """
    Ingest a single session and optionally chain downstream tasks.

    Retries up to 3× with 30-minute delay if FastF1 data isn't available yet.
    This handles the common case where the task fires before FastF1 has
    processed the timing data (~2-4 hours after race end).
    """
    from ingestion.fastf1_client import (
        fetch_session, extract_session_info,
        extract_drivers, extract_laps, extract_telemetry,
    )
    from ingestion.loader import (
        upsert_session, load_drivers, load_laps, load_telemetry,
    )

    log.info("task.ingest.start",
             year=year, gp=gp, session=session_type)

    try:
        session      = fetch_session(year, gp, session_type)
        session_info = extract_session_info(session)
        session_key  = upsert_session(session_info)

        drivers = extract_drivers(session, session_key)
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
            "session_key": session_key,
            "laps":        lap_count,
            "telemetry":   tel_count,
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
    Ingest a full race weekend — quali + race (+ sprint sessions if applicable).
    Chains tasks sequentially: Q first, then R.
    Telemetry only loaded for qualifying.
    """
    log.info("task.ingest_weekend.start", year=year, gp=gp, sprint=is_sprint)

    sessions = [
        (year, gp, 'Q',  False),   # qualifying — WITH telemetry
        (year, gp, 'R',  True),    # race — skip telemetry
    ]

    if is_sprint:
        sessions = [
            (year, gp, 'Q',  False),
            (year, gp, 'SQ', True),   # sprint qualifying
            (year, gp, 'S',  True),   # sprint race
            (year, gp, 'R',  True),
        ]

    results = []
    for yr, g, stype, skip_tel in sessions:
        try:
            result = ingest_session.apply(
                args=(yr, g, stype, skip_tel)
            ).get(timeout=300)
            results.append(result)
            log.info("task.ingest_weekend.session_done",
                     session_type=stype, result=result)
        except Exception as e:
            log.error("task.ingest_weekend.session_failed",
                      session_type=stype, error=str(e))

    # After ingestion, compute telemetry stats for qualifying session
    if results:
        quali_key = results[0].get('session_key') if results else None
        if quali_key and not skip_telemetry:
            from workers.tasks.stats import compute_stats
            compute_stats.delay(quali_key)

    return results
