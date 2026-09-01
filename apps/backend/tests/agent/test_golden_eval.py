"""
T0.1 -- Golden evaluation set.

Run with: cd apps/backend && python -m pytest tests/agent/test_golden_eval.py -v

WHAT THIS IS
------------
A fixed set of real questions (golden_set.json) each with an expected intent and
expected tool sequence. This is the *regression floor*: every future planner change
(hardcoded or the T1.1 LLM planner) is checked against it before shipping. It makes
"did T1.1 actually improve things" answerable instead of a guess.

Two kinds of checks run here:
  1. TOOL SEQUENCE -- build_dag() must pick (at least mostly) the expected tools.
     This is PURE (no DB needed): build_dag only reads the routed intent.
  2. META/COVERAGE -- the golden set itself must be healthy: covers all intents,
     has enough questions, uses only valid intent names.

A separate, lighter evidence-gate integration check runs one representative DAG
end-to-end through _execute_dag to prove the evidence gate still passes.

We deliberately report an OVERLAP RATIO, not an exact match. T1.1's LLM planner may
legitimately pick a slightly different but still-correct tool sequence; we care that
it does not DROP a required tool, not that it matches the hardcoded planner exactly.
"""

import gzip
import json
from pathlib import Path

import pytest
from sqlalchemy import text

from backend.agent import orchestrator, types
from backend.config import settings

# Path relative to THIS file, wherever pytest runs from.
GOLDEN_SET = json.loads((Path(__file__).parent / "golden_set.json").read_text())[
    "questions"
]

# Minimum acceptable fraction of expected tools that must appear in the actual
# tool sequence. Conservative on purpose: we establish the number first, then
# tighten it once the baseline is recorded.
TOOL_OVERLAP_THRESHOLD = 0.5

# Every non-UNSUPPORTED intent must appear at least this many times in the set.
MIN_QUESTIONS_PER_INTENT = 3

SESSION_KEY = 99998  # unique across the suite; no collision with other test files


# ── pure helpers (no DB) -------------------------------------------------------


def _routed(intent, **kw):
    """Build a RoutedQuestion like the existing test_agent_dag helpers."""
    base = dict(driver_name="Hamilton", gp_name="Monaco", year=2026)
    base.update(kw)
    return types.RoutedQuestion(intent=types.Intent(intent), **base)


def _tool_sequence(dag):
    """Return the tool names of a DAG in deterministic topological order."""
    order = orchestrator.topo_sort(dag)
    node_map = {n.id: n for n in dag.nodes}
    return [node_map[nid].tool_name.value for nid in order]


def _tool_overlap(actual, expected):
    """What fraction of the expected tools appear in the actual sequence? (0.0-1.0)"""
    actual_set = set(actual)
    expected_set = set(expected)
    if not expected_set:
        return 1.0
    return len(actual_set & expected_set) / len(expected_set)


# ── TOOL SEQUENCE (the main regression gate, pure / no DB) --------------------


class TestGoldenToolSequence:
    """Every question must trigger a DAG that keeps the expected tools."""

    @pytest.mark.parametrize(
        "entry",
        GOLDEN_SET,
        ids=[f"{e['expected_intent']}: {e['question'][:45]}" for e in GOLDEN_SET],
    )
    def test_expected_tools_present(self, entry):
        routed = _routed(entry["expected_intent"])
        dag = orchestrator.build_dag(routed)
        actual_tools = _tool_sequence(dag)
        overlap = _tool_overlap(actual_tools, entry["expected_tools"])

        assert overlap >= TOOL_OVERLAP_THRESHOLD, (
            f"Tool overlap {overlap:.0%} below threshold {TOOL_OVERLAP_THRESHOLD:.0%}\n"
            f"  question: {entry['question']}\n"
            f"  expected: {entry['expected_tools']}\n"
            f"  actual:   {actual_tools}"
        )


# ── META: is the golden set itself healthy? -----------------------------------


class TestGoldenSetHealth:
    def test_size_within_bounds(self):
        # Architecture doc says 30-50 questions. Too small and it's not representative;
        # too large and the LLM eval (T1.1) gets slow/expensive to run every PR.
        assert len(GOLDEN_SET) >= 30, f"Golden set too small: {len(GOLDEN_SET)}"
        assert len(GOLDEN_SET) <= 50, f"Golden set too large: {len(GOLDEN_SET)}"

    def test_all_entries_have_valid_intent(self):
        valid = {i.value for i in types.Intent}
        for entry in GOLDEN_SET:
            assert entry["expected_intent"] in valid, (
                f"invalid intent '{entry['expected_intent']}' in question: "
                f"{entry['question']}"
            )

    def test_all_entries_declare_expected_evidence_fields(self):
        # min_evidence_fields is the contract for what evidence must be present
        # for verify_evidence to pass on this question. Empty = a broken entry.
        for entry in GOLDEN_SET:
            fields = entry.get("min_evidence_fields", [])
            assert fields, f"missing min_evidence_fields for: {entry['question']}"

    def test_covers_all_non_unsupported_intents(self):
        covered = {e["expected_intent"] for e in GOLDEN_SET}
        for intent in types.Intent:
            if intent is types.Intent.UNSUPPORTED:
                continue
            assert intent.value in covered, f"intent '{intent.value}' not covered"

    def test_each_intent_has_min_questions(self):
        counts: dict[str, int] = {}
        for entry in GOLDEN_SET:
            counts[entry["expected_intent"]] = (
                counts.get(entry["expected_intent"], 0) + 1
            )
        for intent, count in counts.items():
            assert count >= MIN_QUESTIONS_PER_INTENT, (
                f"intent '{intent}' only has {count} questions "
                f"(need >= {MIN_QUESTIONS_PER_INTENT})"
            )

    def test_has_multi_intent_questions(self):
        # T1.1's whole point is handling questions that straddle intents, so the
        # set must contain some real multi-intent questions to measure that.
        # We model these as entries whose question mentions multiple concerns; for
        # the hardcoded planner they resolve to a single intent (the expected one),
        # but they document the boundary T1.1 must cross.
        multi = [e for e in GOLDEN_SET if e.get("multi_intent")]
        assert multi, "no multi-intent questions in golden set"


# ── EVIDENCE GATE (representative end-to-end, DB-backed) ----------------------


def _insert_session_and_driver(db_engine):
    with db_engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO sessions (session_key, year, gp_name, session_type, session_name)
                VALUES (:sk, 2026, 'Monaco Grand Prix', 'R', 'Race')
                """
            ),
            {"sk": SESSION_KEY},
        )
        conn.execute(
            text(
                """
                INSERT INTO drivers (driver_number, session_key, full_name, abbreviation,
                                     team_name, team_colour)
                VALUES (44, :sk, 'Lewis Hamilton', 'HAM', 'Mercedes', '#00D2BE')
                """
            ),
            {"sk": SESSION_KEY},
        )


def _insert_laps(db_engine, n=10):
    """Laps 1..n with a pit stop on lap 5/6, SOFT -> HARD (mirrors test_agent_dag)."""
    with db_engine.begin() as conn:
        for lap in range(1, n + 1):
            compound = "SOFT" if lap <= 5 else "HARD"
            pit_in = 123456.0 if lap == 5 else None
            pit_out = 234567.0 if lap == 6 else None
            conn.execute(
                text(
                    """
                    INSERT INTO lap_times (
                        session_key, driver_number, lap_number, lap_time_ms,
                        compound, pit_in_time_ms, pit_out_time_ms,
                        is_personal_best, deleted, recorded_at
                    ) VALUES (:sk, 44, :lap, 100000, :compound, :pit_in, :pit_out,
                              false, false, NOW())
                    """
                ),
                {
                    "sk": SESSION_KEY,
                    "lap": lap,
                    "compound": compound,
                    "pit_in": pit_in,
                    "pit_out": pit_out,
                },
            )


def _write_gz_artifact(tmp_path, lap_number, speeds):
    """Write a real artifact file for the before/after windows (mirrors
    test_agent_orchestrator). compute_speed_window reads these off disk."""
    storage_key = f"telemetry/session_{SESSION_KEY}/driver_44/lap_{lap_number}.json.gz"
    path = Path(tmp_path) / storage_key
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = [{"speed_kmh": s, "distance_m": 100.0} for s in speeds]
    with gzip.open(path, "wb") as f:
        f.write(
            json.dumps(
                {
                    "session_key": SESSION_KEY,
                    "driver_number": 44,
                    "lap_number": lap_number,
                    "samples": samples,
                }
            ).encode("utf-8")
        )
    with path.open("rb") as f:
        size = len(f.read())
    return storage_key, size


def _insert_artifacts(db_engine, tmp_path):
    """Artifacts for the before window (2,3,4) and after window (7,8,9) -- the
    laps _pit_laps() picks around the lap 5/6 stop with the default window."""
    entries = []
    for lap_number, speeds in [
        (2, [200.0, 210.0]),
        (3, [210.0, 220.0]),
        (4, [220.0, 230.0]),
        (7, [240.0, 250.0]),
        (8, [250.0, 260.0]),
        (9, [260.0, 270.0]),
    ]:
        storage_key, size = _write_gz_artifact(tmp_path, lap_number, speeds)
        entries.append((lap_number, storage_key, size, len(speeds)))
    with db_engine.begin() as conn:
        for lap_number, storage_key, size, count in entries:
            conn.execute(
                text(
                    """
                    INSERT INTO telemetry_artifacts (
                        session_key, driver_number, lap_number,
                        storage_key, storage_backend, format,
                        sample_count, size_bytes, checksum_sha256
                    ) VALUES (
                        :sk, 44, :lap, :key, 'local', 'json.gz', :count, :size, 'test'
                    )
                    """
                ),
                {
                    "sk": SESSION_KEY,
                    "lap": lap_number,
                    "key": storage_key,
                    "count": count,
                    "size": size,
                },
            )


def _cleanup(db_engine):
    with db_engine.begin() as conn:
        conn.execute(
            text("DELETE FROM telemetry_artifacts WHERE session_key = :sk"),
            {"sk": SESSION_KEY},
        )
        conn.execute(
            text("DELETE FROM lap_times WHERE session_key = :sk"), {"sk": SESSION_KEY}
        )
        conn.execute(
            text("DELETE FROM drivers WHERE session_key = :sk"), {"sk": SESSION_KEY}
        )
        conn.execute(
            text("DELETE FROM sessions WHERE session_key = :sk"), {"sk": SESSION_KEY}
        )


def test_evidence_gate_passes_for_representative_dag(
    app, db_engine, monkeypatch, tmp_path
):
    """The most complex hardcoded DAG (pit_stop_speed_delta) executes end-to-end
    and its evidence gate passes -- the recall baseline every future planner must
    at least match. This is a spot-check, not run per golden question: running all
    46 would be slow and the hardcoded planner is deterministic anyway."""
    _insert_session_and_driver(db_engine)
    _insert_laps(db_engine)
    _insert_artifacts(db_engine, tmp_path)
    monkeypatch.setattr(settings, "telemetry_artifact_dir", str(tmp_path))
    try:
        routed = _routed("pit_stop_speed_delta")
        dag = orchestrator.build_dag(routed)
        trace, env, failed_ids = orchestrator._execute_dag(dag, routed, None)
        verify = env["verify"]

        assert verify is not None, "expected a verify node in the DAG output"
        assert verify.passed, f"evidence gate refused: {verify.refusal_reason}"
        assert failed_ids == set(), f"unexpected failed nodes: {failed_ids}"
    finally:
        _cleanup(db_engine)
