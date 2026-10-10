import pytest

from ingestion import auto_ingest
from ingestion.auto_ingest import sessions_for_event


def test_sessions_for_conventional_event():
    sessions = sessions_for_event({"event_format": "conventional"})

    assert [session_type for session_type, _ in sessions] == [
        "FP1",
        "FP2",
        "FP3",
        "Q",
        "R",
    ]


def test_sessions_for_sprint_event():
    sessions = sessions_for_event({"event_format": "sprint"})

    assert [session_type for session_type, _ in sessions] == [
        "FP1",
        "Q",
        "SQ",
        "SS",
        "R",
    ]


def test_main_writes_new_session_output(monkeypatch, tmp_path):
    output_file = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setattr(auto_ingest, "run_once", lambda: True)

    auto_ingest.main()

    assert output_file.read_text() == "new_sessions=true\n"


def test_run_once_fails_when_completed_session_ingestion_fails(monkeypatch):
    class Result:
        def scalar(self):
            return True

    class Connection:
        closed = False
        statements = []

        def execute(self, statement, _params):
            self.statements.append(str(statement))
            return Result()

        def close(self):
            self.closed = True

    class Engine:
        def __init__(self):
            self.connection = Connection()
            self.disposed = False

        def connect(self):
            return self.connection

        def dispose(self):
            self.disposed = True

    engine = Engine()
    monkeypatch.setattr(auto_ingest, "create_engine", lambda _url: engine)
    monkeypatch.setattr(auto_ingest, "get_ingested_sessions", lambda _engine: set())
    monkeypatch.setattr(
        auto_ingest,
        "get_fastf1_schedule",
        lambda _year: [{"gp_name": "Test Grand Prix", "event_format": "conventional"}],
    )
    monkeypatch.setattr(
        auto_ingest, "sessions_for_event", lambda _event: [("R", False)]
    )
    monkeypatch.setattr(
        auto_ingest, "session_has_completed", lambda _year, _event, _session: True
    )
    monkeypatch.setattr(
        auto_ingest, "ingest_session", lambda _year, _gp, _session: False
    )

    with pytest.raises(RuntimeError, match="Failed to ingest 1 completed session"):
        auto_ingest.run_once()

    assert engine.connection.closed
    assert engine.disposed
    assert any("pg_advisory_unlock" in query for query in engine.connection.statements)
