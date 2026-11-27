"""HTTP guards and conversation endpoints that the analyst page still relies on."""

from sqlalchemy import text

from backend import auth as auth_module
from backend.agent import orchestrator
from backend.config import settings

# Any non-empty bearer passes the header check; _fake_auth mocks the verifier.
AUTH_HEADER = {"Authorization": "Bearer test-token"}


def _cleanup(db_engine):
    with db_engine.begin() as conn:
        conn.execute(
            text(
                """
                DELETE FROM agent_tool_calls
                WHERE run_id IN (
                    SELECT id FROM agent_runs
                    WHERE user_id IN (
                        SELECT id FROM users WHERE clerk_user_id IN ('demo-user', 'user_alpha', 'user_beta', 'admin-user')
                    )
                )
                """
            )
        )
        conn.execute(
            text(
                """
                DELETE FROM agent_messages
                WHERE conversation_id IN (
                    SELECT id FROM agent_conversations
                    WHERE user_id IN (
                        SELECT id FROM users WHERE clerk_user_id IN ('demo-user', 'user_alpha', 'user_beta', 'admin-user')
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
                    SELECT id FROM users WHERE clerk_user_id IN ('demo-user', 'user_alpha', 'user_beta', 'admin-user')
                )
                """
            )
        )
        conn.execute(
            text(
                """
                DELETE FROM agent_conversations
                WHERE user_id IN (
                    SELECT id FROM users WHERE clerk_user_id IN ('demo-user', 'user_alpha', 'user_beta', 'admin-user')
                )
                """
            )
        )
        conn.execute(
            text(
                "DELETE FROM users WHERE clerk_user_id IN ('demo-user', 'user_alpha', 'user_beta', 'admin-user')"
            )
        )


def _fake_llm(monkeypatch, intent):
    monkeypatch.setattr(
        orchestrator.llm,
        "route_question",
        lambda q: (
            orchestrator.types.RoutedQuestion(
                intent=orchestrator.types.Intent(intent),
                driver_name="Sainz",
                year=2026,
                gp_name="Monaco",
            ),
            0.0,
        ),
    )
    monkeypatch.setattr(
        orchestrator.llm,
        "compose_answer",
        lambda q, e, **kwargs: ("Sainz pitted across laps 5 and 6.", 0.0),
    )


def _fake_auth(monkeypatch, clerk_user_id="demo-user"):
    """Replace JWKS verification with a stub identity."""
    monkeypatch.setattr(
        auth_module, "verify_session_token", lambda token: clerk_user_id
    )


def test_agent_query_limit_returns_retry_after(client, monkeypatch):
    from backend.agent import persistence

    _fake_auth(monkeypatch)
    monkeypatch.setattr(persistence, "count_runs_today", lambda uid: 99)
    monkeypatch.setattr(settings, "agent_free_daily_limit", 10)

    resp = client.post(
        "/api/v1/agent/query", headers=AUTH_HEADER, json={"question": "Who won?"}
    )
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    assert resp.headers["Retry-After"].isdigit()


def _fake_bad_auth(monkeypatch):
    def boom(token):
        raise auth_module.ClerkAuthError("signature verification failed")

    monkeypatch.setattr(auth_module, "verify_session_token", boom)


def test_agent_query_missing_question(client, monkeypatch):
    _fake_auth(monkeypatch)
    resp = client.post("/api/v1/agent/query", headers=AUTH_HEADER, json={})
    assert resp.status_code == 400
    assert "question" in resp.get_json()["error"]


def test_agent_query_daily_limit_blocks_immediately(client, monkeypatch):
    _fake_auth(monkeypatch)
    monkeypatch.setattr(settings, "agent_free_daily_limit", 0)
    _fake_llm(monkeypatch, "pit_stop_speed_delta")

    resp = client.post(
        "/api/v1/agent/query", headers=AUTH_HEADER, json={"question": "Who won?"}
    )
    assert resp.status_code == 429
    assert "limit" in resp.get_json()["error"].lower()


def test_agent_query_rejects_missing_token(app):
    resp = app.test_client().post("/api/v1/agent/query", json={"question": "Who won?"})
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


def test_agent_query_rejects_wrong_conversation_owner(
    app, client, db_engine, monkeypatch
):
    _fake_llm(monkeypatch, "unsupported")

    try:
        # Create a conversation as alpha.
        _fake_auth(monkeypatch, "user_alpha")
        resp1 = client.post(
            "/api/v1/agent/query",
            headers={"Authorization": "Bearer alpha"},
            json={"question": "Alpha's question"},
        )
        conv_id = resp1.get_json()["conversation_id"]

        # Try to post to that conversation as beta — should 404.
        _fake_auth(monkeypatch, "user_beta")
        resp2 = client.post(
            "/api/v1/agent/query",
            headers={"Authorization": "Bearer beta"},
            json={"question": "Beta hijack", "conversation_id": conv_id},
        )
        assert resp2.status_code == 404
    finally:
        _cleanup(db_engine)


def test_list_conversations(app, client, db_engine, monkeypatch):
    _fake_auth(monkeypatch)
    _fake_llm(monkeypatch, "unsupported")

    try:
        # Create two conversations.
        client.post(
            "/api/v1/agent/query",
            headers=AUTH_HEADER,
            json={"question": "First topic"},
        )
        client.post(
            "/api/v1/agent/query",
            headers=AUTH_HEADER,
            json={"question": "Second topic"},
        )

        resp = client.get("/api/v1/agent/conversations", headers=AUTH_HEADER)
        assert resp.status_code == 200
        convs = resp.get_json()
        assert len(convs) >= 2
        assert convs[0]["title"] == "Second topic"
        assert convs[1]["title"] == "First topic"
        for c in convs:
            assert "id" in c
            assert "message_count" in c
    finally:
        _cleanup(db_engine)


def test_get_conversation_messages(app, client, db_engine, monkeypatch):
    _fake_auth(monkeypatch)
    _fake_llm(monkeypatch, "unsupported")

    try:
        # Create a conversation.
        resp = client.post(
            "/api/v1/agent/query",
            headers=AUTH_HEADER,
            json={"question": "Tell me about pit stops"},
        )
        conv_id = resp.get_json()["conversation_id"]

        # Fetch the conversation messages.
        resp = client.get(f"/api/v1/agent/conversations/{conv_id}", headers=AUTH_HEADER)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["id"] == conv_id
        assert len(data["messages"]) == 2
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][1]["role"] == "assistant"
    finally:
        _cleanup(db_engine)


def test_get_conversation_messages_not_found(app, client, monkeypatch):
    _fake_auth(monkeypatch)
    resp = client.get("/api/v1/agent/conversations/999999", headers=AUTH_HEADER)
    assert resp.status_code == 404
