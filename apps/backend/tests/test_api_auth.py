"""Clerk JWT guard contract tests (T4).

Product APIs (sessions, telemetry, predictions) reject absent/invalid bearer
tokens with a consistent JSON 401 and always permit CORS preflight.
"""


def test_sessions_requires_bearer_token(app):
    resp = app.test_client().get("/api/v1/sessions")
    assert resp.status_code == 401
    body = resp.get_json()
    assert "bearer" in body["error"].lower()


def test_telemetry_requires_bearer_token(app, seed_session):
    resp = app.test_client().get("/api/v1/sessions/99999/telemetry/44")
    assert resp.status_code == 401
    assert "bearer" in resp.get_json()["error"].lower()


def test_predictions_requires_bearer_token(app, seed_session):
    resp = app.test_client().get("/api/v1/sessions/99999/predictions")
    assert resp.status_code == 401
    assert "bearer" in resp.get_json()["error"].lower()


def test_invalid_token_returns_401(app, monkeypatch):
    from backend import auth as auth_module

    def boom(token):
        raise auth_module.ClerkAuthError("cannot resolve signing key")

    monkeypatch.setattr(auth_module, "verify_session_token", boom)
    resp = app.test_client().get(
        "/api/v1/sessions", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert resp.status_code == 401
    assert "invalid token" in resp.get_json()["error"].lower()


def test_cors_preflight_is_permitted(app):
    resp = app.test_client().options(
        "/api/v1/sessions",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert resp.status_code in (200, 204)
    assert (
        "authorization" in resp.headers.get("Access-Control-Allow-Headers", "").lower()
    )


def test_valid_bearer_passes_sessions_guard(client, seed_session):
    resp = client.get("/api/v1/sessions/99999")
    assert resp.status_code == 200
    assert resp.get_json()["session_key"] == 99999


def test_analysis_requires_bearer_token(app):
    resp = app.test_client().get("/api/v1/sessions/1/analysis/lap-evolution")
    assert resp.status_code == 401


def test_laps_and_strategy_require_bearer_token(app):
    c = app.test_client()
    assert c.get("/api/v1/sessions/1/laps").status_code == 401
    assert c.get("/api/v1/sessions/1/strategy").status_code == 401


def test_health_stays_public(app):
    assert app.test_client().get("/health").status_code != 401


def test_public_landing_routes_stay_public(app):
    c = app.test_client()
    assert c.get("/api/v1/stats").status_code != 401
    assert c.get("/api/v1/schedule/next-race").status_code != 401


def test_cors_blocks_unknown_origin(app):
    resp = app.test_client().options(
        "/api/v1/sessions",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "Access-Control-Allow-Origin" not in resp.headers
