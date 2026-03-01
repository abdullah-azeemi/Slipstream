"""
Pydantic models for F1 data ingestion.

These are the data contracts for our system. Every row fetched from FastF1
passes through one of these models before being inserted into the database.

Why Pydantic v2:
- Validates types at runtime (not just type hints)
- Gives clear error messages for invalid data
- Handles None/NaN values explicitly
- Fast (written in Rust under the hood)
"""
from datetime import datetime
from typing import Literal

import pandas as pd
from pydantic import BaseModel, field_validator, model_validator


# Valid tyre compounds FastF1 can return
TyreCompound = Literal["SOFT", "MEDIUM", "HARD", "INTER", "WET", "TEST"]

# Valid session types
SessionType = Literal["R", "Q", "FP1", "FP2", "FP3", "SS", "SQ"]


class SessionModel(BaseModel):
    """One F1 session — race, qualifying, or practice."""
    session_key: int
    year: int
    gp_name: str
    country: str | None
    circuit_key: int | None
    session_type: SessionType
    session_name: str
    date_start: datetime | None
    date_end: datetime | None


class DriverModel(BaseModel):
    """A driver's entry in a specific session."""
    driver_number: int
    session_key: int
    full_name: str
    abbreviation: str
    team_name: str | None
    team_colour: str | None
    headshot_url: str | None


class LapModel(BaseModel):
    """
    One lap by one driver.
    FastF1 returns NaN for missing values — we convert those to None
    so PostgreSQL stores them as NULL (not as the string 'NaN').
    """
    session_key: int
    driver_number: int
    lap_number: int
    lap_time_ms: float | None
    s1_ms: float | None
    s2_ms: float | None
    s3_ms: float | None
    compound: TyreCompound | None
    tyre_life_laps: int | None
    is_personal_best: bool
    pit_in_time_ms: float | None
    pit_out_time_ms: float | None
    track_status: str | None
    deleted: bool
    recorded_at: datetime

    @field_validator(
        "lap_time_ms", "s1_ms", "s2_ms", "s3_ms",
        "pit_in_time_ms", "pit_out_time_ms",
        mode="before"
    )
    @classmethod
    def nan_to_none(cls, v: object) -> float | None:
        """
        FastF1 uses pandas NaN for missing numeric values.
        NaN is not valid JSON and not valid SQL — convert to None.
        pd.isna() catches both float NaN and pandas NA.
        """
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        return float(v)

    @field_validator("tyre_life_laps", mode="before")
    @classmethod
    def nan_to_none_int(cls, v: object) -> int | None:
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        return int(v)

    @field_validator("compound", mode="before")
    @classmethod
    def normalise_compound(cls, v: object) -> str | None:
        """FastF1 sometimes returns lowercase or None — normalise to uppercase."""
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        return str(v).upper()


class TelemetryModel(BaseModel):
    """
    One telemetry sample — captured roughly every 100ms per car.
    High volume: a full race produces ~500,000 of these per car.
    """
    session_key: int
    driver_number: int
    lap_number: int | None
    distance_m: float | None
    speed_kmh: float | None
    throttle_pct: float | None
    brake: bool | None
    gear: int | None
    rpm: float | None
    drs: int | None
    x_pos: float | None
    y_pos: float | None
    recorded_at: datetime

    @field_validator(
        "distance_m", "speed_kmh", "throttle_pct",
        "rpm", "drs", "x_pos", "y_pos",
        mode="before"
    )
    @classmethod
    def nan_to_none(cls, v: object) -> float | None:
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        return float(v)

    @field_validator("gear", "lap_number", mode="before")
    @classmethod
    def nan_to_none_int(cls, v: object) -> int | None:
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        return int(v)

    @field_validator("brake", mode="before")
    @classmethod
    def normalise_brake(cls, v: object) -> bool | None:
        """FastF1 returns brake as 0/1 integer or bool — normalise to bool."""
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        return bool(v)
