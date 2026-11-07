"""Sandbox tests against the real Docker image. Skipped when it is not built:
docker build -t pitwall-sandbox infra/sandbox
"""

import pytest

from backend.analyst.sandbox import DockerSandbox, Workspace

pytestmark = pytest.mark.skipif(
    not DockerSandbox.available(), reason="pitwall-sandbox image not available"
)


@pytest.fixture()
def ws():
    workspace = Workspace()
    yield workspace
    workspace.cleanup()


def _run(ws, code, timeout_s=30):
    return DockerSandbox().run(code, ws, timeout_s=timeout_s)


def test_runs_code_and_returns_stdout(ws):
    result = _run(ws, "print(2 + 2)")
    assert result.ok and result.stdout.strip() == "4"


def test_reads_staged_data_with_helpers(ws):
    ws.write_json("laps.json", [{"lap": 1, "t": 95.0}, {"lap": 2, "t": 94.0}])
    result = _run(ws, "print(df('laps.json')['t'].mean())")
    assert result.ok and result.stdout.strip() == "94.5"


def test_f1lab_is_importable_but_database_code_is_not(ws):
    ok = _run(ws, "from backend.f1lab.pace import fit_degradation\nprint('f1lab ok')")
    assert ok.ok and "f1lab ok" in ok.stdout
    bad = _run(ws, "import backend.f1lab.data")
    assert not bad.ok and "ModuleNotFoundError" in bad.stderr


def test_emit_chart_is_collected(ws):
    result = _run(
        ws, "emit_chart({'series': [{'type': 'line', 'data': [1, 2]}]}, 'Pace')"
    )
    assert result.ok
    assert result.charts == [
        {"title": "Pace", "option": {"series": [{"type": "line", "data": [1, 2]}]}}
    ]


def test_python_errors_are_reported_not_raised(ws):
    result = _run(ws, "1/0")
    assert not result.ok and "ZeroDivisionError" in result.stderr


def test_no_network(ws):
    result = _run(
        ws,
        "import socket\ns = socket.socket()\ns.settimeout(3)\ns.connect(('1.1.1.1', 80))",
    )
    assert not result.ok


def test_scripts_can_save_files_in_data_but_not_elsewhere(ws):
    ws.write_json("x.json", [1])
    saved = _run(ws, "open('notes.json', 'w').write('[2]')\nprint(load('notes.json'))")
    assert saved.ok and saved.stdout.strip() == "[2]"
    assert (ws.data / "notes.json").exists()
    assert not _run(ws, "open('/etc/evil', 'w').write('x')").ok
    assert not _run(ws, "open('/pylib/evil.py', 'w').write('x')").ok


def test_relative_paths_resolve_inside_the_data_dir(ws):
    ws.write_json("laps.json", [{"a": 1}])
    assert _run(ws, "print(len(open('laps.json').read()) > 0)").stdout.strip() == "True"


def test_infinite_loop_times_out(ws):
    result = _run(ws, "while True:\n    pass", timeout_s=3)
    assert result.timed_out and not result.ok


def test_output_is_truncated(ws):
    result = _run(ws, "print('x' * 50000)")
    assert result.ok and len(result.stdout) < 7000 and "truncated" in result.stdout


def test_replayed_earlier_steps_keep_variables_without_repeating_output_or_charts(ws):
    from backend.analyst.tools import ToolBox

    box = ToolBox(ws, DockerSandbox())
    first = box.call(
        "run_python",
        {"code": "total = 41\nprint('first')\nemit_chart({'series': []}, 'one')"},
    )
    second = box.call("run_python", {"code": "print(total + 1)"})
    assert first.ok and len(first.charts) == 1
    assert second.ok and second.text.count("first") == 0 and "42" in second.text
    assert second.charts == []
