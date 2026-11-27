"""Look up the data a question needs with code, before the model runs.

The Plan from prepare names a race, session and drivers. This module finds that
session, checks the data exists, and runs the first loaders itself, so the model
does not spend turns on it.
"""

from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from sqlalchemy import text
from backend.analyst.prepare import Plan
from backend.analyst.tools import ToolBox, ToolOutput
from backend.f1lab import data


@dataclass(frozen=True)
class PreCall:
    """A tool call that code made for the model."""

    tool: str
    args: dict
    output: ToolOutput


@dataclass
class Facts:
    session: dict | None = None
    missing: str | None = None
    calls: list[PreCall] = field(default_factory=list)


_SESSION_SQL = text(
    """
        SELECT s.session_key, s.year, s.gp_name, s.session_type,
            (SELECT count(*) FROM lap_times l WHERE l.session_key = s.session_key) AS laps,
            (SELECT count(*) FROM telemetry_artifacts t
                WHERE t.session_key = s.session_key) AS telemetry_laps
        FROM sessions s
        WHERE s.year = :year AND s.gp_name ILIKE :gp AND s.session_type = :st
        ORDER BY s.session_key DESC
        LIMIT 1
    """
)


def _find_session(
    toolbox: ToolBox, year: int, gp: str, session_type: str
) -> dict | None:
    with toolbox.conn_factory() as conn:
        row = (
            conn.execute(
                _SESSION_SQL, {"year": year, "gp": f"%{gp}%", "st": session_type}
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def _missing_drivers(
    toolbox: ToolBox, session_key: int, drivers: tuple[str, ...]
) -> list[str]:
    with toolbox.conn_factory() as conn:
        return [
            name
            for name in drivers
            if data.resolve_driver_number(conn, session_key, name) is None
        ]


def gather_facts(
    plan: Plan, toolbox: ToolBox, today: date | None = None, preload: bool = True
) -> Facts:
    """Refuse only on clear evidence. When unsure, return no facts: the agent searches."""
    today = today or date.today()
    if plan.year is not None and plan.year > today.year:
        return Facts(
            missing=f"{plan.year} has not happened yet, so there is no data for it."
        )
    if plan.category == "out_of_scope":
        return Facts(
            missing="This question cannot be answered from past F1 session data."
        )
    if plan.year is None or plan.gp is None:
        return Facts()

    session = _find_session(toolbox, plan.year, plan.gp, plan.session_type or "R")
    if session is None:
        return Facts()
    label = f"the {session['year']} {session['gp_name']} ({session['session_type']})"
    if session["laps"] == 0:
        return Facts(session, missing=f"No lap data is stored for {label}.")
    if plan.category == "telemetry" and session["telemetry_laps"] == 0:
        return Facts(session, missing=f"No telemetry is stored for {label}.")
    absent = _missing_drivers(toolbox, session["session_key"], plan.drivers)
    if absent:
        return Facts(
            session, missing=f"{', '.join(absent)} did not take part in {label}."
        )

    if not preload:
        return Facts(session)

    key = session["session_key"]
    wanted: list[tuple[str, dict]] = [("load_context", {"session_key": key})]
    if session["session_type"] == "R":
        wanted.insert(0, ("race_summary", {"session_key": key}))
    wanted += [("load_laps", {"session_key": key, "driver": d}) for d in plan.drivers]

    with ThreadPoolExecutor(max_workers=len(wanted)) as pool:
        outputs = list(pool.map(lambda w: toolbox.call(*w), wanted))
    calls = [PreCall(tool, args, out) for (tool, args), out in zip(wanted, outputs)]
    return Facts(session, calls=calls)
