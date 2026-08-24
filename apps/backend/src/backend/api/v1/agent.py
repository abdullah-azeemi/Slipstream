"""Agent API endpoint exposing the rule based orchestrator"""

from dataclasses import asdict
from datetime import datetime
import structlog
from flask import Blueprint, jsonify, request

from backend.agent import orchestrator, persistence
from backend.config import settings

log = structlog.get_logger()
agent_bp = Blueprint("agent", __name__)


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

    if persistence.count_runs_today() >= settings.agent_free_daily_limit:
        log.info("agent.limit_hit", limit=settings.agent_free_daily_limit)
        return jsonify(
            {"error": "Daily question limit reached. Try again tomorrow."}
        ), 429

    started_at = datetime.now().astimezone()
    answer = orchestrator.run(question.strip())
    run_id = persistence.persist_run(answer, started_at)
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
