# L26 — Node Inspector Drawer & Query Traces (COMPLETE)

Status: **done**. Frontend-only. `pnpm lint` clean, `pnpm test` 24/24 passing
(+3 new `node-inspector` tests), `pnpm build` compiles and typechecks. No backend
changes — orchestrator already stamps `ToolCallRecord.node_id` (`asdict` carries it).

This file records the delivery. Code lives in `apps/frontend` (`types/agent.ts`,
`lib/node-inspector.ts`, `components/agent/NodeInspectorDrawer.tsx`,
`app/agent/page.tsx`), tests in `apps/frontend/lib/node-inspector.test.ts`.

## What was built

Click on any DAG node → a dark slide-over drawer shows that node's tool identity,
status, duration, `depends on` chips, and its raw query/payload + evidence output.

- `types/agent.ts` — `ToolCallRecord` gained `node_id?: string | null`, so the
  persisted trace (`reply.trace`) can be joined 1:1 back onto DAG node ids. The
  backend never needed a change: `orchestrator.run_node` already writes
  `node_id=node.id` into every `ToolCallRecord` and `_serialize_answer` returns
  `asdict(answer)`.
- `lib/node-inspector.ts` — pure `buildNodeInspectorView(node, info, call)` →
  `NodeInspectorView`. Null-safe: missing node returns an empty/idle view; missing
  live run-info falls back to the trace call's `duration_ms` /
  `output_summary` / `input_summary` / `error`. Keeps graph spec data
  (`description`, `depends_on`, `input_params`) off the canvas and in one shape
  the drawer renders directly.
- `lib/node-inspector.test.ts` — 3 tests: identity fields mirrored; trace-call
  fallback when run info is missing; safe defaults when the node is missing.
- `components/agent/NodeInspectorDrawer.tsx` — absolute `inset-y-0 right-0` dark
  overlay inside the canvas' `relative` wrapper (`bg-[#0d0d0d]`, `#2A2A2A`
  borders to match the graph). Header: Rajdhani tool name + mono `label`/`nodeId`
  + close (`X`) button. Body: state badge (gold running / emerald done / red
  error / slate idle) + `durationMs`, description, `depends on` chips, and two
  `pre` blocks — **query / payload** (`call.input_summary`, the SQL/storage-string
  per §6.3) and **evidence / output** (`call.output_summary`), plus a red error
  block when `call.error` is set.
- `app/agent/page.tsx` — `selectedNodeId` state; `selectedNodeView` memo scans
  turns newest-first to find the node, its live state, and its trace record
  (`turn.reply?.trace.find(t => t.node_id === selectedNodeId)`); canvas was
  wrapped in `<div className="relative">`, got `onSelectNode={setSelectedNodeId}`,
  and the drawer renders inside it (`onClose` clears the selection).

## Contract notes

- `AgentProgressEvent` already carried `node_id` from L25 — this lesson only
  mirrored it onto the final `ToolCallRecord` so the *completed* answer can also
  be drilled into by node.
- The drawer overlays the canvas (380px tall) — `w-[300px]`, scrollable body,
  `z-10` inside the relative wrapper, so it never escapes the graph column.
- Selection is per-page state, not per turn: closing it simply clears
  `selectedNodeId`; the memo recomputes to `null` if the node no longer exists.

## Decisions / deviations worth remembering

- No backend work was needed, but the join only works once a *final* answer has
  streamed (trace lives on `reply.trace`). While a node is still `running` the
  drawer shows the node `label`/`description` + live `nodeStates` and falls back
  to `"{"no input recorded"}"` until the trace lands.
- The drawer reuses the graph's exact palette (`#0d0d0d`, `#2A2A2A`, `#2CF4C5`,
  `#FFD700`, `#E8002D`) rather than the light page theme, so it reads as part of
  the canvas.

## Verify

```bash
cd apps/frontend
pnpm lint
pnpm test      # 24 passed (3 new node-inspector tests)
pnpm build
```

Live check: backend up (Postgres via `pg_ctl`, Flask run) + `pnpm dev`, ask a
pit-stop question, click a node — drawer opens with state/duration and the
query/evidence payload; `X` closes it.

## Next steps

- Commit message used: `feat(ui): add node inspector drawer for DAG reasoning traces`
- `docs/agent-architecture-v1.md` L26 progress tick recorded (see commit).
- Next lesson: L27 — Rich Multi-Channel Telemetry Visualizations
  (`TelemetryOverlayChart`, `CircuitHeatmap`, `TyreDegradationChart`).