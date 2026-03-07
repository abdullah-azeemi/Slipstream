"""
CLI entry point for ingesting a single F1 session.

Usage:
    uv run python -m ingestion.ingest_session --year 2024 --gp British --session R
    uv run python -m ingestion.ingest_session --year 2023 --gp British --session R
    uv run python -m ingestion.ingest_session --year 2024 --gp British --session Q
"""
import argparse
import structlog
from ingestion.fastf1_client import (
    fetch_session, extract_session_info,
    extract_drivers, extract_laps, extract_telemetry,
)
from ingestion.loader import upsert_session, load_drivers, load_laps

log = structlog.get_logger()


def main():
    parser = argparse.ArgumentParser(description='Ingest an F1 session from FastF1')
    parser.add_argument('--year',          type=int, required=True)
    parser.add_argument('--gp',            type=str, required=True,  help='e.g. British, Monaco')
    parser.add_argument('--session',       type=str, required=True,  help='R, Q, FP1, FP2, FP3')
    parser.add_argument('--skip-telemetry',action='store_true',       help='Skip telemetry (faster)')
    args = parser.parse_args()

    log.info("ingest.start", year=args.year, gp=args.gp, session=args.session)

    session     = fetch_session(args.year, args.gp, args.session)
    session_info= extract_session_info(session)
    session_key = upsert_session(session_info)

    drivers     = extract_drivers(session, session_key)
    load_drivers(drivers)

    laps        = extract_laps(session, session_key)
    lap_count   = load_laps(laps)

    if not args.skip_telemetry:
        from ingestion.loader import load_telemetry
        tel = extract_telemetry(session, session_key)
        load_telemetry(tel)

    log.info("ingest.complete",
             session_key=session_key,
             drivers=len(drivers),
             laps=lap_count)
    print(f"\n✅  Loaded {lap_count} laps for session {session_key} ({args.year} {args.gp} {args.session})")


if __name__ == '__main__':
    main()
