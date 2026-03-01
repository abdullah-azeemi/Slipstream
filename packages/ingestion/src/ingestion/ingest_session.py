"""
Main ingestion script.

Usage:
    uv run python -m ingestion.ingest_session --year 2024 --gp British --session Q

This fetches the specified session from FastF1, validates all data,
and loads it into TimescaleDB.
"""
import argparse
import sys

import structlog

from ingestion.database import check_connection
from ingestion.fastf1_client import (
    extract_drivers,
    extract_laps,
    extract_session_info,
    extract_telemetry,
    fetch_session,
    setup_cache,
)
from ingestion.loader import load_drivers, load_laps, load_telemetry, upsert_session

log = structlog.get_logger()


def ingest(year: int, gp: str, session_type: str, skip_telemetry: bool = False) -> None:
    """
    Full ingestion pipeline for one session.

    Args:
        year: Season year
        gp: GP name e.g. 'British'
        session_type: 'R', 'Q', 'FP1', 'FP2', 'FP3'
        skip_telemetry: Skip telemetry loading (faster, for testing)
    """
    log.info("ingest.starting", year=year, gp=gp, session_type=session_type)

    # 1. Check database is reachable before doing anything
    if not check_connection():
        log.error("ingest.db_unreachable")
        sys.exit(1)

    # 2. Set up FastF1 cache
    setup_cache()

    # 3. Fetch session from FastF1
    session = fetch_session(year, gp, session_type)

    # 4. Extract and upsert session metadata
    session_info = extract_session_info(session)
    session_key  = upsert_session(session_info)

    # 5. Extract and upsert drivers
    driver_rows = extract_drivers(session, session_key)
    load_drivers(driver_rows)

    # 6. Extract and load all laps
    laps_df = extract_laps(session, session_key)
    lap_stats = load_laps(laps_df, session_key)
    log.info("ingest.laps_complete", **lap_stats)

    # 7. Load telemetry per driver
    if not skip_telemetry:
        driver_numbers = session.laps["DriverNumber"].unique()
        tel_total = 0
        for driver_num in driver_numbers:
            tel_df = extract_telemetry(session, session_key, int(driver_num))
            tel_total += load_telemetry(tel_df, session_key, int(driver_num))
        log.info("ingest.telemetry_complete", total_rows=tel_total)

    log.info("ingest.finished",
             year=year,
             gp=gp,
             session_type=session_type,
             session_key=session_key)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest an F1 session into Pitwall")
    parser.add_argument("--year",    type=int, required=True, help="Season year e.g. 2024")
    parser.add_argument("--gp",     type=str, required=True, help="GP name e.g. 'British'")
    parser.add_argument("--session", type=str, default="R",  help="Session type: R, Q, FP1, FP2, FP3")
    parser.add_argument("--skip-telemetry", action="store_true",
                        help="Skip telemetry loading (faster, use for testing)")
    args = parser.parse_args()

    ingest(
        year=args.year,
        gp=args.gp,
        session_type=args.session,
        skip_telemetry=args.skip_telemetry,
    )


if __name__ == "__main__":
    main()
