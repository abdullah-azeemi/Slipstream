"""Persist analyst runs: the full event log is stored so a run can be replayed."""

from __future__ import annotations

import json

from sqlalchemy import text

from backend.analyst.loop import AnalystResult

# Every earlier turn is sent again on every model call, so history is kept small.
MAX_HISTORY_TURNS = 3
MAX_HISTORY_CHARS = 1500


def history_messages(
    rows: list[dict],
    max_turns: int = MAX_HISTORY_TURNS,
    max_chars: int = MAX_HISTORY_CHARS,
) -> list[dict]:
    """Chat rows (oldest first) as model messages: the last answered turns only.

    A question with no answer is dropped, whether its run failed or it is the one
    being asked now.
    """

    turns: list[tuple[str, str]] = []
    question: str | None = None
    for row in rows:
        if row["role"] == "user":
            question = row["content"]
        elif row["role"] == "assistant" and question is not None:
            turns.append((question, row["content"]))
            question = None

    messages: list[dict] = []
    for asked, answered in turns[-max_turns:]:
        if len(answered) > max_chars:
            answered = answered[:max_chars] + " ...[shortened]"
        messages.append({"role": "user", "content": asked})
        messages.append({"role": "assistant", "content": answered})
    return messages


def load_history(conn, conversation_id: int) -> list[dict]:
    """Earlier turns of a conversation. The caller must already have checked its owner."""

    rows = (
        conn.execute(
            text(
                "SELECT role, content FROM agent_messages WHERE conversation_id = :cid ORDER BY id"
            ),
            {"cid": conversation_id},
        )
        .mappings()
        .all()
    )
    return history_messages([dict(r) for r in rows])


def save_run(
    conn,
    user_id: int,
    conversation_id: int | None,
    question: str,
    result: AnalystResult,
) -> int:
    row = conn.execute(
        text(
            """
            INSERT INTO analyst_runs
                (user_id, conversation_id, question, answer, cost_usd, steps, error, events)
            VALUES (:uid, :cid, :q, :a, :cost, :steps, :err, CAST(:events AS JSONB))
            RETURNING id
            """
        ),
        {
            "uid": user_id,
            "cid": conversation_id,
            "q": question,
            "a": result.answer,
            "cost": result.cost_usd,
            "steps": result.steps,
            "err": result.error,
            "events": json.dumps(result.events, default=str),
        },
    ).first()
    return int(row[0])


def get_run(conn, run_id: int, clerk_user_id: str) -> dict | None:
    """One run with its events, only if it belongs to this user."""
    row = (
        conn.execute(
            text(
                """
                SELECT r.id, r.question, r.answer, r.cost_usd, r.steps, r.error,
                       r.events, r.created_at, r.conversation_id
                FROM analyst_runs r JOIN users u ON u.id = r.user_id
                WHERE r.id = :rid AND u.clerk_user_id = :clerk
                """
            ),
            {"rid": run_id, "clerk": clerk_user_id},
        )
        .mappings()
        .first()
    )
    return dict(row) if row else None


def list_runs(conn, clerk_user_id: str, limit: int = 20) -> list[dict]:
    rows = (
        conn.execute(
            text(
                """
                SELECT r.id, r.question, r.cost_usd, r.steps, r.error, r.created_at
                FROM analyst_runs r JOIN users u ON u.id = r.user_id
                WHERE u.clerk_user_id = :clerk
                ORDER BY r.created_at DESC, r.id DESC
                LIMIT :limit
                """
            ),
            {"clerk": clerk_user_id, "limit": limit},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


def usage_today(conn, clerk_user_id: str) -> tuple[int, float]:
    """(runs, cost in USD) for this user since midnight."""
    row = conn.execute(
        text(
            """
            SELECT COUNT(*), COALESCE(SUM(r.cost_usd), 0)
            FROM analyst_runs r JOIN users u ON u.id = r.user_id
            WHERE u.clerk_user_id = :clerk AND r.created_at >= date_trunc('day', NOW())
            """
        ),
        {"clerk": clerk_user_id},
    ).first()
    return int(row[0]), float(row[1])
