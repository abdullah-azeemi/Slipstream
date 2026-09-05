"""Long-term memory for the agent.

Two stores, deliberately different:
- Preferences (Postgres) : exact, authoritative, per-user facts
  ("favorite_driver" -> "VER"). Resolved at ROUTING time -- treated like an
  entity the LLM couldn't extract, not like retrieved context.
- Snippets (LanceDB)     : approximate, grounding-only summaries of past
  VERIFIED answers. Injected into planner/composer prompts.

MEMORY IS GROUNDING, NOT AUTHORITY:
  - Recalled facts must still pass verify_evidence, or the answer is refused.
  - store_insight() is only ever called AFTER the evidence gate passed.
  - clear_memory() removes every row a user owns (Postgres + vector side).
"""

from __future__ import annotations
import re
import structlog

from sqlalchemy import text

from backend import extensions
from backend import race_vector_index
from backend.agent import persistence, types

log = structlog.get_logger()


# --- Preferences: exact store ------------------------------------------------


def get_preference(clerk_user_id: str, key: str) -> str | None:
    """'favorite_driver' -> 'VER'. Exact match on a preferences row."""
    with extensions.engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT p.pref_value
                FROM user_preferences p
                JOIN users u ON u.id = p.user_id
                WHERE u.clerk_user_id = :clerk AND p.pref_key = :key
                """
            ),
            {"clerk": clerk_user_id, "key": key},
        ).first()
        return row.pref_value if row else None


def set_preference(clerk_user_id: str, key: str, value: str) -> None:
    """Upsert. One row per (user_id, pref_key). The ONLY write path for
    preferences -- keeps the write path greppable."""
    with extensions.engine.begin() as conn:
        user_id = persistence.ensure_user(conn, clerk_user_id)
        conn.execute(
            text(
                """
                INSERT INTO user_preferences (user_id, pref_key, pref_value)
                VALUES (:uid, :key, :value)
                ON CONFLICT (user_id, pref_key) DO UPDATE
                SET pref_value = EXCLUDED.pref_value, updated_at = NOW()
                """
            ),
            {"uid": user_id, "key": key, "value": value},
        )


_PREF_HINT_RE = re.compile(
    r"\b(favourite|favorite|my)\b.*\b(driver|team)\b", re.IGNORECASE
)


def maybe_store_preference(
    question: str, routed: types.RoutedQuestion, clerk_user_id: str
) -> None:
    """Capture a stated preference. The router already extracted the driver
    entity; this fires only when the SENTENCE itself expresses a preference,
    so 'how did VER do' stores nothing while 'VER is my favourite driver' does.

    The entity may be a driver OR a team -- the regex tells us which slot is
    intended. Only the driver slot is capturable today (routing has no team
    entity), so team phrases are ignored for now."""
    if not routed.driver_name:
        return
    match = _PREF_HINT_RE.search(question)
    if match is None:
        return
    if "driver" in match.group(0):
        set_preference(clerk_user_id, "favorite_driver", routed.driver_name)


# --- Snippets: grounding store ----------------------------------------------


def store_insight(
    clerk_user_id: str,
    session_key: int,
    summary: str,
    run_id: int | None = None,
) -> None:
    """Persist a durable insight. MUST only be called after verify_evidence
    passed -- the caller enforces that; this function just writes."""
    with extensions.engine.begin() as conn:
        user_id = persistence.ensure_user(conn, clerk_user_id)
        row = conn.execute(
            text(
                """
                INSERT INTO agent_memory_snippets (user_id, snippet, run_id)
                VALUES (:uid, :snippet, :run_id)
                RETURNING id
                """
            ),
            {"uid": user_id, "snippet": summary, "run_id": run_id},
        ).first()

    race_vector_index.upsert_snippet(
        snippet_id=row.id,
        user_id=user_id,
        session_key=session_key,
        summary=summary,
    )


def recall(clerk_user_id: str, query: str, limit: int = 5) -> list[dict]:
    """Top-k memory hits for a question, sorted by score desc.
    ONLY this user's rows -- never another user's.

    Fault-tolerant by design: a broken vector store degrades to 'no memory',
    it never crashes the question."""
    with extensions.engine.connect() as conn:
        user_id = persistence.ensure_user(conn, clerk_user_id)

    try:
        return race_vector_index.search_user_memory(query, user_id, limit)
    except Exception:
        log.warning("memory.recall_failed", user=clerk_user_id, exc_info=True)
        return []


def format_memory_context(snippets: list[dict]) -> str:
    """Format recalled snippets into a single prompt block.

    The rule is baked into the wording: memory is background, never evidence.
    The LLM must not quote numbers from it as if they came from tool output."""
    if not snippets:
        return ""
    lines = "\n".join(f"- {s.get('text', '')}" for s in snippets)
    return (
        "Related context from this user's memory (background only -- NEVER "
        "quote numbers from it as if they were tool evidence; every number "
        "must be verifiable against tool output):\n"
        f"{lines}"
    )


def clear_memory(clerk_user_id: str) -> None:
    """T0.6 -- the user's right to be forgotten. Postgres rows + vector rows,
    scoped to this user only."""
    with extensions.engine.begin() as conn:
        user_id = persistence.ensure_user(conn, clerk_user_id)
        conn.execute(
            text("DELETE FROM agent_memory_snippets WHERE user_id = :uid"),
            {"uid": user_id},
        )
        conn.execute(
            text("DELETE FROM user_preferences WHERE user_id = :uid"),
            {"uid": user_id},
        )
    try:
        race_vector_index.delete_user_memory(user_id)
    except Exception:
        log.warning("memory.vector_clear_failed", user=clerk_user_id, exc_info=True)