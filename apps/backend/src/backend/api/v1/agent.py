"""Agent API endpoint exposing the rule based orchestrator"""

from dataclasses import asdict
from datetime import datetime
import json
import queue
import structlog
import threading
from flask import Blueprint, Response, g, jsonify, request, stream_with_context

from backend import auth, extensions
from backend.agent import memory, orchestrator, persistence, rate_limit
from backend.config import settings
from sqlalchemy import text as sql_text

log = structlog.get_logger()
agent_bp = Blueprint("agent", __name__)


def _admin_ids() -> set[str]:
    """Parse the comma-separated admin allowlist from settings."""
    return {s.strip() for s in settings.clerk_admin_user_ids.split(",") if s.strip()}


def _is_admin(clerk_user_id: str) -> bool:
    return clerk_user_id in _admin_ids()


def _public_tool_summary(call) -> str:
    summaries = {
        "resolve_session": "Race context resolved",
        "resolve_driver": "Driver identity resolved",
        "find_pit_stops": "Pit stop evidence checked",
        "get_lap_telemetry_artifacts": "Telemetry artifacts found",
        "compute_speed_window": "Speed comparison computed",
        "verify_evidence": "Evidence gate completed",
    }
    return summaries.get(call.tool_name.value, "Tool completed")


def _serialize_answer(answer, *, conversation_id: int | None, include_trace_details: bool):
    response = asdict(answer)
    response["conversation_id"] = conversation_id
    response["trace_visibility"] = "full" if include_trace_details else "evidence"
    if not include_trace_details:
        response["trace"] = [
            {
                "tool_name": call.tool_name.value,
                "status": call.status,
                "input_summary": "",
                "output_summary": _public_tool_summary(call),
                "error": "A required evidence step failed" if call.error else None,
                "duration_ms": call.duration_ms,
            }
            for call in answer.trace
        ]
    return response


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


def _validate_question_payload():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return None, (jsonify({"error": "Request body must be a JSON object"}), 400)

    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        return None, (
            jsonify({"error": "question is required and must be a non-empty string"}),
            400,
        )
    return payload, None


def _prepare_conversation(payload: dict, question: str):
    incoming_conv_id = payload.get("conversation_id")
    with extensions.engine.begin() as conn:
        user_id = persistence.ensure_user(conn, g.clerk_user_id)

        if incoming_conv_id is not None:
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
                return None, None, (jsonify({"error": "Conversation not found"}), 404)
            conv_id = int(incoming_conv_id)
        else:
            title = question.strip()[:80]
            conv_id = persistence.create_conversation(conn, user_id, title)

        persistence.insert_message(conn, conv_id, "user", question.strip())

    context = (
        persistence.load_last_context(conv_id, g.clerk_user_id)
        if incoming_conv_id is not None
        else None
    )
    return conv_id, context, None


def _finalize_run(answer, started_at, clerk_user_id: str, conv_id: int):
    with extensions.engine.begin() as conn:
        persistence.insert_message(conn, conv_id, "assistant", answer.answer)

    run_id = persistence.persist_run(
        answer, started_at, clerk_user_id, conversation_id=conv_id
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
    return run_id


def _maybe_store_insight(answer, clerk_user_id: str, run_id: int | None) -> None:
    """T2.1 -- write a durable insight ONLY when the evidence gate passed.

    This is the 'memory is grounding, not authority' rule applied to writes:
    an answer the gate refused must never become durable memory."""
    if (
        run_id is None
        or answer.evidence is None
        or not answer.evidence.passed
        or answer.refusals
        or answer.session is None
    ):
        return

    driver = answer.driver
    summary = (
        f"{answer.intent.value}: {driver.full_name if driver else 'driver'} "
        f"@ {answer.session.gp_name} {answer.session.year} -- {answer.answer[:200]}"
    )
    try:
        memory.store_insight(
            clerk_user_id, answer.session.session_key, summary, run_id=run_id
        )
    except Exception as exc:  # memory is optional -- never fail the response on it
        log.warning("agent.insight_store_failed", error=str(exc))


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
    payload, error_response = _validate_question_payload()
    if error_response:
        return error_response
    question = payload["question"]

    if not _is_admin(g.clerk_user_id):
        limit_response = rate_limit.limit_response(g.clerk_user_id)
        if limit_response is not None:
            log.info("agent.limit_hit", user=g.clerk_user_id)
            return limit_response

    conv_id, context, error_response = _prepare_conversation(payload, question)
    if error_response:
        return error_response

    # ── Run the orchestrator ────────────────────────────────────────────
    started_at = datetime.now().astimezone()
    answer = orchestrator.run(
        question.strip(), context=context, clerk_user_id=g.clerk_user_id
    )

    # ── Store the assistant message + persist run ───────────────────────
    run_id = _finalize_run(answer, started_at, g.clerk_user_id, conv_id)
    _maybe_store_insight(answer, g.clerk_user_id, run_id)

    response = _serialize_answer(
        answer,
        conversation_id=conv_id,
        include_trace_details=_is_admin(g.clerk_user_id),
    )
    return jsonify(response)


@agent_bp.post("/agent/query/stream")
def agent_query_stream():
    payload, error_response = _validate_question_payload()
    if error_response:
        return error_response
    question = payload["question"]

    if not _is_admin(g.clerk_user_id):
        limit_response = rate_limit.limit_response(g.clerk_user_id)
        if limit_response is not None:
            log.info("agent.limit_hit", user=g.clerk_user_id)
            return limit_response

    conv_id, context, error_response = _prepare_conversation(payload, question)
    if error_response:
        return error_response

    clerk_user_id = g.clerk_user_id
    include_trace_details = _is_admin(clerk_user_id)
    started_at = datetime.now().astimezone()
    events: queue.Queue[tuple[str, dict]] = queue.Queue()

    def worker():
        try:
            answer = orchestrator.run(
                question.strip(),
                progress=lambda payload: events.put(("progress", payload)),
                context=context,
                clerk_user_id=clerk_user_id,
            )
            run_id = _finalize_run(answer, started_at, clerk_user_id, conv_id)
            _maybe_store_insight(answer, clerk_user_id, run_id)
            events.put(
                (
                    "final",
                    _serialize_answer(
                        answer,
                        conversation_id=conv_id,
                        include_trace_details=include_trace_details,
                    ),
                )
            )
        except Exception as exc:
            log.exception("agent.stream_failed", error=str(exc))
            events.put(("error", {"error": "Agent stream failed"}))
        finally:
            events.put(("done", {}))

    threading.Thread(target=worker, name="pitwall-agent-stream", daemon=True).start()

    @stream_with_context
    def generate():
        yield _sse(
            "progress",
            {
                "type": "stage",
                "stage": "start",
                "status": "ok",
                "label": "Agent run started",
            },
        )
        while True:
            event, payload = events.get()
            if event == "done":
                yield _sse("done", {})
                break
            yield _sse(event, payload)

    return Response(generate(), mimetype="text/event-stream")


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
    """Returns the authenticated users daily usage summary"""
    summary = persistence.get_usage_summary(g.clerk_user_id)
    return jsonify(summary)


@agent_bp.delete("/agent/memory")
def delete_agent_memory():
    """T0.6 -- clear this user's durable memory (preferences + snippets)."""
    memory.clear_memory(g.clerk_user_id)
    log.info("agent.memory_cleared", user=g.clerk_user_id)
    return jsonify({"ok": True})


@agent_bp.get("/agent/admin/stats")
def admin_stats():
    """Return aggregated stats. Only accessible to admin users"""
    if not _is_admin(g.clerk_user_id):
        return jsonify({"error": "Admin access required"}), 403
    stats = persistence.get_admin_stats()
    return jsonify(stats)
