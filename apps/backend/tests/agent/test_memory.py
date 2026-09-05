"""Memory (T2.1) tests: preferences (exact store) + snippets (vector store).

Preference tests hit real Postgres (conftest creates the schema).
Snippet tests point LanceDB at a temp dir and use the real deterministic
embedder, so they exercise the real upsert/search/delete round-trip.
"""

import pytest

from backend import race_vector_index
from backend.agent import memory, types
from backend.config import settings


@pytest.fixture(autouse=True)
def _ensure_engine(app):
    """extensions.engine is created inside create_app() -- the app session
    fixture must be instantiated before any DB-touching test runs."""
    return app


def _routed(driver_name: str | None = "VER") -> types.RoutedQuestion:
    return types.RoutedQuestion(
        intent=types.Intent.PIT_STOP_SPEED_DELTA,
        driver_name=driver_name,
    )


@pytest.fixture
def lancedb_tmp(tmp_path, monkeypatch):
    """Point the vector store at a fresh temp dir + table per test."""
    monkeypatch.setattr(settings, "race_vector_index_dir", str(tmp_path / "lancedb"))
    monkeypatch.setattr(settings, "memory_vector_table", "test_memory_snippets")
    yield


# ---------------------------------------------------------------------------
# Preferences -- exact store
# ---------------------------------------------------------------------------


def test_preference_round_trip():
    memory.set_preference("u-roundtrip", "favorite_driver", "VER")
    assert memory.get_preference("u-roundtrip", "favorite_driver") == "VER"


def test_preference_upsert_overwrites():
    memory.set_preference("u-upsert", "favorite_driver", "VER")
    memory.set_preference("u-upsert", "favorite_driver", "SAI")
    assert memory.get_preference("u-upsert", "favorite_driver") == "SAI"


def test_preference_scoped_per_user():
    memory.set_preference("u-scope-a", "favorite_driver", "VER")
    assert memory.get_preference("u-scope-b", "favorite_driver") is None


def test_get_unknown_preference_is_none():
    assert memory.get_preference("u-nobody", "favorite_team") is None


def test_maybe_store_preference_only_on_explicit_statement():
    # Same driver entity, different sentence -- only the explicit preference
    # statement may be stored. This is the whole point of the rule-based gate.
    memory.maybe_store_preference(
        "how did VER do in Monaco", _routed("VER"), "u-pref-gate"
    )
    assert memory.get_preference("u-pref-gate", "favorite_driver") is None

    memory.maybe_store_preference(
        "VER is my favourite driver", _routed("VER"), "u-pref-gate"
    )
    assert memory.get_preference("u-pref-gate", "favorite_driver") == "VER"


# ---------------------------------------------------------------------------
# Snippets -- vector grounding store (real embed + real LanceDB)
# ---------------------------------------------------------------------------


def test_store_and_recall_insight_round_trip(lancedb_tmp):
    memory.store_insight(
        "u-snippet", session_key=99999, summary="VER won Monza in 2026", run_id=None
    )
    results = memory.recall("u-snippet", "who won Monza", limit=5)
    assert results, "recall should surface the stored snippet for its owner"
    assert "won Monza" in results[0].get("text", "")


def test_recall_never_leaks_other_users_snippets(lancedb_tmp):
    memory.store_insight(
        "u-leak-a", session_key=99999, summary="Huge crash at turn 1", run_id=None
    )
    results = memory.recall("u-leak-b", "huge crash turn 1", limit=5)
    assert results == []


def test_recall_without_rows_returns_empty_list(lancedb_tmp):
    assert memory.recall("u-fresh", "anything", limit=5) == []


def test_underlying_search_respects_user_scope(lancedb_tmp):
    """Assert the LanceDB layer itself filters by user -- recall() swallows
    exceptions, so it could silently return [] even when search is broken."""
    from backend.agent import persistence
    from backend import extensions

    with extensions.engine.connect() as conn:
        uid1 = persistence.ensure_user(conn, "u-raw-a")
        uid2 = persistence.ensure_user(conn, "u-raw-b")

    race_vector_index.upsert_snippet(1, uid1, 99999, "RB19 era dominance")
    race_vector_index.upsert_snippet(2, uid2, 99999, "RB19 era dominance")

    assert len(race_vector_index.search_user_memory("RB19 era dominance", uid1, 5)) == 1
    assert (
        len(race_vector_index.search_user_memory("RB19 era dominance", uid2, 5)) == 1
    )


def test_clear_memory_removes_preferences_and_snippets(lancedb_tmp):
    memory.set_preference("u-clear", "favorite_driver", "VER")
    memory.store_insight(
        "u-clear", session_key=99999, summary="rain ruined the race", run_id=None
    )

    memory.clear_memory("u-clear")

    assert memory.get_preference("u-clear", "favorite_driver") is None
    assert memory.recall("u-clear", "rain ruined the race", limit=5) == []


def test_clear_memory_is_scoped_to_owner(lancedb_tmp):
    memory.set_preference("u-clear-a", "favorite_driver", "VER")
    memory.set_preference("u-clear-b", "favorite_driver", "SAI")
    memory.store_insight(
        "u-clear-a", session_key=99999, summary="only u-clear-a insight", run_id=None
    )

    memory.clear_memory("u-clear-a")

    assert memory.get_preference("u-clear-a", "favorite_driver") is None
    assert memory.get_preference("u-clear-b", "favorite_driver") == "SAI"
    assert memory.recall("u-clear-b", "sai", limit=5) == []


# ---------------------------------------------------------------------------
# Prompt formatting
# ---------------------------------------------------------------------------


def test_format_memory_context_empty_is_empty_string():
    assert memory.format_memory_context([]) == ""
    assert memory.format_memory_context(None) == ""


def test_format_memory_context_emits_grounding_rule():
    ctx = memory.format_memory_context([{"text": "VER dominated the stint"}])
    assert "VER dominated the stint" in ctx
    assert "quote numbers from it" in ctx