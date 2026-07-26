"""Driver feature store — pre-computed driver-level traits for the embedding pipeline.

Computes 13 features per driver per season from existing database tables:
- Race performance (from lap_times derivation)
- Pace metrics (from lap_times speed data)
- Driving style (from lap_telemetry_stats)
- Wet weather performance (from sessions + lap_times)

Usage:
    uv run python -m ml.driver_features

"""

from __future__ import annotations
import structlog
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from ml.config import settings

logger = structlog.get_logger()


# The race perfromance features (from lap_times + sessions)
def compute_race_features(engine: Engine, season: int) -> dict[int, dict]:
    """Compute race performance features for all drivers in a season.

    Returns: {driver_number: {feature_name: value, ...}}
    """
    sql = text("""
        WITH last_laps AS (
            SELECT DISTINCT ON (lt.session_key, lt.driver_number)
                lt.session_key,
                lt.driver_number,
                lt.position AS finish_position
            FROM lap_times lt
            JOIN sessions s ON s.session_key = lt.session_key
            WHERE s.session_type = 'R'
              AND s.year = :season
              AND lt.deleted = FALSE
            ORDER BY lt.session_key, lt.driver_number, lt.lap_number DESC
        ),
        quali_best AS (
            SELECT DISTINCT ON (lt.session_key, lt.driver_number)
                lt.session_key,
                lt.driver_number,
                lt.lap_time_ms
            FROM lap_times lt
            JOIN sessions s ON s.session_key = lt.session_key
            WHERE s.session_type = 'Q'
              AND s.year = :season
              AND lt.deleted = FALSE
            ORDER BY lt.session_key, lt.driver_number, lt.lap_time_ms ASC
        ),
        quali_positions AS (
            SELECT
                session_key,
                driver_number,
                RANK() OVER (
                    PARTITION BY session_key
                    ORDER BY lap_time_ms ASC
                ) AS quali_position
            FROM quali_best
        ),
        driver_results AS (
            SELECT
                ll.session_key,
                ll.driver_number,
                ll.finish_position,
                qp.quali_position,
                qp.quali_position - ll.finish_position AS positions_gained,
                qp.quali_position - ll.finish_position AS quali_to_race_delta
            FROM last_laps ll
            LEFT JOIN quali_positions qp
                ON qp.driver_number = ll.driver_number
        )
        SELECT
            dr.driver_number,
            d.full_name,
            d.abbreviation,
            d.team_name,
            AVG(dr.finish_position) AS avg_finish_position,
            STDDEV_POP(dr.finish_position) AS finish_position_stddev,
            SUM(CASE WHEN dr.finish_position <= 3 THEN 1 ELSE 0 END)::FLOAT
                / COUNT(*) AS podium_rate,
            SUM(CASE WHEN dr.finish_position = 1 THEN 1 ELSE 0 END)::FLOAT
                / COUNT(*) AS win_rate,
            AVG(dr.positions_gained) AS avg_positions_gained,
            AVG(dr.quali_to_race_delta) AS quali_to_race_delta,
            SUM(CASE WHEN dr.finish_position IS NULL THEN 1 ELSE 0 END)::FLOAT
                / COUNT(*) AS dnf_rate
        FROM driver_results dr
        JOIN drivers d
            ON d.driver_number = dr.driver_number
            AND d.session_key = dr.session_key
        GROUP BY dr.driver_number, d.full_name, d.abbreviation, d.team_name
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, {"season": season}).fetchall()

    result: dict[int, dict] = {}
    for row in rows:
        result[row.driver_number] = {
            "full_name": row.full_name,
            "abbreviation": row.abbreviation,
            "team_name": row.team_name,
            "avg_finish_position": _float(row.avg_finish_position),
            "finish_position_stddev": _float(row.finish_position_stddev),
            "podium_rate": _float(row.podium_rate),
            "win_rate": _float(row.win_rate),
            "avg_positions_gained": _float(row.avg_positions_gained),
            "quali_to_race_delta": _float(row.quali_to_race_delta),
            "dnf_rate": _float(row.dnf_rate),
        }

    logger.info("compute_race_features", season=season, drivers=len(result))
    return result


# The lap time consistency (from lap_times)


def compute_laptime_consistency(engine: Engine, season: int) -> dict[int, dict]:
    """Coefficient of variation of race lap times (normalized stddev).

    Lower = more consistent driver. Normalized by mean so circuits of
    different lengths are comparable.
    """
    sql = text("""
        SELECT
            lt.driver_number,
            STDDEV_POP(lt.lap_time_ms) / AVG(lt.lap_time_ms)
                AS lap_time_consistency
        FROM lap_times lt
        JOIN sessions s ON s.session_key = lt.session_key
        WHERE s.session_type = 'R'
          AND s.year = :season
          AND lt.deleted = FALSE
          AND lt.lap_time_ms IS NOT NULL
        GROUP BY lt.driver_number
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, {"season": season}).fetchall()

    result: dict[int, dict] = {}
    for row in rows:
        result[row.driver_number] = {
            "lap_time_consistency": _float(row.lap_time_consistency),
        }

    logger.info("compute_laptime_consistency", season=season, drivers=len(result))
    return result


# Speed features (from lap_times.speed_st)


def compute_speed_features(engine: Engine, season: int) -> dict[int, dict]:
    """Average speed trap speed across all race laps in a season."""
    sql = text("""
        SELECT
            lt.driver_number,
            AVG(lt.speed_st) AS avg_speed_trap
        FROM lap_times lt
        JOIN sessions s ON s.session_key = lt.session_key
        WHERE s.session_type = 'R'
          AND s.year = :season
          AND lt.deleted = FALSE
          AND lt.speed_st IS NOT NULL
        GROUP BY lt.driver_number
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, {"season": season}).fetchall()

    result: dict[int, dict] = {}
    for row in rows:
        result[row.driver_number] = {
            "avg_speed_trap": _float(row.avg_speed_trap),
        }

    logger.info("compute_speed_features", season=season, drivers=len(result))
    return result


# Telemetry features (from lap_telemetry_stats — pre-computed)


def compute_telemetry_features(engine: Engine, season: int) -> dict[int, dict]:
    """Driving style signals from pre-computed telemetry aggregates.

    - max_speed_capability: peak car+driver speed (km/h)
    - braking_aggression:  avg braking distance before apex (metres)
    - drs_usage_pct:       % of lap with DRS open
    """
    sql = text("""
        SELECT
            lts.driver_number,
            AVG(lts.max_speed_kmh)   AS max_speed_capability,
            AVG(lts.avg_brake_point_pct) AS braking_aggression,
            AVG(lts.drs_open_pct)    AS drs_usage_pct
        FROM lap_telemetry_stats lts
        JOIN sessions s ON s.session_key = lts.session_key
        WHERE s.session_type = 'R'
          AND s.year = :season
        GROUP BY lts.driver_number
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, {"season": season}).fetchall()

    result: dict[int, dict] = {}
    for row in rows:
        result[row.driver_number] = {
            "max_speed_capability": _float(row.max_speed_capability),
            "braking_aggression": _float(row.braking_aggression),
            "drs_usage_pct": _float(row.drs_usage_pct),
        }

    logger.info("compute_telemetry_features", season=season, drivers=len(result))
    return result


# The weather features (from sessions.rainfall + lap_times)


def compute_weather_features(engine: Engine, season: int) -> dict[int, dict]:
    """Wet weather performance delta.

    wet_pace_delta = avg_finish_in_wet - avg_finish_in_dry
    Negative number = driver performs better in rain.
    Only computed for drivers who have raced in both wet and dry conditions.
    """
    sql = text("""
        WITH last_laps AS (
            SELECT DISTINCT ON (lt.session_key, lt.driver_number)
                lt.session_key,
                lt.driver_number,
                lt.position AS finish_position
            FROM lap_times lt
            JOIN sessions s ON s.session_key = lt.session_key
            WHERE s.session_type = 'R'
              AND s.year = :season
              AND lt.deleted = FALSE
            ORDER BY lt.session_key, lt.driver_number, lt.lap_number DESC
        ),
        driver_wet_dry AS (
            SELECT
                ll.driver_number,
                AVG(CASE WHEN s.rainfall = TRUE
                    THEN ll.finish_position END) AS avg_finish_wet,
                AVG(CASE WHEN s.rainfall = FALSE OR s.rainfall IS NULL
                    THEN ll.finish_position END) AS avg_finish_dry
            FROM last_laps ll
            JOIN sessions s ON s.session_key = ll.session_key
            GROUP BY ll.driver_number
        )
        SELECT
            driver_number,
            (avg_finish_wet - avg_finish_dry) AS wet_pace_delta
        FROM driver_wet_dry
        WHERE avg_finish_wet IS NOT NULL
          AND avg_finish_dry IS NOT NULL
    """)

    with engine.connect() as conn:
        rows = conn.execute(sql, {"season": season}).fetchall()

    result: dict[int, dict] = {}
    for row in rows:
        result[row.driver_number] = {
            "wet_pace_delta": _float(row.wet_pace_delta),
        }

    logger.info("compute_weather_features", season=season, drivers=len(result))
    return result


def merge_features(*feature_dicts: dict[int, dict]) -> list[dict]:
    """Merge multiple per-driver feature dicts into a flat list of rows."""
    merged: dict[int, dict] = {}
    for fd in feature_dicts:
        for driver_num, features in fd.items():
            if driver_num not in merged:
                merged[driver_num] = {"driver_number": driver_num}
            merged[driver_num].update(features)
    return list(merged.values())


UPSERT_SQL = text("""
    INSERT INTO driver_features (
        driver_number, season, full_name, abbreviation, team_name,
        avg_finish_position, finish_position_stddev, podium_rate, win_rate,
        avg_positions_gained, quali_to_race_delta, dnf_rate,
        lap_time_consistency, avg_speed_trap,
        max_speed_capability, braking_aggression, drs_usage_pct,
        wet_pace_delta,
        throttle_instability, kerb_confidence, track_limits_rate
    ) VALUES (
        :driver_number, :season, :full_name, :abbreviation, :team_name,
        :avg_finish_position, :finish_position_stddev, :podium_rate, :win_rate,
        :avg_positions_gained, :quali_to_race_delta, :dnf_rate,
        :lap_time_consistency, :avg_speed_trap,
        :max_speed_capability, :braking_aggression, :drs_usage_pct,
        :wet_pace_delta,
        :throttle_instability, :kerb_confidence, :track_limits_rate
    )
    ON CONFLICT (driver_number, season)
    DO UPDATE SET
        full_name = EXCLUDED.full_name,
        abbreviation = EXCLUDED.abbreviation,
        team_name = EXCLUDED.team_name,
        avg_finish_position = EXCLUDED.avg_finish_position,
        finish_position_stddev = EXCLUDED.finish_position_stddev,
        podium_rate = EXCLUDED.podium_rate,
        win_rate = EXCLUDED.win_rate,
        avg_positions_gained = EXCLUDED.avg_positions_gained,
        quali_to_race_delta = EXCLUDED.quali_to_race_delta,
        dnf_rate = EXCLUDED.dnf_rate,
        lap_time_consistency = EXCLUDED.lap_time_consistency,
        avg_speed_trap = EXCLUDED.avg_speed_trap,
        max_speed_capability = EXCLUDED.max_speed_capability,
        braking_aggression = EXCLUDED.braking_aggression,
        drs_usage_pct = EXCLUDED.drs_usage_pct,
        wet_pace_delta = EXCLUDED.wet_pace_delta,
        throttle_instability = EXCLUDED.throttle_instability,
        kerb_confidence = EXCLUDED.kerb_confidence,
        track_limits_rate = EXCLUDED.track_limits_rate,
        computed_at = NOW()
""")


UPSERT_COLUMNS = [
    "full_name",
    "abbreviation",
    "team_name",
    "avg_finish_position",
    "finish_position_stddev",
    "podium_rate",
    "win_rate",
    "avg_positions_gained",
    "quali_to_race_delta",
    "dnf_rate",
    "lap_time_consistency",
    "avg_speed_trap",
    "max_speed_capability",
    "braking_aggression",
    "drs_usage_pct",
    "wet_pace_delta",
    "throttle_instability",
    "kerb_confidence",
    "track_limits_rate",
]


def upsert_features(engine: Engine, rows: list[dict], season: int) -> int:
    """Insert or update driver features. Returns count of rows written."""
    if not rows:
        return 0

    with engine.begin() as conn:
        for row in rows:
            row["season"] = season
            for col in UPSERT_COLUMNS:
                row.setdefault(col, None)
            conn.execute(UPSERT_SQL, row)

    return len(rows)


# Helping functions
def _float(value) -> float | None:
    """Safely convert a SQL result to float, returning None for NULL/NaN."""
    if value is None:
        return None
    try:
        f = float(value)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def main() -> None:
    """Compute and store driver features for all seasons in the database."""
    engine = create_engine(settings.db_url)

    with engine.connect() as conn:
        seasons = (
            conn.execute(
                text(
                    "SELECT DISTINCT year FROM sessions WHERE session_type = 'R' ORDER BY year"
                )
            )
            .scalars()
            .all()
        )

    if not seasons:
        logger.warning("no_seasons_found")
        return

    total = 0
    for season in seasons:
        logger.info("computing_features", season=season)

        race_feats = compute_race_features(engine, season)
        lt_feats = compute_laptime_consistency(engine, season)
        speed_feats = compute_speed_features(engine, season)
        tel_feats = compute_telemetry_features(engine, season)
        weather_feats = compute_weather_features(engine, season)

        all_rows = merge_features(
            race_feats, lt_feats, speed_feats, tel_feats, weather_feats
        )

        count = upsert_features(engine, all_rows, season)
        total += count
        logger.info("season_done", season=season, rows=count)

    logger.info("all_done", total_rows=total)


if __name__ == "__main__":
    main()
