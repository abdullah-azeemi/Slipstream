# Pitwall Agent Architecture v2

Last updated: 2026-09-02

Status: **L1–L31 complete and shipped. This doc supersedes `agent-architecture-v1.md`. It trims the shipped-lesson detail, documents how the current system works, and adds a tiered roadmap to evolve the deterministic pipeline into a true agentic system.**

---

## Goal Statement

Build a public Pitwall AI agent that answers race questions from stored F1 data while keeping cost, safety, and evidence quality under control.

The system's three invariants (do not break these):

1. **LLM plans. Tools compute. Verifier checks. LLM explains.**
2. **Zero hallucinations** — the evidence gate refuses rather than inventing numbers.
3. **Parameterized SQL only** — the LLM can choose a tool, never write SQL.

---

## Current System — How It Works (L1 – L31)

### Pipeline shape

The system is a **deterministic 5-stage pipeline**, not yet a fully agentic loop:

```
Route -> Plan (hardcoded DAG) -> Execute -> Verify -> Compose
```

| Stage | Where | What happens |
|---|---|---|
| Route | `llm.py:route_question` | LLM classifies the question into 1 of 10 `Intent`s and extracts entities (year, gp_name, driver_name, target_lap, compare_driver, window, session_type). |
| Plan | `orchestrator.py:build_dag` | A hardcoded `if/elif` chain maps intent → a fixed `ExecutionDAG` template of tool nodes. **The LLM has no influence over tool selection or order.** |
| Execute | `orchestrator.py:_execute_dag` | Topo-sorts the DAG (Kahn's algorithm) and runs it concurrently with `ThreadPoolExecutor(max_workers=4)`. Tool params bound by per-tool `_bind_*` functions. |
| Verify | `tools.py:verify_evidence` | Terminal node of every DAG. Checks session/driver exist and telemetry artifacts cover required laps. Failing → the answer is refused. |
| Compose | `llm.py:compose_answer` | Turns the structured evidence dict into prose, constrained to "never invent numbers". Falls back to a template string on LLM failure. |

### The 13 read-only tools (`tools.py`)

| Tool | Input → Output | Purpose |
|---|---|---|
| `resolve_session` | `ResolveSessionInput` → `ResolvedSession` | Find session by year + GP + type |
| `resolve_driver` | `ResolveDriverInput` → `ResolvedDriver` | Find driver by name/abbr/number |
| `find_pit_stops` | `FindPitStopsInput` → `PitStopsResult` | Detect pit stops from lap data |
| `gap_and_position_snapshot` | `GapPositionInput` → `GapPositionSnapshot` | Position/gap to leader at a lap |
| `fetch_race_control_window` | `RaceControlWindowInput` → `RaceControlWindowResult` | SC/VSC/flag events in lap window |
| `fetch_radio_messages` | `RadioWindowInput` → `RadioWindowResult` | Team radio clips in lap window |
| `fetch_weather_window` | `WeatherWindowInput` → `WeatherWindowResult` | Weather samples in lap window |
| `get_lap_telemetry_artifacts` | `GetLapTelemetryArtifactsInput` → `LapTelemetryResult` | Telemetry artifact metadata |
| `compute_speed_window` | `ComputeSpeedWindowInput` → `SpeedWindowResult` | Avg speed before/after pit stop |
| `inspect_lap_events` | `InspectLapEventsInput` → `InspectLapEventsResult` | Flag off-pace laps with reasons |
| `stint_degradation_scanner` | `StintDegradationInput` → `StintDegradationResult` | OLS degradation slope per stint |
| `telemetry_inspector` | `TelemetryInspectorInput` → `TelemetryInspectorResult` | Full telemetry load + resample + stats |
| `verify_evidence` | `VerifyEvidenceInput` → `VerifyEvidenceResult` | Evidence gate (terminal node) |

### Intent → DAG coverage

The router (`llm.py`) and `build_dag` (`orchestrator.py:267-488`) cover these intents, each on a fixed DAG: `PIT_STOP_SPEED_DELTA`, `LAP_EVENT_INVESTIGATION`, `TYRE_DEGRADATION_ANALYSIS`, `POSITION_GAP_TRACKING`, `RACE_CONTROL_EVENTS`, `TEAM_RADIO`, `WEATHER_CORRELATION`, `QUALIFYING_LAP_ANALYSIS`, `TELEMETRY_COMPARISON`, `UNSUPPORTED`.

### Error handling & multi-turn

- **Clarification flow** (`context.py`, `orchestrator.py:_clarify`): when the router cannot extract a required entity, the pipeline halts and asks a short counter-question. The user's reply is merged onto the previous turn's routing context (`context.py:merge_context`) and the **same DAG re-runs** with the resolved param. This is the only multi-turn reasoning today — a slot-filling pattern.
- **Dependency failure propagation**: a failed node fails all downstream dependents. No retry, no alternative path.
- **Evidence gate refusal**: missing evidence → refuse rather than invent.

### SSE protocol — `POST /api/v1/agent/query/stream`

| Event | Payload |
|---|---|
| `dag_init` | `{ nodes, edges }` |
| `node_start` | `{ node_id, label, query_preview }` |
| `node_complete` | `{ node_id, duration_ms, summary, status }` |
| `node_error` | `{ node_id, error, duration_ms }` |
| `final` | Full `AgentAnswer` as JSON |
| `done` | `{}` |

JSON endpoint `POST /api/v1/agent/query` kept for non-streaming clients.

### Key files

**Backend** — `apps/backend/src/backend/agent/`:
`types.py` (contracts), `tools.py` (13 tools), `orchestrator.py` (DAG build/execute/compose), `llm.py` (router + composer), `context.py` (turn merge), `persistence.py` (runs/tool calls/conversations), `auth.py` (Clerk JWT). SSE in `api/v1/agent.py`.

**Frontend** — `apps/frontend/`:
`app/agent/page.tsx` (orchestration, 3-col responsive layout), `types/agent.ts`, `lib/api.ts`, `lib/dag-layout.ts`, `lib/node-inspector.ts`, `lib/chart-data.ts`, components under `components/agent/` (ReasoningGraphCanvas, AgentDAGNode, AnimatedLaserEdge, NodeInspectorDrawer, EvidenceCards, AgentProgressRail, AgentSpeedChart, TelemetryOverlayChart, CircuitHeatmap, TyreDegradationChart, RefusalBanner, ToolTraceAccordion, RadioClip, WeatherEvidence).

### Conventions — do not break these

- Tools live in `tools.py`; contracts in `types.py`; SQL is always `text()` + `:param` binds, never f-strings.
- Every tool: one frozen input dataclass → one frozen output dataclass.
- Typed errors: `NotFoundError` = data not found, `DataError` = unusable/unsupported.
- SQL gathers, pure Python derives. Pure helpers take `list[dict]` and no DB.
- `ORDER BY` everywhere, `round(x, 2)` for computed numbers.
- `extensions.engine` only accessible inside `create_app()`. Standalone scripts use `create_engine(settings.db_url)` directly.
- House quality: `uv run ruff check`, `uv run ruff format --check`, `uv run pytest apps/backend/tests/`, `pnpm lint`, `pnpm tsc --noEmit`, `pnpm build`.

---

## Architecture Assessment — Current State vs a Full Agent

The shipped system is **well-engineered and safe** (read-only tools, SQL never from the LLM, evidence gating, audit trail). But it is a **deterministic pipeline, not an agentic system**. The table below marks what a full agent has vs. what exists today.

| Capability | Current | Target (full agent) |
|---|---|---|
| **Dynamic tool selection** | Hardcoded `if/elif` per intent (`orchestrator.py:267-488`) | LLM picks tools from a registry based on reasoning about the query |
| **Planning** | None — plan is intent→DAG mapping | LLM generates a multi-step plan, possibly iteratively |
| **Self-reflection / self-critique** | None | LLM reviews tool outputs, decides if more evidence is needed |
| **Retry / replanning** | Fail-closed, no retry | Retry transient failures or replan with alternative tools |
| **Multi-turn reasoning** | Slot-filling clarification only (`context.py`) | Chain-of-thought across multiple tool-call rounds |
| **Long-term memory** | None (only last-turn routing context) | Vector store, user preferences, historical patterns |
| **Tool-output interpretation** | Tools run blind; LLM sees results only at compose time | LLM inspects each output before deciding the next step |
| **RAG** | Config exists but unused (`config.py`: `race_vector_index_dir`, `race_vector_table`) | Retrieve relevant race intelligence to ground answers |
| **Adaptive complexity** | Every intent gets the same DAG depth | Simple queries → shallow DAG; complex → deeper exploration |
| **Hallucination guardrails** | Composer prompt says "never invent numbers" | Structured-output validation + citation/fact-check step |
| **Learning from feedback** | None | Track user ratings, refine tool selection over time |
| **Cost optimization** | Both router & composer use `gpt-4o-mini` (`config.py`) | Route simple intents to cheap models, complex to capable |

---

## Agent Improvement Roadmap — Tiered

> This roadmap replaces the old "L30+ Future Agent Capabilities" backlog in v1. It is prioritized top-down by impact and cost. Each item is a requirements spec intended for direct implementation (or review by an LLM like Claude). Tiers must be done in order — Tier 1 unlocks the others.

### Tier 1 — True agentic behavior (high impact, moderate complexity)

The goal of Tier 1 is to let the LLM **drive the execution** rather than being a fixed template lookup. This is the highest-leverage change and must land before Tier 2.

---

#### T1.1 — Dynamic tool planning

**Goal:** Replace the hardcoded `build_dag()` `if/elif` chain (`orchestrator.py:267-488`) with an LLM planner that generates the DAG from a **tool registry**. The LLM decides which tools to call and in what dependency order for any query — not just the 10 predefined intents.

**Files to change:**
- `apps/backend/src/backend/agent/tools.py` — expose a `TOOL_REGISTRY` of `{name, description, input_schema, output_schema}` metadata (one entry per tool, derived from the frozen dataclass contracts).
- `apps/backend/src/backend/agent/llm.py` — add `plan_dag(question, routed, registry) -> ExecutionDAG`; new system prompt lists the registry with input schemas and instructs the model to emit a JSON DAG `{nodes:[{tool, label, params, depends_on}], edges:[...]}`.
- `apps/backend/src/backend/agent/orchestrator.py` — `build_dag()` calls `plan_dag()`; keep `topo_sort` + `_execute_dag` as-is (they are registry-agnostic). Add validation/cycle-guard on the LLM-emitted DAG and a fallback to the template DAG on plan failure.
- `apps/backend/src/backend/agent/types.py` — if needed, loosen `DAGNode` to allow arbitrary tool names from the registry.

**Key design decisions:**
- The planner must be **schema-constrained** (structured output `response_format` or strict JSON prompt) so node inputs are always valid dataclasses.
- **Never let the LLM invent tools or SQL.** The returned tool names must be validated against `TOOL_REGISTRY` before binding; unknown names → fallback or refuse.
- The `_bind_*` per-tool parameter binding already exists (`orchestrator.py:50-226`) and can be retained — only the *choice* of nodes becomes dynamic.
- Keep `UNSUPPORTED` as the outcome when the planner cannot satisfiably ground the question.

**Acceptance criteria:**
- A question that spans two intents (e.g. "Did the weather affect Verstappen's tyre degradation?" triggers weather + degradation tools in one DAG) produces a correct multi-tool DAG without a new template.
- LLM-emitted DAG is always topologically valid (tests assert `topo_sort` succeeds; no cycles).
- Unknown tool names are caught at bind time → `NotFoundError`/refusal, never a runtime crash.
- Existing 119 tests still pass; new unit tests cover planner JSON parsing + cycle guard + unknown-tool rejection.

---

#### T1.2 — Iterative reasoning loop

**Goal:** Let the agent run in **rounds**. After a batch of tools executes, the LLM reviews the results and decides either "answer is complete → compose" or "I need more evidence → call more tools with adjusted params". This converts the single-shot DAG into a multi-step loop.

**Files to change:**
- `apps/backend/src/backend/agent/llm.py` — add `assess_evidence(question, evidence, registry) -> list[ToolCallRecord | None]`: returns an optional next batch of tool calls, or `None` when satisfied.
- `apps/backend/src/backend/agent/orchestrator.py` — wrap `_execute_dag` in a loop (`max_rounds`, e.g. 3); each round runs the pending nodes, appends results to `env`, then calls `assess_evidence`. The `verify_evidence` node becomes the terminal exit of the loop.
- `apps/backend/src/backend/agent/types.py` — add a `round` field to `DAGNode`/`ToolCallRecord` so the same tool can legally appear across rounds.

**Key design decisions:**
- **Bounded rounds (max 3)** to cap cost and latency; if `assess_evidence` still isn't satisfied at the cap, refuse via the existing evidence gate rather than loop forever.
- Track per-round tool calls so the audit trail (`agent_tool_calls`) stays complete and the frontend DAG can render repeated nodes (rounds as distinct nodes).
- Preserve the zero-hallucination invariant: additional evidence is always derived from real tool output, never guessed.

**Acceptance criteria:**
- A query requiring a second pass (e.g. an initial pit-stop query that then needs a safety-car check in the same window) triggers a second round automatically.
- Round count and `max_rounds` are bounded; loop termination is guaranteed and tested.
- Full per-round tool-call history is persisted for the tool-trace accordion.

---

#### T1.3 — Tool-output interpretation (mid-execution feedback)

**Goal:** Feed each tool's output back to the planner **before the next node**, so later nodes' parameters adapt to earlier results (e.g. "pit-stop data shows two stops → analyze both windows", not just the first). This bridges the gap between "run blind then compose" and true reactivity.

**Files to change:**
- `apps/backend/src/backend/agent/llm.py` — extend `plan_dag`/`assess_evidence` to accept the accumulated `env`/evidence dict and emit per-node `input_params` that reference earlier outputs.
- `apps/backend/src/backend/agent/orchestrator.py` — when binding node params, allow the LLM-emitted params to override generic `_bind_*` defaults (a **choose-over-default** model, never a blind overwrite that breaks contracts).
- `apps/backend/src/backend/agent/types.py` — ensure `DAGNode.input_params` can express references to prior node outputs.

**Key design decisions:**
- This is the "binder fallback chain" from L30 generalized: node `input_params` (possibly LLM-derived) → routed entities → tool-derived default. Each hop is a fallback, never an unchecked overwrite.
- The LLM still **cannot write SQL and cannot introduce new data**. It may only choose tool + parameters.

**Acceptance criteria:**
- A node's parameters can pull values computed by a prior in-DAG node, validated against the tool's input schema.
- Any reference to a not-yet-run node is rejected at bind time (dependency must already exist in `env`), falling back to the sane default.
- `_execute_dag` concurrent execution still correct; a node waiting on mid-execution feedback runs only after its dependencies resolve.

---

### Tier 2 — Memory & robustness (medium impact)

Requires Tier 1 (adaptive planning) to be meaningful.

---

#### T2.1 — Long-term memory + RAG

**Goal:** Wire up the currently unused RAG settings in `config.py` (`race_vector_index_dir`, `race_vector_table`). Give the agent durable memory: past conversations, race insights, and user preferences — retrieved to ground answers and resolve shortcuts (e.g. "my favourite driver").

**Files to change:**
- New `apps/backend/src/backend/agent/memory.py` — embed + upsert + query helpers (vector index over race insight/notes and conversation summaries).
- `apps/backend/src/backend/agent/orchestrator.py` / `llm.py` — before planning, retrieve relevant memory hits and inject them as grounding context into the planner and composer prompts.
- `apps/backend/src/backend/agent/persistence.py` — persist user preferences (favourite drivers/teams) and per-session insights that qualify as durable.
- `config.py` — activate the existing vector settings (add embeddings provider + model).

**Key design decisions:**
- Memory is **grounding, not authority**: retrieved snippets are passed as context the same way evidence is — they never replace the evidence gate, and any recalled fact must still be re-verifiable against the DB or refused.
- Embeddings model, chunking, and the vector table schema must be added via a migration; the table lives in Postgres (or a local FAISS/annoy index per the existing `race_vector_index_dir` setting).
- Privacy: memory is per-Clerk-user, opaque to other users; admin flag to disable.

**Acceptance criteria:**
- A returning user asking "how was my favourite driver's weekend?" resolves the entity from user memory and answers.
- Recalled context is clearly attributed and still passes `verify_evidence`; a stale recalled fact is refused, not silently trusted.
- Migration + test cover upsert/query round-trip.

---

#### T2.2 — Retry with backoff

**Goal:** Distinguish transient failures (DB connection blip, API timeout) from permanent ones (missing data). Retry transients with exponential backoff instead of failing closed immediately.

**Files to change:**
- `apps/backend/src/backend/agent/orchestrator.py` — `_execute_dag.run_node` (line ~533): wrap tool calls in a retry helper.
- `apps/backend/src/backend/agent/types.py` — add a `RetryableError` distinct from `NotFoundError`/`DataError`.

**Key design decisions:**
- Only `RetryableError` and a defined class of timeout/connection errors retry (e.g. max 3 attempts, backoff 200ms/400ms/800ms). `NotFoundError` and `DataError` never retry.
- Retries are transparent to the SSE protocol — one `node_start`/one terminal event per node; retry happens internally.

**Acceptance criteria:**
- Tests simulate a transient failure and assert the tool succeeds by the 2nd or 3rd attempt with backoff, while a permanent `NotFoundError` still resolves immediately to fail-closed.
- No unbounded retry; counted and capped.

---

#### T2.3 — Adaptive complexity

**Goal:** Match DAG depth to question difficulty. Simple factual queries get a shallow DAG (fewer nodes, fewer tokens, lower cost); compound analytical queries get deeper exploration. Distinct from T1.1 — this tunes *depth*, not *selection*.

**Files to change:**
- `apps/backend/src/backend/agent/orchestrator.py` — after `plan_dag`, apply a post-step that prunes obviously unneeded branches for simple intents (e.g. skip telemetry inspection on a pure timing question).
- `apps/backend/src/backend/agent/llm.py` — `plan_dag` receives an optional `complexity` hint (from router: entity count, conjunctions, analytical verbs) to size the plan.

**Key design decisions:**
- Complexity is a steered *cap*, not a hard rule; the planner can still exceed it when legally grounded.
- Keep the answer quality invariant — pruning must never drop a node the evidence gate needs (verify always remains).

**Acceptance criteria:**
- Timing on a representative simple vs compound query shows measurable node/token/cost reduction.
- `verify_evidence` still runs on every pruned plan; refusal path unaffected.

---

### Tier 3 — Quality & cost (polish)

---

#### T3.1 — User feedback loop

**Goal:** Let users rate answers (thumbs up/down) and use that signal to refine future behavior — e.g. steer the composer's tone/verbosity, or feed "frequently useful tool chains" back into the planner.

**Files to change:**
- Backend: `persistence.py` + migration to store rating rows keyed to `agent_runs`; a lightweight endpoint to record ratings.
- Frontend: rating control on `app/agent/page.tsx` answer cards.
- `orchestrator.py`/`llm.py`: optionally read aggregated ratings into prompts.

**Acceptance criteria:**
- Ratings persisted and queryable per run; admin can see distribution.
- No privacy leak; ratings are per-user.

---

#### T3.2 — Cost routing

**Goal:** Route simple intents to a cheaper/faster model and complex analytical work to a more capable model, using the `config.py` model settings.

**Files to change:**
- `apps/backend/src/backend/agent/llm.py` — model-choice helper based on `complexity`/intent.
- `config.py` — add per-model-tier configuration.

**Acceptance criteria:**
- Admin stats reflect cost per model tier; simple vs complex queries map to distinct model tiers.
- No quality regression on complex-tier questions.

---

#### T3.3 — Structured-output validation

**Goal:** Validate every LLM-produced structure (router JSON, plan DAG, compose markdown constraints) against a schema before use, surfacing a clean fallback instead of a parse crash.

**Files to change:**
- `apps/backend/src/backend/agent/llm.py` — add schema validators (already partly done via `_coerce_*`/`_clean_*` helpers); formalize into per-call validators.
- `apps/backend/src/backend/agent/types.py` — schema definitions.

**Acceptance criteria:**
- Malformed LLM output triggers a typed `LLMError` → fallback path (template compose / template DAG), never a 500.

---
