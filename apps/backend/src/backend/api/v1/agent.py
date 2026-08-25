"""Agent API endpoint exposing the rule based orchestrator"""

from dataclasses import asdict
from datetime import datetime
import structlog
from flask import Blueprint, g, jsonify, request

from backend import auth
from backend.agent import orchestrator, persistence
from backend.config import settings
from sqlalchemy import text as sql_text

from backend.extensions import engine

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

    # ── Conversation handling ───────────────────────────────────────────
    # If the client sends a conversation_id, reuse that thread.
    # Otherwise create a new conversation (title = first 80 chars of question).
    incoming_conv_id = payload.get("conversation_id")
    conv_id: int | None = None

    with engine.begin() as conn:
        user_id = persistence.ensure_user(conn, g.clerk_user_id)

        if incoming_conv_id is not None:
            # Validate that this conversation belongs to this user.
            owner = conn.execute(
                sql_text(
                    """
                    SELECT c.id FROM agent_conversations c
                    WHERE c.id = :cid AND c.user_id = :uid
                    """
                ),
                {"cid": incoming_conv_id, "uid": user_id},
            ).first()
            if owner is None:
                return jsonify({"error": "Conversation not found"}), 404
            conv_id = incoming_conv_id
        else:
            title = question.strip()[:80]
            conv_id = persistence.create_conversation(conn, user_id, title)

        # Store the user message.
        persistence.insert_message(conn, conv_id, "user", question.strip())

    # ── Run the orchestrator ────────────────────────────────────────────
    started_at = datetime.now().astimezone()
    answer = orchestrator.run(question.strip())

    # ── Store the assistant message + persist run ───────────────────────
    with engine.begin() as conn:
        persistence.insert_message(conn, conv_id, "assistant", answer.answer)

    run_id = persistence.persist_run(
        answer, started_at, g.clerk_user_id, conversation_id=conv_id
    )

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
        conversation_id=conv_id,
        intent=answer.intent.value,
        refused=bool(answer.refusals),
        refusals=list(answer.refusals),
    )

    # ── Response ────────────────────────────────────────────────────────
    # Return the AgentAnswer dict plus the conversation_id so the client
    # can continue the thread on the next question.
    response = asdict(answer)
    response["conversation_id"] = conv_id
    return jsonify(response)


@agent_bp.get("/agent/conversations")
def list_conversations():
    """Return all conversations for the authenticated user, newest first."""
    conversations = persistence.list_conversations(g.clerk_user_id)
    return jsonify(conversations)


@agent_bp.get("/agent/conversations/<int:conv_id>")
def get_conversation(conv_id: int):
    """Return a single conversation with all its messages."""
    result = persistence.get_conversation_messages(conv_id, g.clerk_user_id)
    if result is None:
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify(result)

@agent_bp.get("/agent/usage")
def get_usage():
    """ Returns the authenticated users daily usage summary """
    summary = persistence.get_usage_summary(g.clerk_user_id)
    return jsonify(summary)

@agent_bp.get("/agent/admin/stats")
def admin_stats():
    """ Return aggregated stats. Only accessible to admin users """
    if g.clerk_user_id not in _admin_ids():
        return jsonify({"error": "Admin access required"}), 403
    stats = persistence.get_admin_stats()
    return jsonify(stats)