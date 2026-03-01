"""
Loads validated F1 data into TimescaleDB.

Pattern:
1. Receive raw data from FastF1 client
2. Validate each row through Pydantic models
3. Collect valid rows into batches
4. Bulk insert batches into the database
5. Send invalid rows to the DLQ Kafka topic

Batching is critical for performance. Inserting 500 rows at once
is ~100x faster than 500 individual INSERT statements because each
individual INSERT has network round-trip overhead.
"""
import json
from datetime import timezone
from typing import Any

import pandas as pd
import structlog
from pydantic import ValidationError
from sqlalchemy import text

from ingestion.config import settings
from ingestion.database import get_connection
from ingestion.models import DriverModel, LapModel, SessionModel, TelemetryModel

log = structlog.get_logger()


def _to_utc(dt: Any) -> Any:
    """Ensure datetime is timezone-aware (UTC). TimescaleDB requires TIMESTAMPTZ."""
    if dt is None:
        return None
    if hasattr(dt, "tzinfo") and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def upsert_session(session_data: dict[str, Any]) -> int:
    """
    Insert or update a session record.
    Returns the session_key.

    We use INSERT ... ON CONFLICT DO UPDATE (upsert) so this is safe
    to run multiple times — re-running the ingestion won't create duplicates.
    """
    validated = SessionModel(**session_data)

    with get_connection() as conn:
        conn.execute(text("""
            INSERT INTO sessions (
                session_key, year, gp_name, country, circuit_key,
                session_type, session_name, date_start, date_end
            ) VALUES (
                :session_key, :year, :gp_name, :country, :circuit_key,
                :session_type, :session_name, :date_start, :date_end
            )
            ON CONFLICT (session_key) DO UPDATE SET
                gp_name      = EXCLUDED.gp_name,
                session_name = EXCLUDED.session_name,
                date_start   = EXCLUDED.date_start
        """), {
            **validated.model_dump(),
            "date_start": _to_utc(validated.date_start),
            "date_end":   _to_utc(validated.date_end),
        })

    log.info("loader.session_upserted", session_key=validated.session_key)
    return validated.session_key


def load_drivers(driver_rows: list[dict[str, Any]]) -> None:
    """Upsert all drivers for a session."""
    valid_rows = []
    for raw in driver_rows:
        try:
            valid_rows.append(DriverModel(**raw).model_dump())
        except ValidationError as e:
            log.warning("loader.driver_invalid", error=str(e), raw=raw)

    if not valid_rows:
        return

    with get_connection() as conn:
        conn.execute(text("""
            INSERT INTO drivers (
                driver_number, session_key, full_name,
                abbreviation, team_name, team_colour, headshot_url
            ) VALUES (
                :driver_number, :session_key, :full_name,
                :abbreviation, :team_name, :team_colour, :headshot_url
            )
            ON CONFLICT (driver_number, session_key) DO UPDATE SET
                full_name  = EXCLUDED.full_name,
                team_name  = EXCLUDED.team_name,
                team_colour = EXCLUDED.team_colour
        """), valid_rows)

    log.info("loader.drivers_loaded", count=len(valid_rows))


def load_laps(laps_df: pd.DataFrame, session_key: int) -> dict[str, int]:
    """
    Validate and insert all laps for a session.
    Returns a summary: {"inserted": N, "invalid": M}

    We process in batches of `db_batch_size` rows (default 500).
    """
    inserted = 0
    invalid  = 0
    batch: list[dict[str, Any]] = []

    for _, row in laps_df.iterrows():
        # Build the raw dict from the FastF1 DataFrame row
        raw = {
            "session_key":      session_key,
            "driver_number":    row.get("DriverNumber"),
            "lap_number":       row.get("LapNumber"),
            "lap_time_ms":      _timedelta_to_ms(row.get("LapTime")),
            "s1_ms":            _timedelta_to_ms(row.get("Sector1Time")),
            "s2_ms":            _timedelta_to_ms(row.get("Sector2Time")),
            "s3_ms":            _timedelta_to_ms(row.get("Sector3Time")),
            "compound":         row.get("Compound"),
            "tyre_life_laps":   row.get("TyreLife"),
            "is_personal_best": bool(row.get("IsPersonalBest", False)),
            "pit_in_time_ms":   _timedelta_to_ms(row.get("PitInTime")),
            "pit_out_time_ms":  _timedelta_to_ms(row.get("PitOutTime")),
            "track_status":     row.get("TrackStatus"),
            "deleted":          bool(row.get("Deleted", False)),
            "recorded_at":      _to_utc(row.get("LapStartDate")),
        }

        try:
            validated = LapModel(**raw)
            batch.append({
                **validated.model_dump(),
                "recorded_at": _to_utc(validated.recorded_at),
            })
        except ValidationError as e:
            invalid += 1
            log.warning("loader.lap_invalid",
                        driver=raw.get("driver_number"),
                        lap=raw.get("lap_number"),
                        error=str(e))
            continue

        # When batch is full, flush it to the database
        if len(batch) >= settings.db_batch_size:
            _insert_laps_batch(batch)
            inserted += len(batch)
            batch = []

    # Flush remaining rows
    if batch:
        _insert_laps_batch(batch)
        inserted += len(batch)

    log.info("loader.laps_loaded",
             session_key=session_key,
             inserted=inserted,
             invalid=invalid)

    return {"inserted": inserted, "invalid": invalid}


def _insert_laps_batch(batch: list[dict[str, Any]]) -> None:
    """Bulk insert a batch of validated lap rows."""
    with get_connection() as conn:
        conn.execute(text("""
            INSERT INTO lap_times (
                session_key, driver_number, lap_number,
                lap_time_ms, s1_ms, s2_ms, s3_ms,
                compound, tyre_life_laps, is_personal_best,
                pit_in_time_ms, pit_out_time_ms,
                track_status, deleted, recorded_at
            ) VALUES (
                :session_key, :driver_number, :lap_number,
                :lap_time_ms, :s1_ms, :s2_ms, :s3_ms,
                :compound, :tyre_life_laps, :is_personal_best,
                :pit_in_time_ms, :pit_out_time_ms,
                :track_status, :deleted, :recorded_at
            )
            ON CONFLICT DO NOTHING
        """), batch)


def load_telemetry(tel_df: pd.DataFrame, session_key: int, driver_number: int) -> int:
    """
    Insert telemetry for one driver. Returns number of rows inserted.
    Telemetry is huge — we batch aggressively.
    """
    if tel_df.empty:
        return 0

    inserted = 0
    batch: list[dict[str, Any]] = []

    for _, row in tel_df.iterrows():
        raw = {
            "session_key":   session_key,
            "driver_number": driver_number,
            "lap_number":    row.get("LapNumber") or row.get("Lap"),
            "distance_m":    row.get("Distance"),
            "speed_kmh":     row.get("Speed"),
            "throttle_pct":  row.get("Throttle"),
            "brake":         row.get("Brake"),
            "gear":          row.get("nGear") or row.get("Gear"),
            "rpm":           row.get("RPM"),
            "drs":           row.get("DRS"),
            "x_pos":         row.get("X"),
            "y_pos":         row.get("Y"),
            "recorded_at":   _to_utc(row.get("Date") or row.get("SessionTime")),
        }

        try:
            validated = TelemetryModel(**raw)
            batch.append({
                **validated.model_dump(),
                "recorded_at": _to_utc(validated.recorded_at),
            })
        except ValidationError:
            continue   # silently skip invalid telemetry rows

        if len(batch) >= settings.db_batch_size:
            _insert_telemetry_batch(batch)
            inserted += len(batch)
            batch = []

    if batch:
        _insert_telemetry_batch(batch)
        inserted += len(batch)

    log.info("loader.telemetry_loaded",
             session_key=session_key,
             driver_number=driver_number,
             inserted=inserted)

    return inserted


def _insert_telemetry_batch(batch: list[dict[str, Any]]) -> None:
    with get_connection() as conn:
        conn.execute(text("""
            INSERT INTO telemetry (
                session_key, driver_number, lap_number,
                distance_m, speed_kmh, throttle_pct,
                brake, gear, rpm, drs, x_pos, y_pos, recorded_at
            ) VALUES (
                :session_key, :driver_number, :lap_number,
                :distance_m, :speed_kmh, :throttle_pct,
                :brake, :gear, :rpm, :drs, :x_pos, :y_pos, :recorded_at
            )
        """), batch)


def _timedelta_to_ms(td: Any) -> float | None:
    """
    Convert a pandas Timedelta to milliseconds.
    FastF1 returns lap/sector times as Timedelta objects, not floats.
    We store as milliseconds (float) for easier maths later.
    """
    if td is None:
        return None
    try:
        if pd.isna(td):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(td, "total_seconds"):
        return td.total_seconds() * 1000
    return None
