"""Integration tests for the agent HTTP endpoint (L6)."""

import gzip
import json
from pathlib import Path

from sqlalchemy import text

from backend import auth as auth_module
from backend.agent import orchestrator
from backend.config import settings

SESSION_KEY = 99993

# Any non-empty bearer passes the header check; _fake_auth mocks the verifier.
AUTH_HEADER = {"Authorization": "Bearer test-token"}


def _insert_session_and_driver(db_engine):
    with db_engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO sessions (
                    session_key, year, gp_name, session_type, session_name
                ) VALUES (
                    :sk, 2026, 'Monaco Grand Prix', 'R', 'Race'
                )
                """
            ),
            {"sk": SESSION_KEY},
        )
        conn.execute(
            text(
                """
                INSERT INTO drivers (
                    driver_number, session_key, full_name, abbreviation, team_name, team_colour
                ) VALUES (
                    55, :sk, 'Carlos Sainz', 'SAI', 'Ferrari', '#DC0000'
                )
                """
            ),
            {"sk": SESSION_KEY},
        )


def _insert_laps(db_engine):
    """Laps 1-8; pit stop on lap 5 (pit_in) / lap 6 (pit_out), SOFT -> HARD."""
    with db_engine.begin() as conn:
        for lap, compound, pit_in, pit_out in [
            (1, "SOFT", None, None),
            (2, "SOFT", None, None),
            (3, "SOFT", None, None),
            (4, "SOFT", None, None),
            (5, "SOFT", 123456.0, None),
            (6, "HARD", None, 234567.0),
            (7, "HARD", None, None),
            (8, "HARD", None, None),
        ]:
            conn.execute(
                text(
                    """
                    INSERT INTO lap_times (
                        session_key, driver_number, lap_number, lap_time_ms,
                        compound, pit_in_time_ms, pit_out_time_ms,
                        is_personal_best, deleted, recorded_at
                    ) VALUES (
                        :sk, 55, :lap, 100000, :compound, :pit_in, :pit_out,
                        false, false, NOW()
                    )
                    """
                ),
                {
                    "sk": SESSION_KEY,
                    "lap": lap,
                    "compound": compound,
                    "pit_in": pit_in,
                    "pit_out": pit_out,
                },
            )


def _write_gz_artifact(tmp_path, lap_number, speeds):
    storage_key = f"telemetry/session_{SESSION_KEY}/driver_55/lap_{lap_number}.json.gz"
    path = Path(tmp_path) / storage_key
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = [{"speed_kmh": s} for s in speeds]
    with gzip.open(path, "wb") as f:
        f.write(
            json.dumps(
                {
                    "session_key": SESSION_KEY,
                    "driver_number": 55,
                    "lap_number": lap_number,
                    "samples": samples,
                }
            ).encode("utf-8")
        )
    with path.open("rb") as f:
        size = len(f.read())
    return storage_key, size


def _insert_artifacts(db_engine, tmp_path):
    """Artifacts for the before window (2,3,4) and after window (7,8,9)."""
    entries = []
    for lap_number, speeds in [
        (2, [200.0, 210.0]),
        (3, [210.0, 220.0]),
        (4, [220.0, 230.0]),
        (7, [240.0, 250.0]),
        (8, [250.0, 260.0]),
        (9, [260.0, 270.0]),
    ]:
        storage_key, size = _write_gz_artifact(tmp_path, lap_number, speeds)
        entries.append((lap_number, storage_key, size, len(speeds)))
    with db_engine.begin() as conn:
        for lap_number, storage_key, size, count in entries:
            conn.execute(
                text(
                    """
                    INSERT INTO telemetry_artifacts (
                        session_key, driver_number, lap_number,
                        storage_key, storage_backend, format,
                        sample_count, size_bytes, checksum_sha256
                    ) VALUES (
                        :sk, 55, :lap, :key, 'local', 'json.gz', :count, :size, 'test'
                    )
                    """
                ),
                {
                    "sk": SESSION_KEY,
                    "lap": lap_number,
                    "key": storage_key,
                    "count": count,
                    "size": size,
                },
            )


def _cleanup(db_engine):
    with db_engine.begin() as conn:
        conn.execute(
            text(
                """
                DELETE FROM agent_tool_calls
                WHERE run_id IN (
                    SELECT id FROM agent_runs
                    WHERE user_id IN (
                        SELECT id FROM users WHERE clerk_user_id IN ('demo-user', 'user_alpha', 'user_beta')
                    )
                )
                """
            )
        )
        conn.execute(
            text(
                """
                DELETE FROM agent_runs
                WHERE user_id IN (
                    SELECT id FROM users WHERE clerk_user_id IN ('demo-user', 'user_alpha', 'user_beta')
                )
                """
            )
        )
        conn.execute(
            text(
                "DELETE FROM users WHERE clerk_user_id IN ('demo-user', 'user_alpha', 'user_beta')"
            )
        )
        conn.execute(
            text("DELETE FROM telemetry_artifacts WHERE session_key = :sk"),
            {"sk": SESSION_KEY},
        )
        conn.execute(
            text("DELETE FROM lap_times WHERE session_key = :sk"), {"sk": SESSION_KEY}
        )
        conn.execute(
            text("DELETE FROM drivers WHERE session_key = :sk"), {"sk": SESSION_KEY}
        )
        conn.execute(
            text("DELETE FROM sessions WHERE session_key = :sk"), {"sk": SESSION_KEY}
        )


def _fake_llm(monkeypatch, intent):
    monkeypatch.setattr(
        orchestrator.llm,
        "route_question",
        lambda q: orchestrator.types.RoutedQuestion(
            intent=orchestrator.types.Intent(intent),
            driver_name="Sainz",
            year=2026,
            gp_name="Monaco",
        ),
    )
    monkeypatch.setattr(
        orchestrator.llm,
        "compose_answer",
        lambda q, e: "Sainz pitted across laps 5 and 6.",
    )


def _fake_auth(monkeypatch, clerk_user_id="demo-user"):
    """Replace JWKS verification with a stub identity."""
    monkeypatch.setattr(
        auth_module, "verify_session_token", lambda token: clerk_user_id
    )


def _fake_bad_auth(monkeypatch):
    def boom(token):
        raise auth_module.ClerkAuthError("signature verification failed")

    monkeypatch.setattr(auth_module, "verify_session_token", boom)


def test_agent_query_happy_path(app, client, db_engine, monkeypatch, tmp_path):
    _fake_auth(monkeypatch)
    _insert_session_and_driver(db_engine)
    _insert_laps(db_engine)
    _insert_artifacts(db_engine, tmp_path)
    monkeypatch.setattr(settings, "telemetry_artifact_dir", str(tmp_path))
    _fake_llm(monkeypatch, "pit_stop_speed_delta")

    try:
        resp = client.post(
            "/api/v1/agent/query",
            headers=AUTH_HEADER,
            json={
                "question": "On which lap did Sainz pit and what was his avg speed before and after?"
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["intent"] == "pit_stop_speed_delta"
        assert body["refusals"] == []
        assert body["pit_stop"]["pit_in_lap"] == 5
        assert body["pit_stop"]["pit_out_lap"] == 6
        assert body["speed_window"]["before_avg_speed_kmh"] == 215.0
        assert body["speed_window"]["after_avg_speed_kmh"] == 255.0
        assert body["speed_window"]["delta_kmh"] == 40.0
        assert len(body["trace"]) == 6
        assert body["trace"][0]["tool_name"] == "resolve_session"
        assert body["trace"][0]["status"] == "ok"
    finally:
        _cleanup(db_engine)


def test_agent_query_missing_question(client, monkeypatch):
    _fake_auth(monkeypatch)
    resp = client.post("/api/v1/agent/query", headers=AUTH_HEADER, json={})
    assert resp.status_code == 400
    assert "question" in resp.get_json()["error"]


def test_agent_query_unsupported(client, monkeypatch):
    _fake_auth(monkeypatch)
    _fake_llm(monkeypatch, "unsupported")
    resp = client.post(
        "/api/v1/agent/query",
        headers=AUTH_HEADER,
        json={"question": "What is the weather?"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["intent"] == "unsupported"
    assert body["refusals"] == ["unsupported question"]


def test_agent_query_persists_run_and_tool_calls(
    app, client, db_engine, monkeypatch, tmp_path
):
    _fake_auth(monkeypatch)
    _insert_session_and_driver(db_engine)
    _insert_laps(db_engine)
    _insert_artifacts(db_engine, tmp_path)
    monkeypatch.setattr(settings, "telemetry_artifact_dir", str(tmp_path))
    _fake_llm(monkeypatch, "pit_stop_speed_delta")

    try:
        resp = client.post(
            "/api/v1/agent/query",
            headers=AUTH_HEADER,
            json={
                "question": "On which lap did Sainz pit and what was his avg speed before and after?"
            },
        )
        assert resp.status_code == 200

        with db_engine.connect() as conn:
            run = conn.execute(
                text(
                    """
                    SELECT r.status, r.error, r.completed_at IS NOT NULL AS has_completed,
                           COUNT(t.id) AS tool_count
                    FROM agent_runs r
                    LEFT JOIN agent_tool_calls t ON t.run_id = r.id
                    GROUP BY r.id
                    ORDER BY r.id DESC
                    LIMIT 1
                    """
                )
            ).first()
            assert run is not None
            assert run.status == "completed"
            assert run.error is None
            assert run.has_completed
            assert run.tool_count == 6

            call = conn.execute(
                text(
                    """
                    SELECT tool_name, status, duration_ms, input_json, output_summary_json
                    FROM agent_tool_calls
                    ORDER BY id ASC
                    LIMIT 1
                    """
                )
            ).first()
            assert call.tool_name == "resolve_session"
            assert call.status == "ok"
            assert call.duration_ms is not None
            assert call.input_json["summary"]
            assert call.output_summary_json["summary"]
    finally:
        _cleanup(db_engine)


def test_agent_query_persists_refused_run(client, db_engine, monkeypatch):
    _fake_auth(monkeypatch)
    _fake_llm(monkeypatch, "unsupported")
    resp = client.post(
        "/api/v1/agent/query",
        headers=AUTH_HEADER,
        json={"question": "What is the weather?"},
    )
    assert resp.status_code == 200

    with db_engine.connect() as conn:
        row = conn.execute(
            text("SELECT status, error FROM agent_runs ORDER BY id DESC LIMIT 1")
        ).first()
        assert row is not None
        assert row.status == "refused"
        assert row.error == "unsupported question"

    _cleanup(db_engine)


def test_agent_query_daily_limit_blocks_immediately(client, monkeypatch):
    _fake_auth(monkeypatch)
    monkeypatch.setattr(settings, "agent_free_daily_limit", 0)
    _fake_llm(monkeypatch, "pit_stop_speed_delta")

    resp = client.post(
        "/api/v1/agent/query", headers=AUTH_HEADER, json={"question": "Who won?"}
    )
    assert resp.status_code == 429
    assert "limit" in resp.get_json()["error"].lower()


def test_agent_query_daily_limit_allows_then_blocks(client, db_engine, monkeypatch):
    _fake_auth(monkeypatch)
    monkeypatch.setattr(settings, "agent_free_daily_limit", 1)
    _fake_llm(monkeypatch, "unsupported")

    try:
        first = client.post(
            "/api/v1/agent/query", headers=AUTH_HEADER, json={"question": "First?"}
        )
        assert first.status_code == 200

        second = client.post(
            "/api/v1/agent/query", headers=AUTH_HEADER, json={"question": "Second?"}
        )
        assert second.status_code == 429
    finally:
        _cleanup(db_engine)


def test_agent_query_rejects_missing_token(client):
    resp = client.post("/api/v1/agent/query", json={"question": "Who won?"})
    assert resp.status_code == 401
    assert "bearer" in resp.get_json()["error"].lower()


def test_agent_query_rejects_invalid_token(client, monkeypatch):
    _fake_bad_auth(monkeypatch)
    resp = client.post(
        "/api/v1/agent/query",
        json={"question": "Who won?"},
        headers={"Authorization": "Bearer not-a-real-jwt"},
    )
    assert resp.status_code == 401
    assert "invalid token" in resp.get_json()["error"].lower()


def test_agent_query_limit_is_per_user(client, db_engine, monkeypatch):
    _fake_llm(monkeypatch, "pit_stop_speed_delta")
    _insert_session_and_driver(db_engine)
    _insert_laps(db_engine)
    monkeypatch.setattr(settings, "agent_free_daily_limit", 1)

    try:
        alpha_headers = {"Authorization": "Bearer alpha"}
        beta_headers = {"Authorization": "Bearer beta"}

        _fake_auth(monkeypatch, "user_alpha")
        first = client.post(
            "/api/v1/agent/query", json={"question": "Q?"}, headers=alpha_headers
        )
        assert first.status_code == 200

        blocked = client.post(
            "/api/v1/agent/query", json={"question": "Q?"}, headers=alpha_headers
        )
        assert blocked.status_code == 429

        _fake_auth(monkeypatch, "user_beta")
        fresh = client.post(
            "/api/v1/agent/query", json={"question": "Q?"}, headers=beta_headers
        )
        assert fresh.status_code == 200
    finally:
        _cleanup(db_engine)
