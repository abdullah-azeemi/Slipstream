"""Persist agent runs and tool-call traces (L8).

Tables come from migration 0019. Runs attach to the local user row
matching the verified clerk_user_id passed by the API layer.
"""

from __future__ import annotations
from datetime import datetime
import json

from sqlalchemy import text

from backend.agent import types
from backend.extensions import engine


def ensure_user(conn, clerk_user_id: str) -> int:
    """Return the id of the user with this clerk id, creating it if absent."""
    conn.execute(
        text(
            """
            INSERT INTO users (clerk_user_id, email, name)
            VALUES (:clerk_user_id, 'demo@pitwall.local', 'Demo User')
            ON CONFLICT (clerk_user_id) DO NOTHING
            """
        ),
        {"clerk_user_id": clerk_user_id},
    )
    row = conn.execute(
        text("SELECT id FROM users WHERE clerk_user_id = :clerk_user_id"),
        {"clerk_user_id": clerk_user_id},
    ).first()
    return row.id


def _insert_tool_call(conn, run_id: int, record: types.ToolCallRecord) -> None:
    conn.execute(
        text(
            """
            INSERT INTO agent_tool_calls (
                run_id, tool_name, input_json, output_summary_json,
                status, duration_ms
            ) VALUES (
                :run_id, :tool_name, :input_json, :output_summary_json,
                :status, :duration_ms
            )
            """
        ),
        {
            "run_id": run_id,
            "tool_name": record.tool_name.value,
            "input_json": json.dumps({"summary": record.input_summary}, sort_keys=True),
            "output_summary_json": (
                json.dumps({"summary": record.output_summary}, sort_keys=True)
                if record.output_summary
                else None
            ),
            "status": record.status,
            "duration_ms": int(record.duration_ms) if record.duration_ms else None,
        },
    )


def persist_run(
    answer: types.AgentAnswer, started_at: datetime, clerk_user_id: str
) -> int:
    """Insert one agent_runs row plus every tool call in the trace.

    Returns the new run id. conversation_id stays NULL (no chat UI yet).
    """
    with engine.begin() as conn:
        user_id = ensure_user(conn, clerk_user_id)
        row = conn.execute(
            text(
                """
                INSERT INTO agent_runs (
                    conversation_id, user_id, status, model,
                    started_at, completed_at, cost_estimate_usd, error
                ) VALUES (
                    NULL, :user_id, :status, NULL, :started_at, :completed_at,
                    NULL, :error
                )
                RETURNING id
                """
            ),
            {
                "user_id": user_id,
                "status": "refused" if answer.refusals else "completed",
                "started_at": started_at,
                "completed_at": datetime.now(started_at.tzinfo),
                "error": answer.refusals[0] if answer.refusals else None,
            },
        ).first()
        run_id = row.id
        for call in answer.trace:
            _insert_tool_call(conn, run_id, call)
    return run_id


def count_runs_today(clerk_user_id: str) -> int:
    """Count this user's agent runs recorded since local midnight."""
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT COUNT(*) FROM agent_runs r
                JOIN users u ON u.id = r.user_id
                WHERE u.clerk_user_id = :clerk_user_id
                  AND r.started_at >= date_trunc('day', NOW())
                """
            ),
            {"clerk_user_id": clerk_user_id},
        ).scalar_one()
