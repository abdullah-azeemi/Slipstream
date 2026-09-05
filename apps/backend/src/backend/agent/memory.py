"""Long-term memory for the agent.

Two stores, deliberately different:
- Preferences (Postgres) : exact, authoritative, per-user facts
  ("favorite_driver" -> "VER"). Resolved at ROUTING time -- treated like an
  entity the LLM couldn't extract, not like retrieved context.
- Snippets (LanceDB)     : approximate, grounding-only summaries of past
  VERIFIED answers. Injected into planner/composer prompts.
"""

from __future__ import annotations
import re
import structlog
from sqlalchemy import text
from backend import extensions
from backend import race_vector_index
from backend.agent import persistence, types

log = structlog.get_logger()     

_PREFERENCE_KEYS = ("favorite_driver", "favorite_team")


def get_preference(clerk_user_id: str, key: str) -> str | None:
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
    """Upsert. The ONLY write path for preferences -- keeps it greppable."""
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


_PREF_HINT_RE = re.compile(r"\b(favourite|favorite|my)\b.*\b(driver|team)\b", re.IGNORECASE)


def maybe_store_preference(question: str, routed: types.RoutedQuestion, clerk_user_id: str) -> None:
    """Rule-based preference capture. The router already extracted the driver
    entity, so this only fires when the SENTENCE expresses a preference --
    'VER is my favourite driver' -> stores favorite_driver=VER, while
    'how did VER do' (same driver entity!) stores nothing."""
    if not routed.driver_name:
        return
    if not _PREF_HINT_RE.search(question):
        return

    if "driver" in _PREF_HINT_RE.search(question).group(0):
        set_preference(clerk_user_id, "favorite_driver", routed.driver_name)


def store_insight(clerk_user_id: str, session_key: int, summary: str, run_id: int | None = None) -> None:
    """Durable insight. ONLY call after verify_evidence passed -- enforcing
    that belongs to the caller; this function just writes."""
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
        snippet_id=row.id, user_id=user_id,
        session_key=session_key, summary=summary,
    )


def recall(clerk_user_id: str, query: str, limit: int = 5) -> list[dict]:
    """Top-k durable memory hits for this user. Fault-tolerant by design:
    a broken LanceDB must degrade to 'no memory', never crash the question."""
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
    """T0.6 -- the user's right to be forgotten. Postgres (cascade-tolerant
    by hand) + vector rows both scoped to this user only."""
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