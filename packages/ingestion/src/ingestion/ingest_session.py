import argparse
import structlog
from ingestion.fastf1_client import (
    fetch_session, extract_session_info,
    extract_drivers, extract_laps, extract_telemetry,
)
from ingestion.loader import upsert_session, load_drivers, load_laps, load_telemetry

log = structlog.get_logger()

SESSION_MAP = {
    'Q':   'Qualifying',
    'R':   'Race',
    'SQ':  'Sprint Qualifying',
    'S':   'Sprint',
    'FP1': 'Practice 1',
    'FP2': 'Practice 2',
    'FP3': 'Practice 3',
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--year',           type=int, required=True)
    parser.add_argument('--gp',             type=str, required=True)
    parser.add_argument('--session',        type=str, required=True,
                        help="Q, R, SQ, S, FP1, FP2, FP3")
    parser.add_argument('--skip-telemetry', action='store_true')
    args = parser.parse_args()

    # Resolve short code → FastF1 string
    fastf1_session = SESSION_MAP.get(args.session.upper(), args.session)

    log.info("ingest.start",
             year=args.year, gp=args.gp,
             session=args.session, fastf1_name=fastf1_session)

    session      = fetch_session(args.year, args.gp, fastf1_session)
    session_info = extract_session_info(session)
    session_key  = upsert_session(session_info)

    drivers   = extract_drivers(session, session_key)
    load_drivers(drivers)

    laps      = extract_laps(session, session_key)
    lap_count = load_laps(laps, session_key)

    tel_count = 0
    if not args.skip_telemetry:
        tel       = extract_telemetry(session, session_key, all_drivers=True)
        tel_count = load_telemetry(tel, session_key)

    print(f"\n✅  session={session_key}  drivers={len(drivers)}"
          f"  laps={lap_count}  telemetry={tel_count}")


if __name__ == '__main__':
    main()
