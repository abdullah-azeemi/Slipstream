"""
FastF1 API client.

FastF1 is a Python library that fetches F1 session data from the
official F1 timing API and caches it locally. After the first fetch,
subsequent calls for the same session are instant (from cache).

FastF1 cache is critical for development — without it every run
re-downloads hundreds of MB of data.
"""
import os
from pathlib import Path
from typing import Any

import fastf1
import pandas as pd
import structlog

from ingestion.config import settings

log = structlog.get_logger()


def setup_cache() -> None:
    """
    Enable FastF1's local disk cache.
    Must be called before any FastF1 API calls.
    Creates the cache directory if it doesn't exist.
    """
    cache_dir = Path(settings.fastf1_cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_dir))
    log.info("fastf1.cache_enabled", path=str(cache_dir))


def fetch_session(year: int, gp: str | int, session_type: str) -> fastf1.core.Session:
    """
    Fetch a FastF1 session with all data loaded.

    Args:
        year: Season year e.g. 2024
        gp: GP name e.g. 'British' or round number e.g. 12
        session_type: 'R' (race), 'Q' (qualifying), 'FP1', 'FP2', 'FP3'

    Returns:
        A loaded FastF1 Session object.

    FastF1 loads different data with different flags:
        laps=True        → lap times and tyre data
        telemetry=True   → speed, brake, throttle etc.
        weather=True     → air/track temperature, rainfall
        messages=True    → team radio and flag messages
    """
    log.info("fastf1.fetching_session",
             year=year, gp=gp, session_type=session_type)

    session = fastf1.get_session(year, gp, session_type)

    # Load everything we need in one call
    session.load(
        laps=True,
        telemetry=True,
        weather=True,
        messages=False,    # team radio — not needed for analytics
    )

    log.info("fastf1.session_loaded",
             year=year,
             gp=gp,
             session_type=session_type,
             session_key=session.session_info.get("Key"),
             total_laps=len(session.laps))

    return session


def extract_session_info(session: fastf1.core.Session) -> dict[str, Any]:
    """Pull the metadata fields we need from a FastF1 session object."""
    info = session.session_info
    event = session.event

    return {
        "session_key": int(info.get("Key", 0)),
        "year": int(session.date.year),
        "gp_name": str(event.get("EventName", "")),
        "country": str(event.get("Country", "")),
        "circuit_key": info.get("CircuitKey"),
        "session_type": str(session.name[0].upper()),   # 'Race' → 'R'
        "session_name": str(session.name),
        "date_start": session.date,
        "date_end": None,   # FastF1 doesn't always provide end time
    }


def extract_drivers(session: fastf1.core.Session, session_key: int) -> list[dict[str, Any]]:
    """Extract driver info from a session."""
    drivers = []
    for driver_num, driver_info in session.results.iterrows():
        drivers.append({
            "driver_number": int(driver_num) if str(driver_num).isdigit()
                             else int(driver_info.get("DriverNumber", 0)),
            "session_key": session_key,
            "full_name": str(driver_info.get("FullName", "")),
            "abbreviation": str(driver_info.get("Abbreviation", "")),
            "team_name": driver_info.get("TeamName"),
            "team_colour": driver_info.get("TeamColor"),
            "headshot_url": driver_info.get("HeadshotUrl"),
        })
    return drivers


def extract_laps(
    session: fastf1.core.Session,
    session_key: int,
) -> pd.DataFrame:
    """
    Return the raw laps DataFrame from FastF1.
    We return the raw DataFrame here and let the loader handle
    the row-by-row transformation and validation.
    """
    laps = session.laps.copy()
    laps["session_key"] = session_key
    return laps


def extract_telemetry(
    session: fastf1.core.Session,
    session_key: int,
    driver_number: int,
) -> pd.DataFrame:
    """
    Return telemetry for one driver.
    We fetch per-driver to handle errors gracefully —
    if one driver's telemetry is missing we skip them,
    not the entire session.
    """
    try:
        driver_laps = session.laps.pick_drivers(driver_number)
        tel = driver_laps.get_telemetry()
        tel["session_key"] = session_key
        tel["driver_number"] = driver_number
        return tel
    except Exception as e:
        log.warning("fastf1.telemetry_unavailable",
                    driver_number=driver_number,
                    session_key=session_key,
                    error=str(e))
        return pd.DataFrame()   # empty DataFrame — caller skips it
