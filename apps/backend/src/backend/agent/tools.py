"""
Read-only agent tools — deterministic functions that query Postgres.

Rules:
- SQL lives here, inside these functions. It never comes from the LLM.
- Each tool takes one typed input dataclass and returns one typed output.
- Tools never write to the database.
"""

from __future__ import annotations
from sqlalchemy import text
from backend import extensions
from backend.agent import types


def resolve_session(inp: types.ResolveSessionInput) -> types.ResolvedSession:
    """Find the most recent session matching the given year, GP name, and session type."""
    with extensions.engine.connect() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT session_key, year, gp_name, session_type, session_name 
                    FROM sessions
                    WHERE year = :year AND gp_name ILIKE :gp_pattern AND session_type = :stype
                    ORDER BY date_start DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {
                    "year": inp.year,
                    "gp_pattern": f"%{inp.gp_name}%",
                    "stype": inp.session_type.value,
                },
            )
            .mappings()
            .first()
        )
    if row is None:
        raise types.NotFoundError(
            f"No {inp.session_type.value} session found for {inp.gp_name} {inp.year}"
        )

    return types.ResolvedSession(
        session_key=row["session_key"],
        year=row["year"],
        gp_name=row["gp_name"],
        session_type=types.SessionType(row["session_type"]),
        session_name=row["session_name"],
    )


def resolve_driver(inp: types.ResolveDriverInput) -> types.ResolvedDriver:
    """Resolve a driver title by its abbervaition, name, or number to a session specific driver.

    It uses a signle query with three OR conditions to find the driver. If multiple drivers match, it returns the one with the lowest driver number.
    """

    term = inp.name_or_abbreviation.strip()
    if term.isdigit():
        numeric = int(term)
    else:
        numeric = None

    params = {
        "sk": inp.session_key,
        "num": numeric,
        "abbr": term,
        "name": f"%{term}%",
    }

    with extensions.engine.connect() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT d.driver_number, d.abbreviation, d.full_name, d.team_name
                    FROM drivers d
                    WHERE d.session_key = :sk
                      AND (
                        d.driver_number = :num
                        OR d.abbreviation ILIKE :abbr
                        OR d.full_name ILIKE :name
                      )
                    ORDER BY d.driver_number
                    LIMIT 1
                    """
                ),
                params,
            )
            .mappings()
            .first()
        )

    if row is None:
        raise types.NotFoundError(
            f"Driver '{inp.name_or_abbreviation}' not found in session {inp.session_key}"
        )

    return types.ResolvedDriver(
        driver_number=row["driver_number"],
        abbreviation=row["abbreviation"],
        full_name=row["full_name"],
        team_name=row["team_name"],
    )


def _derive_pit_stops(laps: list[dict]) -> list[types.PitStop]:
    """
    Derive pit stops from a list of lap dictionaries.
    """
    stops: list[types.PitStop] = []
    for i, lap in enumerate(laps):
        if lap["pit_in_time_ms"] is None:
            continue

        pit_in_lap = lap["lap_number"]

        pit_out_lap = None
        for following in laps[i + 1 :]:
            if following["pit_out_time_ms"] is not None:
                pit_out_lap = following["lap_number"]
                break
        if pit_out_lap is None:
            pit_out_lap = pit_in_lap + 1

        compound_before = next(
            (p["compound"] for p in reversed(laps[:i]) if p["compound"]), None
        )
        compound_after = next(
            (p["compound"] for p in laps[i + 1 :] if p["compound"]), None
        )

        stops.append(
            types.PitStop(
                stop_index=len(stops) + 1,
                pit_in_lap=pit_in_lap,
                pit_out_lap=pit_out_lap,
                compound_before=compound_before,
                compound_after=compound_after,
            )
        )
    return stops


def find_pit_stops(inp: types.FindPitStopsInput) -> types.PitStopsResult:
    """Detect pit stops for one driver in one session."""
    with extensions.engine.connect() as conn:
        rows = (
            conn.execute(
                text("""
                    SELECT lap_number, pit_in_time_ms, pit_out_time_ms, compound
                    FROM lap_times
                    WHERE session_key = :sk
                      AND driver_number = :dn
                      AND deleted = FALSE
                    ORDER BY lap_number ASC
                """),
                {"sk": inp.session_key, "dn": inp.driver_number},
            )
            .mappings()
            .all()
        )

    stops = _derive_pit_stops([dict(r) for r in rows])
    return types.PitStopsResult(driver_number=inp.driver_number, pit_stops=tuple(stops))


def get_lap_telemetry_artifacts(
    inp: types.GetLapTelemetryArtifactsInput,
) -> types.LapTelemetryResult:
    """
    Return artifact metadata (not raw samples) for the requested laps.
    This proves telemetry exists before we compute speed from it.
    """
    if not inp.lap_numbers:
        raise types.DataError("lap_numbers is required to load telemetry artifacts")

    with extensions.engine.connect() as conn:
        rows = (
            conn.execute(
                text("""
                    SELECT
                        session_key, driver_number, lap_number,
                        storage_key, storage_backend, format,
                        sample_count, size_bytes, checksum_sha256
                    FROM telemetry_artifacts
                    WHERE session_key = :sk
                      AND driver_number = :dn
                      AND lap_number = ANY(:laps)
                    ORDER BY lap_number ASC
                """),
                {
                    "sk": inp.session_key,
                    "dn": inp.driver_number,
                    "laps": list(inp.lap_numbers),
                },
            )
            .mappings()
            .all()
        )

    artifacts = tuple(types.TelemetryArtifact(**dict(r)) for r in rows)
    return types.LapTelemetryResult(
        session_key=inp.session_key,
        driver_number=inp.driver_number,
        artifacts=artifacts,
    )
