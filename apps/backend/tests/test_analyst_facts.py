"""gather_facts against the test database."""

from datetime import date

import pytest
from sqlalchemy import text
from backend.analyst.facts import gather_facts
from backend.analyst.prepare import Plan
from backend.analyst.sandbox import Workspace
from backend.analyst.tools import ToolBox

RACE, QUALI = 99981, 99982


@pytest.fixture()
def box(db_engine):
    with db_engine.begin() as conn:
        for sk, st in ((RACE, "R"), (QUALI, "Q")):
            conn.execute(
                text(
                    "INSERT INTO sessions (session_key, year, gp_name, session_type, "
                    "session_name) VALUES (:sk, 2026, 'Facts Grand Prix', :st, :st)"
                ),
                {"sk": sk, "st": st},
            )
        conn.execute(
            text(
                "INSERT INTO drivers (driver_number, session_key, full_name, "
                "abbreviation, team_name) VALUES (44, :sk, 'Lewis Hamilton', 'HAM', 'Ferrari')"
            ),
            {"sk": RACE},
        )
        for lap in (1, 2, 3):
            conn.execute(
                text(
                    "INSERT INTO lap_times (session_key, driver_number, lap_number, "
                    "lap_time_ms, deleted, is_personal_best, recorded_at) "
                    "VALUES (:sk, 44, :lap, 95000, false, false, NOW())"
                ),
                {"sk": RACE, "lap": lap},
            )
    workspace = Workspace()
    yield ToolBox(workspace, sandbox=None, conn_factory=db_engine.connect)
    workspace.cleanup()
    with db_engine.begin() as conn:
        for table in ("lap_times", "drivers", "sessions"):
            conn.execute(
                text(f"DELETE FROM {table} WHERE session_key IN (:a, :b)"),
                {"a": RACE, "b": QUALI},
            )


def plan(**kw):
    return Plan(**{"category": "result", "year": 2026, "gp": "Facts", **kw})


def test_preloads_the_race(box):
    facts = gather_facts(plan(drivers=("Hamilton",)), box)
    assert facts.missing is None
    assert facts.session["session_key"] == RACE
    assert [c.tool for c in facts.calls] == [
        "race_summary",
        "load_context",
        "load_laps",
    ]
    assert all(c.output.ok for c in facts.calls)


@pytest.mark.parametrize(
    ("kw", "expected"),
    [
        ({"session_type": "Q"}, "No lap data"),
        ({"drivers": ("Senna",)}, "Senna did not take part"),
        ({"year": 2027}, "has not happened"),
        ({"category": "out_of_scope", "year": None, "gp": None}, "cannot be answered"),
    ],
)
def test_refuses_on_clear_evidence(box, kw, expected):
    facts = gather_facts(plan(**kw), box, today=date(2026, 11, 28))
    assert expected in facts.missing
    assert facts.calls == []


@pytest.mark.parametrize(
    "kw", [{"category": "unknown"}, {"gp": "Nowhere"}, {"year": None}]
)
def test_unsure_cases_leave_it_to_the_agent(box, kw):
    facts = gather_facts(plan(**kw), box)
    assert facts.missing is None
    assert facts.calls == []
