"""race_digest against the test database."""

import pytest
from sqlalchemy import text

from backend.analyst.digest import race_digest
from backend.analyst.prepare import Plan
from backend.analyst.sandbox import Workspace
from backend.analyst.tools import ToolBox

SK = 99983
SESSION = {
    "session_key": SK,
    "year": 2026,
    "gp_name": "Digest Grand Prix",
    "session_type": "R",
}
DRIVERS = ((44, "Lewis Hamilton", "HAM"), (63, "George Russell", "RUS"))
# driver, lap, time in ms, position
LAPS = (
    (44, 1, 96000, 2),
    (44, 2, 95500, 1),
    (63, 1, 95000, 1),
    (63, 2, 95800, 2),
)


@pytest.fixture()
def box(db_engine):
    with db_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO sessions (session_key, year, gp_name, session_type, "
                "session_name) VALUES (:sk, 2026, 'Digest Grand Prix', 'R', 'Race')"
            ),
            {"sk": SK},
        )
        for number, name, code in DRIVERS:
            conn.execute(
                text(
                    "INSERT INTO drivers (driver_number, session_key, full_name, "
                    "abbreviation, team_name) VALUES (:n, :sk, :name, :code, 'Team')"
                ),
                {"n": number, "sk": SK, "name": name, "code": code},
            )
        for number, lap, ms, position in LAPS:
            conn.execute(
                text(
                    "INSERT INTO lap_times (session_key, driver_number, lap_number, "
                    "lap_time_ms, position, compound, deleted, is_personal_best, "
                    "recorded_at) VALUES (:sk, :n, :lap, :ms, :pos, 'SOFT', false, "
                    "false, NOW())"
                ),
                {"sk": SK, "n": number, "lap": lap, "ms": ms, "pos": position},
            )
    workspace = Workspace()
    yield ToolBox(workspace, sandbox=None, conn_factory=db_engine.connect)
    workspace.cleanup()
    with db_engine.begin() as conn:
        for table in ("lap_times", "drivers", "sessions"):
            conn.execute(
                text(f"DELETE FROM {table} WHERE session_key = :sk"), {"sk": SK}
            )


def test_digest_states_the_facts_for_the_asked_driver(box):
    plan = Plan("result", 2026, "Digest", "R", ("Hamilton",))
    digest = race_digest("Where was Hamilton on lap 1?", plan, SESSION, box)
    assert "Winner: Lewis Hamilton (HAM)." in digest
    assert "Fastest lap of the race: George Russell (RUS), 95.000 s on lap 1." in digest
    assert "Lewis Hamilton (HAM) fastest lap: 95.500 s on lap 2." in digest
    assert "Leader on lap 1: George Russell (RUS)." in digest
    assert "Lap 1: Lewis Hamilton (HAM) was P2, lap time 96.000 s." in digest
    assert "George Russell (RUS) tyres" not in digest  # not asked about
    assert "behind" not in digest  # a gap needs two drivers


def test_digest_computes_the_gap_between_two_drivers(box):
    plan = Plan("result", 2026, "Digest", "R", ("Hamilton", "Russell"))
    digest = race_digest("What was the gap at the end?", plan, SESSION, box)
    assert (
        "At the end of lap 2, Lewis Hamilton (HAM) was 0.700 s behind "
        "George Russell (RUS)."
    ) in digest
