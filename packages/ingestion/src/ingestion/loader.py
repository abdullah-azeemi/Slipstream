"""
Database loader — validates and batch-inserts FastF1 data.

TimescaleDB hypertables do not support ON CONFLICT upserts because
the partition key (recorded_at) must be in any unique constraint,
making conflict detection unreliable. We use DELETE-then-INSERT per
session instead — idempotent and safe to rerun.
"""

from __future__ import annotations
import structlog
from sqlalchemy import text
from ingestion.database import get_connection
from ingestion.models import SessionModel, DriverModel, LapModel, TelemetryModel

log = structlog.get_logger()
BATCH = 500


def upsert_session(data: dict) -> int:
    model = SessionModel(**data)
    with get_connection() as conn:
        conn.execute(
            text("""
            INSERT INTO sessions
                (session_key, year, gp_name, country, session_type, session_name, date_start)
            VALUES
                (:session_key, :year, :gp_name, :country, :session_type, :session_name, :date_start)
            ON CONFLICT (session_key) DO UPDATE SET
                gp_name      = EXCLUDED.gp_name,
                country      = EXCLUDED.country,
                session_type = EXCLUDED.session_type,
                session_name = EXCLUDED.session_name,
                date_start   = EXCLUDED.date_start
        """),
            model.model_dump(),
        )
    log.info("session.upserted", key=model.session_key, name=model.gp_name)
    return model.session_key


def load_drivers(rows: list[dict]) -> int:
    if not rows:
        return 0
    with get_connection() as conn:
        for row in rows:
            model = DriverModel(**row)
            conn.execute(
                text("""
                INSERT INTO drivers
                    (driver_number, session_key, full_name, abbreviation, team_name, team_colour)
                VALUES
                    (:driver_number, :session_key, :full_name, :abbreviation, :team_name, :team_colour)
                ON CONFLICT (driver_number, session_key) DO UPDATE SET
                    full_name   = EXCLUDED.full_name,
                    team_name   = EXCLUDED.team_name,
                    team_colour = EXCLUDED.team_colour
            """),
                model.model_dump(),
            )
    log.info("drivers.loaded", count=len(rows))
    return len(rows)


def load_laps(rows: list[dict], session_key: int) -> int:
    if not rows:
        return 0

    validated, skipped = [], 0
    for row in rows:
        try:
            validated.append(LapModel(**row).model_dump())
        except Exception as e:
            skipped += 1
            log.debug("lap.skip", error=str(e))

    with get_connection() as conn:
        deleted = conn.execute(
            text("DELETE FROM lap_times WHERE session_key = :sk"), {"sk": session_key}
        ).rowcount
        if deleted:
            log.info("laps.cleared", session_key=session_key, deleted=deleted)

        for i in range(0, len(validated), BATCH):
            batch = validated[i : i + BATCH]
            conn.execute(
                text("""
                INSERT INTO lap_times (
                    session_key, driver_number, lap_number,
                    lap_time_ms, s1_ms, s2_ms, s3_ms,
                    pit_in_time_ms, pit_out_time_ms,
                    compound, tyre_life_laps, is_personal_best,
                    track_status, deleted,
                    stint, position, fresh_tyre, deleted_reason,
                    is_accurate, speed_i1, speed_i2, speed_fl, speed_st,
                    recorded_at
                ) VALUES (
                    :session_key, :driver_number, :lap_number,
                    :lap_time_ms, :s1_ms, :s2_ms, :s3_ms,
                    :pit_in_time_ms, :pit_out_time_ms,
                    :compound, :tyre_life_laps, :is_personal_best,
                    :track_status, :deleted,
                    :stint, :position, :fresh_tyre, :deleted_reason,
                    :is_accurate, :speed_i1, :speed_i2, :speed_fl, :speed_st,
                    NOW()
                )
            """),
                batch,
            )
            log.info("laps.batch", inserted=i + len(batch), total=len(validated))

    if skipped:
        log.warning("laps.skipped", count=skipped)
    log.info("laps.loaded", session_key=session_key, count=len(validated))
    return len(validated)


def load_telemetry(rows: list[dict], session_key: int) -> int:
    if not rows:
        return 0

    validated = []
    for row in rows:
        try:
            validated.append(TelemetryModel(**row).model_dump())
        except Exception as e:
            log.debug("telemetry.skip", error=str(e))

    with get_connection() as conn:
        conn.execute(
            text("DELETE FROM telemetry WHERE session_key = :sk"), {"sk": session_key}
        )

        for i in range(0, len(validated), BATCH):
            batch = validated[i : i + BATCH]
            conn.execute(
                text("""
                INSERT INTO telemetry (
                    session_key, driver_number, lap_number,
                    speed_kmh, rpm, gear, throttle_pct, brake, drs,
                    distance_m, x_pos, y_pos,
                    recorded_at
                ) VALUES (
                    :session_key, :driver_number, :lap_number,
                    :speed_kmh, :rpm, :gear, :throttle_pct, :brake, :drs,
                    :distance_m, :x_pos, :y_pos,
                    NOW()
                )
            """),
                batch,
            )

    log.info("telemetry.loaded", session_key=session_key, count=len(validated))
    return len(validated)
