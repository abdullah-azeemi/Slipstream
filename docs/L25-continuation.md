# L25 — Visual Thinking Graph UI (COMPLETE)

Status: **done**. `pnpm lint` clean, `pnpm test` 21/21 passing (4 new layout tests),
`pnpm build` compiles and typechecks. No backend changes — SSE already emits the DAG
events from L24.

This file records the delivery. Code lives in `apps/frontend` (`lib/dag-layout.ts`,
`components/agent/{nodes,edges}/`, `components/agent/ReasoningGraphCanvas.tsx`,
`app/agent/page.tsx`, `types/agent.ts`, `app/globals.css`, `package.json`),
tests in `apps/frontend/lib/dag-layout.test.ts`.

## What was built

An n8n / React Flow style reasoning-graph canvas driven by the orchestrator's live
SSE events, per `docs/agent-architecture-v1.md` §6.

- `@xyflow/react@^12.11.5` added to `apps/frontend/package.json`.
- `lib/dag-layout.ts` — pure function `layeredLayout(nodes)` maps each node to an
  `(x, y)` via longest-path depth (Kahn-style layers): independent roots share a
  column, dependents sit exactly one column to the right, columns are centred
  vertically, cycle guard means it can never hang.
- `types/agent.ts` — `AgentDAGNode`, `AgentDAGEdge`, `AgentNodeState`
  (`idle | running | done | error`), `AgentNodeRunInfo`; `AgentProgressEvent`
  extended with `node_id`, `nodes`, `edges`, `summary`, `error`.
- `components/agent/nodes/AgentDAGNode.tsx` — dark `#111` card: tool icon +
  Rajdhani uppercase title, mono subtitle, right-hand state badge (spinning gold
  loader running, emerald `<ms>` done, red X error, grey dot idle); left/right flow
  handles; state ring border (idle `#2A2A2A`, running gold + `nodeRunningPulse`,
  done emerald, error `#E8002D`).
- `components/agent/edges/AnimatedLaserEdge.tsx` — SVG bezier via `getBezierPath`;
  tone from live state (target running → animated amber dashed `edgeFlow`,
  target error → red, source done → emerald, else idle slate).
- `components/agent/ReasoningGraphCanvas.tsx` — ReactFlow wrapper: dots background,
  fitView, zoom controls, `nodesConnectable={false}`, attribution hidden, and an
  `onSelectNode` click hook (reserved for L26). Node data uses
  `satisfies AgentDAGNodeData`.
- `app/agent/page.tsx` — `handleFrame` now dispatches each `progress` payload by
  `payload.type`: `dag_init` imports the node/edge specs; `node_start` /
  `node_complete` / `node_error` fold into `turn.nodeStates` via the pure
  `applyNodeEvent` helper. Latest DAG turn renders the canvas above the chat; panel
  gutter shows `{n} nodes / {m} edges`.
- `app/globals.css` — Rajdhani into the Google Font import + `.rajdhani` utility;
  `graphEdgeFlow` / `nodeRunningPulse` keyframes and `edge-laser.edge-*` classes;
  dark theme for xyflow zoom controls.

## Contract notes

- Event names (inside `event: progress` payloads): `type == 'stage'` for
  route/compose, `dag_init` carries `nodes`/`edges`, `node_start` /
  `node_complete` / `node_error` carry `node_id` (+ `duration_ms`, `summary` /
  `error`).
- Deterministic layout means two seeds may share a column (e.g. `session`/`driver`)
  with symmetric `y`; dependents are always one `DAG_NODE_W + DAG_GAP_X` to the
  right.
- Click-wiring: `onSelectNode` exists on the canvas and is passed through from
  `page.tsx` as `onSelectNode={...}` — the L26 drawer plugs in there.

## Decisions / deviations worth remembering

- Kept React Flow (spec-required) — `@xyflow/react` v12, React 19 compatible.
- Custom node width fixed at `240px` to match `DAG_NODE_W` so bezier handles align.
- `AgentDAGNodeData` carries an index signature because xyflow's
  `Node<Data, Type>` generic requires `Data` to satisfy `Record<string, unknown>`
  (TS does not infer that for interfaces).
- Edge tone derives from target-first, then source; never from time — no timer
  bookkeeping in the canvas.
- The `event: progress` payloads are cumulative per turn: node states are stored
  per `ChatTurn`, so re-rendering history replays each turn's final graph.

## Verify

```bash
cd apps/frontend
pnpm install
pnpm lint
pnpm test      # 21 passed (4 new dag-layout tests)
pnpm build
```

Live check: backend up (Postgres via `pg_ctl`, Flask run) + `pnpm dev`, ask a
pit-stop question — graph lights gold (running) → emerald (done) with animated edges.

## Next steps

- Commit message used:
  `feat(ui): add live reasoning-graph DAG canvas with animated execution states`
- `docs/agent-architecture-v1.md` L25 progress tick recorded (commit `19efc48`).
- Next lesson: L26 — Node Inspector Drawer (the `onSelectNode` hook is already
  wired on the canvas).