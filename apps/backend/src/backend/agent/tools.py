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
