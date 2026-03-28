"""
Auto-ingest new 2026 race weekend sessions.

Checks the FastF1 event schedule for the current season, finds sessions
that have completed but aren't in our DB yet, and ingests them.

Run manually:
    uv run python -m ingestion.auto_ingest

Run on a schedule (cron example — every hour):
    0 * * * * cd /path/to/pitwall && uv run python -m ingestion.auto_ingest >> logs/auto_ingest.log 2>&1
"""
from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone

import fastf1
import structlog
from sqlalchemy import create_engine, text
from ingestion.config import settings

log = structlog.get_logger()

AUTO_INGEST_LOCK_ID = 48219031

# Sessions to ingest per race weekend — order matters (FP before Q before R)
SESSION_TYPES = [
    ("FP1", False),    # Practice 1 — lap times only, no telemetry
    ("FP2", False),   # Practice 2 — lap times only, no telemetry
    ("FP3", False),   # Practice 3 — lap times only, no telemetry
    ("Q",   True),    # Qualifying — with telemetry for speed traces
    ("R",   False),   # Race — lap times only
]

CURRENT_YEAR = datetime.now().year


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", settings.database_url)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://") and "+psycopg" not in url:
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def get_ingested_sessions(engine) -> set[tuple[int, str, str]]:
    """Return set of (year, gp_name, session_type) already in DB."""
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT year, gp_name, session_type FROM sessions
        """)).fetchall()
    return {(r[0], r[1], r[2]) for r in rows}


def purge_practice_sessions(engine, current_year: int, current_gp: str) -> int:
    """Keep only practice sessions for the current GP and same GP from the previous year."""
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT session_key
            FROM sessions
            WHERE session_type = ANY(:practice_types)
              AND NOT (
                (year = :current_year AND gp_name = :current_gp)
                OR
                (year = :previous_year AND gp_name = :current_gp)
              )
        """), {
            "practice_types": ['FP1', 'FP2', 'FP3'],
            "current_year": current_year,
            "previous_year": current_year - 1,
            "current_gp": current_gp,
        }).scalars().all()

        session_keys = list(rows)
        if not session_keys:
            return 0

        conn.execute(text("DELETE FROM telemetry WHERE session_key = ANY(:session_keys)"), {"session_keys": session_keys})
        conn.execute(text("DELETE FROM lap_telemetry_stats WHERE session_key = ANY(:session_keys)"), {"session_keys": session_keys})
        conn.execute(text("DELETE FROM lap_times WHERE session_key = ANY(:session_keys)"), {"session_keys": session_keys})
        conn.execute(text("DELETE FROM drivers WHERE session_key = ANY(:session_keys)"), {"session_keys": session_keys})
        conn.execute(text("DELETE FROM sessions WHERE session_key = ANY(:session_keys)"), {"session_keys": session_keys})
        conn.commit()
        return len(session_keys)


def get_fastf1_schedule(year: int) -> list[dict]:
    """Fetch the F1 event schedule from FastF1."""
    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        events = []
        for _, event in schedule.iterrows():
            # Skip pre-season testing
            if event.get("EventFormat") == "testing":
                continue
            events.append({
                "round":      int(event["RoundNumber"]),
                "gp_name":    str(event["EventName"]),
                "country":    str(event.get("Country", "")),
                "date_start": event.get("EventDate"),
            })
        return events
    except Exception as e:
        log.error("schedule.fetch_failed", error=str(e))
        return []


def session_has_completed(event: dict, session_type: str) -> bool:
    """
    Check if a session has likely completed based on event date.
    Uses a conservative buffer — only ingest sessions from events
    that ended at least 6 hours ago.
    """
    now = datetime.now(timezone.utc)

    try:
        import fastf1
        year  = CURRENT_YEAR
        event_obj = fastf1.get_event(year, event["round"])

        if session_type in ("FP1", "FP2", "FP3"):
            session_date = event_obj.get_session(session_type).date
        elif session_type in ("Q", "SQ"):
            session_date = event_obj.get_session("Qualifying").date
        elif session_type == "R":
            session_date = event_obj.get_session("Race").date
        else:
            return False

        if session_date is None:
            return False

        # Ensure timezone aware
        if session_date.tzinfo is None:
            from datetime import timezone as tz
            session_date = session_date.replace(tzinfo=tz.utc)

        # Session must have ended at least 6 hours ago
        hours_since = (now - session_date).total_seconds() / 3600
        return hours_since > 6

    except Exception:
        # Fallback: use event date + conservative offset
        event_date = event.get("date_start")
        if event_date is None:
            return False
        try:
            if hasattr(event_date, "tzinfo"):
                if event_date.tzinfo is None:
                    event_date = event_date.replace(tzinfo=timezone.utc)
            days_since = (now - event_date).days
            # Race weekends last ~4 days; if event started >5 days ago, all done
            return days_since > 5
        except Exception:
            return False


def ingest_session(year: int, gp_name: str, session_type: str) -> bool:
    """
    Run the ingest_session script for a single session.
    Returns True if successful.
    """
    # Map session type to FastF1 session name
    session_map = {
        "FP1": "FP1", "FP2": "FP2", "FP3": "FP3",
        "Q":   "Q",   "SQ":  "SQ",
        "R":   "R",   "S":   "Sprint",
    }
    session_name = session_map.get(session_type, session_type)

    # Strip " Grand Prix" suffix for the CLI argument
    gp_short = gp_name.replace(" Grand Prix", "").replace(" ePrix", "")

    log.info("ingest.starting",
             year=year, gp=gp_short, session=session_name)

    try:
        result = subprocess.run(
            [
                "uv", "run", "python", "-m", "ingestion.ingest_session",
                "--year",    str(year),
                "--gp",      gp_short,
                "--session", session_name,
            ],
            capture_output=True,
            text=True,
            timeout=600,   # 10 min max per session
        )

        if result.returncode == 0:
            log.info("ingest.success", year=year, gp=gp_short, session=session_name)
            return True
        else:
            log.error("ingest.failed",
                      year=year, gp=gp_short, session=session_name,
                      stderr=result.stderr[-500:] if result.stderr else "")
            return False

    except subprocess.TimeoutExpired:
        log.error("ingest.timeout", year=year, gp=gp_short, session=session_name)
        return False
    except Exception as e:
        log.error("ingest.error", year=year, gp=gp_short, session=session_name, error=str(e))
        return False


def run_once() -> bool:
    engine = create_engine(_database_url())
    lock_acquired = False

    with engine.connect() as conn:
        lock_acquired = bool(
            conn.execute(
                text("SELECT pg_try_advisory_lock(:lock_id)"),
                {"lock_id": AUTO_INGEST_LOCK_ID},
            ).scalar()
        )

    if not lock_acquired:
        log.info("auto_ingest.skip_locked")
        return False

    ingested = get_ingested_sessions(engine)
    try:
        log.info("auto_ingest.start",
                 year=CURRENT_YEAR,
                 already_ingested=len(ingested))

        schedule = get_fastf1_schedule(CURRENT_YEAR)
        if not schedule:
            log.warning("auto_ingest.no_schedule")
            return False

        new_sessions = 0
        failed       = 0
        latest_gp_ingested: str | None = None

        for event in schedule:
            gp_name = event["gp_name"]

            for session_type, _ in SESSION_TYPES:
                key = (CURRENT_YEAR, gp_name, session_type)

                # Skip if already in DB
                if key in ingested:
                    continue

                # Skip if session hasn't completed yet
                if not session_has_completed(event, session_type):
                    log.info("auto_ingest.not_ready",
                             gp=gp_name, session=session_type)
                    continue

                # Ingest it
                success = ingest_session(CURRENT_YEAR, gp_name, session_type)
                if success:
                    new_sessions += 1
                    ingested.add(key)   # prevent re-attempting in same run
                    latest_gp_ingested = gp_name
                else:
                    failed += 1

        log.info("auto_ingest.done",
                 new_sessions=new_sessions,
                 failed=failed,
                 total_in_db=len(ingested))

        if new_sessions > 0:
            if latest_gp_ingested:
                deleted = purge_practice_sessions(engine, CURRENT_YEAR, latest_gp_ingested)
                log.info("auto_ingest.practice_purged", gp=latest_gp_ingested, deleted=deleted)
            # Retrain ML model if new race weekends were added
            log.info("auto_ingest.retraining_model")
            try:
                subprocess.run(
                    ["uv", "run", "python", "-m", "ml.train"],
                    capture_output=True, text=True, timeout=300,
                )
                log.info("auto_ingest.model_retrained")
            except Exception as e:
                log.warning("auto_ingest.retrain_failed", error=str(e))

        return new_sessions > 0
    finally:
        with engine.connect() as conn:
            conn.execute(
                text("SELECT pg_advisory_unlock(:lock_id)"),
                {"lock_id": AUTO_INGEST_LOCK_ID},
            )


def main():
    run_once()


if __name__ == "__main__":
    main()
