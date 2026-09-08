# L28 — Intent Classifier (v3 §1.1) + Driver Style Clustering (v3 §2.2)

Status: **done**. Backend + ML package. `uv run ruff check` provider-clean on
the touched sources; `pytest apps/backend/tests/test_agent_llm.py
apps/backend/tests/test_intent_classifier.py apps/backend/tests/test_agent_style.py`
31/31 passing. New clustering job lives in `packages/ml`, not `apps/backend`.

This file records the delivery. Part B follows `docs/agent-architecture-v3.md`
§2.2: PCA + K-Means on season features -> archetypes -> an agent tool that
answers "How does X's style compare to Y's?".

## Part A — Local intent classifier (v3 §1.1, schema §5.2)

### What was built

- `agent/intent_classifier.py` (new): `classify_intent()` returns a typed,
  frozen `IntentClassification` dataclass —
  `requires_compute`, `requires_prediction`, `intent_category`
  (descriptive|comparative|predictive|chitchat), `suggested_tools`.
  Keyword/pattern heuristics only: deterministic, zero-cost, runs on **every**
  question — semantic-cache hits included.
- `agent/llm.py`:
  - `route_question()` now runs the local classifier first, then overlays its
    flags on the LLM entity parse via `_apply_local_flags()` — on both the
    cache-hit and cache-miss paths.
  - Fixed a real bug: the final line rebuilt a fresh
    `parse_routed_question(...)`, silently discarding the flags set just
    above it.
  - `compose_answer()` gained `intent_category`; the composer prompt uses a
    per-category guide (comparison structure, cautions for predictions,
    warm-short for chitchat). Same model, same cost.
- `agent/types.py`: `RoutedQuestion` carries `intent_category` +
  `suggested_tools` (defaulted, so existing construction/serialization is
  unaffected).
- `agent/orchestrator.py`: `_compose` threads `intent_category` into the
  composer.
- `agent/semantic_cache.py`: bug fix — private `_cosine_similarity()` was
  being called as `self.cosine_similarity` (would have raised).

### Tests

- `tests/test_intent_classifier.py` (new): compute / diagnostic / prediction /
  comparative / chitchat / tool-suggestions cases.
- `tests/test_agent_llm.py`: two regression tests encoding the fixed bugs
  (flags survive on the fresh path; flags survive on a cache hit).
- Added an autouse `_isolate_cache` fixture: the semantic cache is a
  module-level singleton shared across tests, and one test storing a query
  contaminated the next (order-dependent `router_unknown_intent` vs
  `router_unparseable`). Each test now gets a fresh `SemanticCache()` — fixes
  the class of bug, not one symptom.

## Part B — Driver style clustering (v3 §2.2)

### What was built

- `packages/ml/src/ml/driver_clustering.py` (new): standalone training job —
  `uv run --directory packages/ml python -m ml.driver_clustering --year 2026`.
  Computes season features (race results, lap times, quali telemetry) with
  LEFT JOINs so tople drivers keep rows; only features computable from
  existing tables are filled (wet/kerb features stay NULL rather than faked).
  Pipeline: `StandardScaler` -> `PCA(n<=5)` -> `KMeans(k=4)` -> per-centroid
  archetype labels (signed handling for negative-better features). Upserts
  (ON CONFLICT, never deletes) into `driver_features` and `driver_embeddings`
  (embeddings, explained variance, pca_loadings, axis_labels, archetype).
- Agent tool (`types.py`, `tools.py`, `planner.py`, `orchestrator.py`,
  `llm.py`):
  - `Intent.DRIVER_STYLE_COMPARISON` + `ToolName.DRIVER_STYLE_COMPARE` +
    `DriverStyleCompareInput/Result/Profile/Trait` contracts.
  - `tools.driver_style_compare()` reads embeddings + features, computes trait
    percentiles vs the season's field, returns deterministic summary text.
    `year=0` resolves the most recent season with data.
  - `planner.TOOL_REGISTRY` entry; orchestrator `_TOOLS` + binder; template
    DAG branch returns a single-node graph (style is season-level — no
    session/driver resolution needed); compose fallback + `AgentAnswer.driver_style`.
  - Router prompt lists `driver_style_comparison`; added to
    `_CAPABLE_INTENTS` so analytical style questions escalate the model.

### Tests

- `tests/test_agent_style.py` (new, DB-free): `_percentile_rank` math,
  `_build_style_summary` archetype comparison, and template-DAG shape
  (single `style` node, no edges).

## Contract notes

- Style data only exists after the clustering job has run for a season; the
  tool returns an explicit "run the clustering job" summary otherwise (no
  crash, no hallucinated archetypes).
- `suggested_tools` is emitted + serialized for the v3 §5.2 contract; nothing
  consumes it yet — the agentic planner is the intended future consumer.
- FastAPI/Pydantic §5.2 schemas are not used; the agent stack is frozen
  dataclasses everywhere, so the classifier matches that (consistency beats
  the letter of the spec).

## Decisions / deviations worth remembering

- Chitchat only wins when nothing else matches ("hey" + a compute keyword is
  compute, not chitchat).
- `_CAPABLE_INTENTS` gained the style intent: comparative analytics is exactly
  the case model escalation exists for.
- Formatting: repo-wide `ruff format` drift is pre-existing (30 files incl.
  untouched ones) — left alone to avoid a giant unrelated diff.

## Verify

```bash
uv run ruff check apps/backend/src/backend/agent packages/ml/src/ml/driver_clustering.py
uv run pytest apps/backend/tests/test_agent_llm.py apps/backend/tests/test_intent_classifier.py apps/backend/tests/test_agent_style.py
uv run --directory packages/ml python -c "import ml.driver_clustering"   # syntax check only
```

To produce data (your choice — a training write, local/dev DB only):

```bash
uv run --directory packages/ml python -m ml.driver_clustering --year 2026
```