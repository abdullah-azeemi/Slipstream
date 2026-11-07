"""Toolbox tests: real (test) database, stubbed sandbox and telemetry reader."""

import json

import pytest
from sqlalchemy import text

from backend.analyst.sandbox import SandboxResult, Workspace
from backend.analyst.tools import ToolBox, describe_call, parse_args

SK = 99972


class FakeSandbox:
    def __init__(self, result=None):
        self.result = result or SandboxResult(True, "42\n", "", 0.5)
        self.codes = []

    def run(self, code, workspace, *, timeout_s=20):
        self.codes.append(code)
        return self.result


@pytest.fixture()
def seeded(db_engine):
    with db_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO sessions (session_key, year, gp_name, session_type, session_name) "
                "VALUES (:sk, 2026, 'Toolbox Grand Prix', 'R', 'Race')"
            ),
            {"sk": SK},
        )
        conn.execute(
            text(
                "INSERT INTO drivers (driver_number, session_key, full_name, abbreviation, team_name) VALUES (44, :sk, 'Lewis Hamilton', 'HAM', 'Ferrari')"
            ),
            {"sk": SK},
        )
        for lap in (1, 2, 3):
            conn.execute(
                text(
                    "INSERT INTO lap_times (session_key, driver_number, lap_number, lap_time_ms, "
                    "deleted, is_personal_best, recorded_at) VALUES (:sk, 44, :lap, 95000, false, false, NOW())"
                ),
                {"sk": SK, "lap": lap},
            )
    yield
    with db_engine.begin() as conn:
        for table in ("lap_times", "drivers", "sessions"):
            conn.execute(
                text(f"DELETE FROM {table} WHERE session_key = :sk"), {"sk": SK}
            )


@pytest.fixture()
def box(db_engine):
    workspace = Workspace()
    yield ToolBox(
        workspace,
        FakeSandbox(),
        conn_factory=db_engine.connect,
        telemetry_reader=lambda sk, drv, lap: [
            {
                "distance_m": 0.0,
                "speed_kmh": 250.0,
                "brake": False,
                "gear": 6,
                "drs": 0,
                "x_pos": 0.0,
                "y_pos": 0.0,
            },
            {
                "distance_m": 10.0,
                "speed_kmh": 252.0,
                "brake": False,
                "gear": 6,
                "drs": 0,
                "x_pos": 100.0,
                "y_pos": 0.0,
            },
        ],
    )
    workspace.cleanup()


def test_find_sessions_lists_coverage(seeded, box):
    out = box.call("find_sessions", {"gp": "Toolbox", "year": 2026})
    assert out.ok and f"session_key={SK}" in out.text and "laps=3" in out.text


def test_find_sessions_without_match_is_a_failure(seeded, box):
    assert not box.call("find_sessions", {"gp": "Nowhere"}).ok


def test_load_laps_stages_files_and_describes_conventions(seeded, box):
    out = box.call("load_laps", {"session_key": SK, "driver": "ham"})
    assert (
        out.ok
        and "race length 3" in out.text
        and "lap_time_ms is milliseconds" in out.text
    )
    staged = json.loads((box.workspace.data / f"laps_{SK}_44.json").read_text())
    assert [lap["lap_number"] for lap in staged] == [1, 2, 3]
    assert (box.workspace.data / f"drivers_{SK}.json").exists()


def test_load_laps_unknown_driver_lists_the_roster(seeded, box):
    out = box.call("load_laps", {"session_key": SK, "driver": "Senna"})
    assert not out.ok and "HAM" in out.text


def test_load_telemetry_warns_about_missing_throttle(seeded, box):
    out = box.call("load_telemetry", {"session_key": SK, "driver": "HAM", "lap": 5})
    assert out.ok and "throttle_missing" in out.text
    assert (box.workspace.data / f"telemetry_{SK}_44_5.json").exists()


def test_load_context_reports_missing_data_honestly(seeded, box):
    out = box.call("load_context", {"session_key": SK})
    assert out.ok and "NO DATA" in out.text


def test_run_python_wraps_the_sandbox_result(box):
    out = box.call("run_python", {"code": "# Fit degradation\nprint(42)"})
    assert out.ok and out.title == "Fit degradation" and "42" in out.text
    assert box.sandbox.codes == ["# Fit degradation\nprint(42)"]


def test_failed_sandbox_run_is_not_ok(db_engine):
    workspace = Workspace()
    box = ToolBox(
        workspace,
        FakeSandbox(SandboxResult(False, "", "Traceback ... ZeroDivisionError", 0.1)),
        conn_factory=db_engine.connect,
    )
    out = box.call("run_python", {"code": "1/0"})
    assert not out.ok and "ZeroDivisionError" in out.text
    workspace.cleanup()


def test_unknown_tool_and_bad_arguments_do_not_raise(box):
    assert not box.call("rm_rf", {}).ok
    assert not box.call("load_laps", {"wrong": 1}).ok


def test_tool_text_is_clipped(box):
    box.sandbox.result = SandboxResult(True, "y" * 5000, "", 0.1)
    assert len(box.call("run_python", {"code": "print()"}).text) < 4000


def test_parse_args_and_describe_call():
    assert (
        parse_args("{bad") == {}
        and parse_args("[1]") == {}
        and parse_args('{"a": 1}') == {"a": 1}
    )
    assert (
        describe_call("load_telemetry", {"driver": "HAM", "lap": 20})[0]
        == "Telemetry · HAM L20"
    )
    assert describe_call("run_python", {"code": "print(1)"})[0] == "Compute"
