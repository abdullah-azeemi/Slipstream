# L24 — Dynamic DAG Planner & Concurrent Runner (COMPLETE)

Status: **done**. 117/117 backend tests passing (106 + 11 new), ruff + ruff format clean.

This file replaces the older "continuation" style notes. The actual code lives in
`apps/backend/src/backend/agent/orchestrator.py`, contracts in `agent/types.py`,
router upgrades in `agent/llm.py`, tests in `apps/backend/tests/test_agent_dag.py`.

## What was built

Replaced the fixed `route -> plan -> execute -> verify -> compose` pipeline with a
dynamically built **execution DAG**: the router decides the intent, `build_dag`
materializes the per-intent graph, and a bounded thread pool runs independent
branches in parallel.

- `types.py` — new `DAGNode`, `DAGEdge`, `ExecutionDAG` contracts;
  `RoutedQuestion` extended with `compare_driver_name` + `target_lap`;
  `ToolCallRecord.node_id` links every trace entry back to a graph node.
- `llm.py` — router prompt now covers all four supported intents and extracts
  `compare_driver` + `target_lap`; new coercion helpers `_coerce_target_lap`,
  `_coerce_compare_driver`.
- `orchestrator.py` —
  - `build_dag(routed)`: `session -> driver` always; pit-stop adds
    `pits -> artifacts` and `pits -> window`; lap-event adds `laps`; degradation
    adds `stints`; telemetry comparison resolves a second driver (`driver_cmp`)
    before `telemetry`. Every graph ends in `verify`.
  - `topo_sort` — Kahn's algorithm; raises `DataError` on cycles or duplicate ids.
  - `_execute_dag` — `ThreadPoolExecutor(max_workers=_MAX_WORKERS=4)` submits every
    node whose dependencies are resolved; on any node error the remaining graph
    **fails closed** (dependents get a `dependency failed` error record and never
    execute); the trace is re-sorted to graph order for deterministic output.
  - `_TOOLS` registry (enum -> tool fn) + `_BINDERS` registry via `@_register`;
    binders translate `params` + shared `env` into the typed tool inputs.
  - `_compose` / `run` rewritten: emits `stage` (route/compose), `dag_init`,
    `node_start`, `node_complete`, `node_error` SSE events; typed refusal path
    preserved; LLM compose falls back to structured fallback text on `LLMError`.

## Contract notes (types.py)

- `DAGNode` fields: `id` (unique), `tool_name`, `label`, `description`,
  `depends_on: tuple[str, ...] = ()`, `input_params: dict = field(default_factory=dict)`.
- `DAGEdge.source/target` reference node `id` strings (derived from `depends_on`).
- Events observed by tests: `dag_init`, `node_start`, `node_error`; completion is
  emitted as `node_complete` with `label` + `summary`.

## Decisions / deviations worth remembering

- Fail-closed is authoritative: if ANY node errored, `verify` does not run and the
  answer is a refusal ("one or more evidence steps failed"). Never invent numbers.
- Deterministic trace: completion order is re-sorted by `position` from `topo_sort`
  so the tool trace always matches graph order regardless of thread timing.
- `InspectLapEventsInput` uses `window_laps` (L23 contract) — the binder maps the
  router's `laps_window` param into it.

## Verify

```bash
uv run ruff check apps/backend/src/backend/agent apps/backend/tests
uv run ruff format --check apps/backend/src/backend/agent apps/backend/tests/test_agent_dag.py
uv run pytest apps/backend/tests -q   # 117 passed
```

Postgres must be up on `localhost:5432` (tests create tables via the conftest).
Note: `brew services` is currently broken; start it directly with
`pg_ctl -D /opt/homebrew/var/postgresql@18 -l /opt/homebrew/var/log/postgresql@18.log start`.

## Next steps

- Commit this work (message suggestion):
  `feat(agent): replace fixed pipeline with dynamic ExecutionDAG planner and concurrent runner`
- Update `docs/agent-architecture-v1.md` L23 + L24 progress ticks (commit refs).
- Next lesson: L25 — Visual Thinking Graph UI (n8n / React Flow style reasoning
  canvas with live SSE execution pulses).