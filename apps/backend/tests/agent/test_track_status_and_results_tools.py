"""fetch_track_status / fetch_session_results read the 0026 tables."""

import pytest
from sqlalchemy import text

from backend.agent import orchestrator, planner, tools, types

SK = 89001

_DDL = [
    """CREATE TABLE IF NOT EXISTS session_results (
        session_key INTEGER NOT NULL REFERENCES sessions(session_key),
        driver_number INTEGER NOT NULL, abbreviation TEXT, team_name TEXT,
        grid_position INTEGER, position INTEGER, classified_position TEXT,
        status TEXT, points DOUBLE PRECISION, laps_completed INTEGER,
        race_time_ms DOUBLE PRECISION, q1_ms DOUBLE PRECISION,
        q2_ms DOUBLE PRECISION, q3_ms DOUBLE PRECISION,
        PRIMARY KEY (session_key, driver_number))""",
    """CREATE TABLE IF NOT EXISTS track_status_periods (
        id SERIAL PRIMARY KEY,
        session_key INTEGER NOT NULL REFERENCES sessions(session_key),
        status_code TEXT NOT NULL, status_label TEXT NOT NULL,
        start_ms DOUBLE PRECISION NOT NULL, end_ms DOUBLE PRECISION,
        start_lap INTEGER, end_lap INTEGER)""",
]


@pytest.fixture
def seeded(app, db_engine):
    with db_engine.begin() as conn:
        for ddl in _DDL:
            conn.execute(text(ddl))
        conn.execute(
            text(
                "INSERT INTO sessions (session_key, year, gp_name, session_type, session_name) "
                "VALUES (:sk, 2099, 'Test Grand Prix', 'R', 'Race') ON CONFLICT DO NOTHING"
            ),
            {"sk": SK},
        )
        conn.execute(
            text(
                """INSERT INTO track_status_periods
                   (session_key, status_code, status_label, start_ms, end_ms, start_lap, end_lap)
                   VALUES (:sk,'1','AllClear',0,100,1,10),
                          (:sk,'4','SafetyCar',100,200,10,14),
                          (:sk,'1','AllClear',200,300,14,30),
                          (:sk,'6','VirtualSafetyCar',300,NULL,30,NULL)"""
            ),
            {"sk": SK},
        )
        conn.execute(
            text(
                """INSERT INTO session_results
                   (session_key, driver_number, abbreviation, grid_position, position, status, points)
                   VALUES (:sk,1,'VER',3,1,'Finished',25),
                          (:sk,44,'HAM',1,NULL,'Collision',0)"""
            ),
            {"sk": SK},
        )
    yield
    with db_engine.begin() as conn:
        conn.execute(text("DELETE FROM track_status_periods WHERE session_key=:sk"), {"sk": SK})
        conn.execute(text("DELETE FROM session_results WHERE session_key=:sk"), {"sk": SK})
        conn.execute(text("DELETE FROM sessions WHERE session_key=:sk"), {"sk": SK})


def test_track_status_counts_each_kind(seeded):
    res = tools.fetch_track_status(types.TrackStatusInput(session_key=SK))
    assert (res.safety_car_periods, res.vsc_periods, res.red_flag_periods) == (1, 1, 0)
    assert len(res.periods) == 4 and res.periods[-1].end_ms is None


def test_track_status_lap_window_filters_overlap(seeded):
    res = tools.fetch_track_status(types.TrackStatusInput(session_key=SK, from_lap=11, to_lap=13))
    assert [p.status_label for p in res.periods] == ["SafetyCar"]


def test_session_results_orders_and_computes_gain(seeded):
    res = tools.fetch_session_results(types.SessionResultsInput(session_key=SK))
    assert [e.abbreviation for e in res.entries] == ["VER", "HAM"]  # NULL position last
    assert res.entries[0].positions_gained == 2  # P3 -> P1
    assert res.entries[1].positions_gained is None  # DNF has no finishing position
    one = tools.fetch_session_results(types.SessionResultsInput(session_key=SK, driver_number=44))
    assert len(one.entries) == 1 and one.entries[0].status == "Collision"


def test_tools_are_registered_for_planner_and_executor():
    for name in (types.ToolName.FETCH_TRACK_STATUS, types.ToolName.FETCH_SESSION_RESULTS):
        assert name.value in planner.TOOL_REGISTRY
        assert name in orchestrator._TOOLS
        assert name in orchestrator._BINDERS
