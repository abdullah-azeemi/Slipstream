"""
FastF1 client — fetches and normalises session data.
"""

from __future__ import annotations
import warnings
import fastf1
import pandas as pd
import structlog

warnings.filterwarnings("ignore")
log = structlog.get_logger()


def fetch_session(year: int, gp: str, session_type: str) -> fastf1.core.Session:
    fastf1.Cache.enable_cache("./fastf1_cache")
    session = fastf1.get_session(year, gp, session_type)
    load_weather = True
    session.load(telemetry=True, weather=load_weather, messages=False)
    log.info(
        "session.loaded",
        year=year,
        gp=gp,
        type=session_type,
        drivers=len(session.drivers),
    )
    return session


def extract_session_info(session: fastf1.core.Session) -> dict:
    event = session.event
    key = session.session_info.get("Key")
    if not key:
        import hashlib

        key = int(
            hashlib.md5(f"{event['EventName']}{session.name}".encode()).hexdigest()[:8],
            16,
        )
    return {
        "session_key": int(key),
        "year": int(event["EventDate"].year),
        "gp_name": event["EventName"],
        "country": event.get("Country", None),
        "session_type": {
            "Qualifying": "Q",
            "Race": "R",
            "Sprint": "SS",
            "Sprint Qualifying": "SQ",
            "Practice 1": "FP1",
            "Practice 2": "FP2",
            "Practice 3": "FP3",
        }.get(session.name, session.name[:2]),
        "session_name": session.name,
        "date_start": str(event["EventDate"]),
    }


def extract_drivers(session: fastf1.core.Session, session_key: int) -> list[dict]:
    results = []
    for drv in session.drivers:
        try:
            info = session.get_driver(drv)
            results.append(
                {
                    "driver_number": int(drv),
                    "session_key": session_key,
                    "full_name": info.get("FullName", info.get("BroadcastName", drv)),
                    "abbreviation": info.get("Abbreviation", drv),
                    "team_name": info.get("TeamName", None),
                    "team_colour": info.get("TeamColour", None),
                }
            )
        except Exception as e:
            log.warning("driver.skip", driver=drv, error=str(e))
    return results


def extract_laps(session: fastf1.core.Session, session_key: int) -> list[dict]:
    laps = session.laps
    results = []
    for _, row in laps.iterrows():
        try:
            driver_num = int(row["DriverNumber"])
        except (ValueError, TypeError):
            continue
        results.append(
            {
                "session_key": session_key,
                "driver_number": driver_num,
                "lap_number": row.get("LapNumber"),
                "lap_time_ms": row.get("LapTime"),
                "pit_in_time_ms": row.get("PitInTime"),
                "pit_out_time_ms": row.get("PitOutTime"),
                "s1_ms": row.get("Sector1Time"),
                "s2_ms": row.get("Sector2Time"),
                "s3_ms": row.get("Sector3Time"),
                "compound": row.get("Compound"),
                "tyre_life_laps": row.get("TyreLife"),
                "is_personal_best": row.get("IsPersonalBest", False),
                "track_status": row.get("TrackStatus"),
                "deleted": row.get("Deleted"),
                "stint": row.get("Stint"),
                "position": row.get("Position"),
                "fresh_tyre": row.get("FreshTyre"),
                "deleted_reason": row.get("DeletedReason"),
                "is_accurate": row.get("IsAccurate"),
                "speed_i1": row.get("SpeedI1"),
                "speed_i2": row.get("SpeedI2"),
                "speed_fl": row.get("SpeedFL"),
                "speed_st": row.get("SpeedST"),
            }
        )
    log.info("laps.extracted", session_key=session_key, count=len(results))
    return results


def extract_telemetry(
    session: fastf1.core.Session,
    session_key: int,
    all_drivers: bool = False,
) -> list[dict]:
    """
    Extract telemetry for the fastest lap of each driver.

    Captures: speed, rpm, gear, throttle, brake, drs, distance.
    Distance is key — it's metres around the lap, so two drivers
    can be compared at the exact same track position regardless of
    how many samples they have.

    all_drivers=True: all drivers (use for qualifying — 20 drivers × ~300 rows = 6k rows)
    all_drivers=False: first 10 drivers only (use for races to keep it fast)
    """
    results = []
    drivers = session.drivers if all_drivers else session.drivers[:10]

    for drv in drivers:
        try:
            driver_laps = session.laps.pick_drivers(drv)
            # pick_fastest() returns the lap with the lowest LapTime
            fast_lap = driver_laps.pick_fastest()

            if fast_lap is None or fast_lap.empty:
                log.debug("telemetry.no_fastest_lap", driver=drv)
                continue

            tel = fast_lap.get_telemetry()

            if tel is None or tel.empty:
                log.debug("telemetry.no_data", driver=drv)
                continue

            lap_number = int(fast_lap["LapNumber"])

            for _, row in tel.iterrows():
                results.append(
                    {
                        "session_key": session_key,
                        "driver_number": int(drv),
                        "lap_number": lap_number,
                        "speed_kmh": row.get("Speed"),
                        "rpm": row.get("RPM"),
                        "gear": row.get("nGear"),
                        "throttle_pct": row.get("Throttle"),
                        "brake": row.get("Brake"),
                        "drs": row.get("DRS"),
                        "distance_m": row.get(
                            "Distance"
                        ),  # metres — critical for overlay
                        "x_pos": row.get("X"),  # track map X coordinate
                        "y_pos": row.get("Y"),  # track map Y coordinate
                    }
                )

            log.info("telemetry.driver_done", driver=drv, samples=len(tel))

        except Exception as e:
            log.warning("telemetry.skip", driver=drv, error=str(e))

    log.info("telemetry.extracted", session_key=session_key, total=len(results))
    return results
