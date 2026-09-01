"""
OpenF1 client — fetches live-feed metadata OpenF1 exposes for a session.

OpenF1's session_key is the same "Key" the official feed / FastF1 uses, so we
can look radio messages up with the session_key we already store in Postgres.

Endpoints used:
  - GET /v1/team_radio?session_key=X&driver_number=Y
"""

from __future__ import annotations
import json
import urllib.error
import urllib.parse
import urllib.request
import structlog

from ingestion.config import settings

log = structlog.get_logger()


def _clean_str(val):
    if val is None:
        return None
    s = str(val).strip()
    return None if s in ("", "nan", "None") else s


def fetch_team_radio(
    session_key: int,
    driver_number: int | None = None,
    base_url: str | None = None,
) -> list[dict]:
    """Fetch team radio messages for a session (optionally one driver).

    Returns a list of raw OpenF1 rows: {date, driver_number, recording_url, ...}.
    Best-effort: any HTTP/transport error returns [] and logs a warning so a
    flaky live feed never aborts an ingestion run.
    """
    query = urllib.parse.urlencode({"session_key": session_key})
    if driver_number is not None:
        query += f"&driver_number={driver_number}"
    url = f"{base_url or settings.openf1_base_url}/v1/team_radio?{query}"

    try:
        with urllib.request.urlopen(
            url, timeout=settings.openf1_timeout_seconds
        ) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        log.warning("openf1.team_radio_failed", session_key=session_key, error=str(exc))
        return []

    rows = []
    for row in payload:
        date = _clean_str(row.get("date"))
        if not date:
            continue
        recording_url = _clean_str(row.get("recording_url"))
        if not recording_url:
            continue
        driver = row.get("driver_number")
        if driver is None:
            continue
        try:
            driver = int(driver)
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "session_key": session_key,
                "driver_number": driver,
                "date": date,
                "recording_url": recording_url,
                "transcript": None,
            }
        )
    log.info("openf1.team_radio_fetched", session_key=session_key, count=len(rows))
    return rows
