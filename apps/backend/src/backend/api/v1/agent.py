"""Agent API endpoint exposing the rule based orchestrator"""

from dataclasses import asdict
from datetime import datetime
import structlog
from flask import Blueprint, g, jsonify, request

from backend import auth
from backend.agent import orchestrator, persistence
from backend.config import settings

log = structlog.get_logger()
agent_bp = Blueprint("agent", __name__)


def _admin_ids() -> set[str]:
    """Parse the comma-separated admin allowlist from settings."""
    return {s.strip() for s in settings.clerk_admin_user_ids.split(",") if s.strip()}


@agent_bp.before_request
def require_clerk_session():
    """Reject the request before the view unless a valid Clerk token is present."""
    if request.method == "OPTIONS":
        return None  # CORS preflight never carries credentials
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return jsonify({"error": "Missing bearer token"}), 401
    try:
        g.clerk_user_id = auth.verify_session_token(header.removeprefix("Bearer "))
    except auth.ClerkAuthError as exc:
        log.info("agent.auth_rejected", reason=str(exc))
        return jsonify({"error": f"Invalid token: {exc}"}), 401
    return None


@agent_bp.post("/agent/query")
def agent_query():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400

    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        return jsonify(
            {"error": "question is required and must be a non-empty string"}
        ), 400

    if (
        g.clerk_user_id not in _admin_ids()
        and persistence.count_runs_today(g.clerk_user_id)
        >= settings.agent_free_daily_limit
    ):
        log.info(
            "agent.limit_hit",
            user=g.clerk_user_id,
            limit=settings.agent_free_daily_limit,
        )
        return jsonify(
            {"error": "Daily question limit reached. Try again tomorrow."}
        ), 429

    started_at = datetime.now().astimezone()
    answer = orchestrator.run(question.strip())
    run_id = persistence.persist_run(answer, started_at, g.clerk_user_id)
    for call in answer.trace:
        log.info(
            "agent.tool_call",
            tool=call.tool_name.value,
            status=call.status,
            duration_ms=call.duration_ms,
            error=call.error,
        )

    log.info(
        "agent.run",
        run_id=run_id,
        intent=answer.intent.value,
        refused=bool(answer.refusals),
        refusals=list(answer.refusals),
    )
    return jsonify(asdict(answer))
