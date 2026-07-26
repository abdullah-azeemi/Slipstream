"""Kerb-usage telemetry — detect driving style signals from throttle/speed behavior.

For each corner in a lap, analyzes the telemetry window around the apex to compute:
  - throttle_instability:  std dev of throttle near apex (kerb fighting)
  - kerb_confidence:       fraction of corners with committed throttle
  - track_limits_rate:     fraction of corners with large speed drop on exit

Feeds results back into the driver_features table.

Usage:
    uv run python -m ml.kerb_usage
"""

from __future__ import annotations
import structlog
import numpy as np
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from ml.config import settings

logger = structlog.get_logger()

# Telemetry window around the apex in (meters)
CORNER_WINDOW_M = 50.0
THROTTLE_INSTABILITY_THRESHOLD = 20.0  # % change = "spike"
KERB_CONFIDENCE_THROTTLE_MIN = 50.0  # throttle % to count as "committed"
TRACK_LIMITS_SPEED_DROP_PCT = 0.15  # 15% speed drop = "went wide"


def load_driver_laps_with_telemetry(engine: Engine) -> list[dict]:
    """Load driver laps/combos that have telemetry available"""
    sql = text("""
        SELECT DISTINCT
            lts.driver_number, lts.session_key, lts.lap_number, s.year
        FROM lap_telemetry_stats lts
        JOIN sessions s ON s.session_key = lts.session_key
        WHERE lts.corners IS NOT NULL
        AND jsonb_array_length(lts.corners) > 0
        ORDER BY lts.driver_number, s.year, lts.session_key, lts.lap_number
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]


def load_telemetry_window(
    engine: Engine,
    session_key: int,
    driver_number: int,
    lap_number: int,
    apex_dist: float,
) -> list[dict]:
    """Load the telemetry samples from within the CORNER_WINDOW_M of the apex"""
    sql = text("""
        SELECT distance_m, speed_kmh, throttle_pct
        FROM telemetry
        WHERE session_key = :sk
            AND driver_number = :dn
            AND lap_number = :ln
            AND distance_m BETWEEN :win_start AND :win_end
        ORDER BY distance_m
    """)
    with engine.connect() as conn:
        rows = conn.execute(
            sql,
            {
                "sk": session_key,
                "dn": driver_number,
                "ln": lap_number,
                "win_start": apex_dist - CORNER_WINDOW_M,
                "win_end": apex_dist + CORNER_WINDOW_M,
            },
        ).fetchall()
        return [dict(r) for r in rows]


def load_corners(
    engine: Engine, session_key: int, driver_number: int, lap_number: int
) -> list[dict]:
    """Load corner data from lap_telemetry_stats."""
    sql = text("""
            SELECT corners
            FROM lap_telemetry_stats
            WHERE session_key = :sk
                AND driver_number = :dn
                AND lap_number = :ln
    """)
    with engine.connect() as conn:
        row = conn.execute(
            sql,
            {
                "sk": session_key,
                "dn": driver_number,
                "ln": lap_number,
            },
        ).fetchone()
    if not row or not row.corners:
        return []
    import json

    corners = json.loads(row.corners) if isinstance(row.corners, str) else row.corners
    return corners


def compute_throttle_instability(throttles: list[float]) -> float:
    """Std dev of throttle_pct in the window. High = kerb fighting."""
    if len(throttles) < 3:
        return 0.0
    return round(float(np.std(throttles)), 2)


def compute_kerb_confidence(throttles: list[float]) -> bool:
    """True if driver maintains >50% throttle through apex window."""
    if not throttles:
        return False
    return float(np.mean(throttles)) > KERB_CONFIDENCE_THROTTLE_MIN


def compute_track_limits(entry_speed: float, exit_speed: float) -> bool:
    """True if exit speed dropped >15% from entry (went wide)."""
    if entry_speed <= 0:
        return False
    drop = (entry_speed - exit_speed) / entry_speed
    return drop > TRACK_LIMITS_SPEED_DROP_PCT


def compute_kerb_features_for_driver(
    engine: Engine, driver_number: int, year: int
) -> dict:
    """Compute the kerb-usage for one driver in one season"""

    all_laps = load_driver_laps_with_telemetry(engine)
    driver_laps = [
        lap
        for lap in all_laps
        if lap["driver_number"] == driver_number and lap["year"] == year
    ]

    throttle_stabilities = []
    kerb_confident_corners = 0
    total_corners = 0
    track_limits_corners = 0
    for lap in driver_laps:
        corners = load_corners(
            engine, lap["session_key"], driver_number, lap["lap_number"]
        )
        for corner in corners:
            apex_dist = corner.get("distance_m")
            if not apex_dist:
                continue

            samples = load_telemetry_window(
                engine,
                lap["session_key"],
                driver_number,
                lap["lap_number"],
                apex_dist,
            )
            if len(samples) < 3:
                continue

            throttles = [s["throttle_pct"] or 0.0 for s in samples]
            entry_speed = corner.get("entry_speed_kmh", 0)
            exit_speed = corner.get("exit_speed_kmh", 0)

            # Throttle instability
            instability = compute_throttle_instability(throttles)
            throttle_stabilities.append(instability)

            # Kerb confidence
            total_corners += 1
            if compute_kerb_confidence(throttles):
                kerb_confident_corners += 1

            # Track limits
            if compute_track_limits(entry_speed, exit_speed):
                track_limits_corners += 1

    if not throttle_stabilities:
        return {
            "throttle_instability": None,
            "kerb_confidence": None,
            "track_limits_rate": None,
        }

    return {
        "throttle_instability": round(float(np.mean(throttle_stabilities)), 3),
        "kerb_confidence": (
            round(kerb_confident_corners / total_corners, 3)
            if total_corners > 0
            else None
        ),
        "track_limits_rate": (
            round(track_limits_corners / total_corners, 3)
            if total_corners > 0
            else None
        ),
    }


KERB_FEATURE_COLS = ["throttle_instability", "kerb_confidence", "track_limits_rate"]

UPSERT_KERB_SQL = text("""
    UPDATE driver_features
    SET throttle_instability = :throttle_instability,
        kerb_confidence = :kerb_confidence,
        track_limits_rate = :track_limits_rate,
        computed_at = NOW()
    WHERE driver_number = :driver_number
      AND season = :season
""")


def upsert_kerb_features(
    engine: Engine, driver_number: int, season: int, features: dict
) -> None:
    """Update kerb features for a specific driver/season."""
    with engine.begin() as conn:
        conn.execute(
            UPSERT_KERB_SQL,
            {
                "driver_number": driver_number,
                "season": season,
                **features,
            },
        )


def main() -> None:
    engine = create_engine(settings.db_url)
    all_laps = load_driver_laps_with_telemetry(engine)

    seen = set()
    pairs = []
    for lap in all_laps:
        key = (lap["driver_number"], lap["year"])
        if key not in seen:
            seen.add(key)
            pairs.append(key)

    logger.info("kerb_usage_start", driver_seasons=len(pairs))

    total = 0
    for driver_number, year in pairs:
        features = compute_kerb_features_for_driver(engine, driver_number, year)
        if any(v is not None for v in features.values()):
            upsert_kerb_features(engine, driver_number, year, features)
            total += 1
            logger.info(
                "kerb_features_computed",
                driver=driver_number,
                season=year,
                **features,
            )

    logger.info("kerb_usage_done", updated=total)


if __name__ == "__main__":
    main()
