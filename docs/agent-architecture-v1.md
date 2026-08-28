# Pitwall Agent Architecture v1

Last updated: 2026-08-28 (L28 shipped, L29 planned)

Status: **L1–L28 complete and shipped. L29 (continuous conversation) is the next planned work.**

---

## Completed Work — Summary (L1 – L27)

Everything below is done and committed. Do not re-implement it. Read this to understand what already exists before starting L28.

### Backend (`apps/backend/src/backend/agent/`)

| File | What it does |
|---|---|
| `types.py` | All frozen dataclasses and enums: `Intent`, `ToolName`, `DAGNode`, `DAGEdge`, `ExecutionDAG`, `AgentAnswer`, `RoutedQuestion`, `ToolCallRecord`, `Plan`, `LLMError`, `AgentError`, `NotFoundError`, `DataError`, plus every tool input/output contract |
| `tools.py` | 8 read-only tools: `resolve_session`, `resolve_driver`, `find_pit_stops`, `get_lap_telemetry_artifacts`, `compute_speed_window`, `inspect_lap_events`, `stint_degradation_scanner`, `telemetry_inspector`. All SQL uses `text()` + bound params. Pure Python helpers are DB-free and unit-testable. |
| `orchestrator.py` | Dynamic DAG planner: `build_dag`, `topo_sort`, `_execute_dag` (concurrent `ThreadPoolExecutor(max_workers=4)`). `run(question, progress=...)` emits SSE progress events. `_compose` attaches telemetry/stint chart data to the final answer. |
| `llm.py` | OpenRouter adapter (stdlib `urllib`, no new deps). `route_question` → `(RoutedQuestion, cost)`. `compose_answer` → `(str, cost)`. Router covers all 4 intents + entity extraction (year, gp_name, driver_name, target_lap, compare_driver, window). |
| `persistence.py` | `ensure_user`, `persist_run`, `create_conversation`, `insert_message`, `list_conversations`, `get_conversation_messages`, `count_runs_today`, `get_usage_summary`, `get_admin_stats` |
| `auth.py` | Clerk JWT verification via `PyJWKClient` (RS256, issuer, expiry). |

**SSE endpoint:** `POST /api/v1/agent/query/stream` streams these events in order:

| SSE event | Payload |
|---|---|
| `dag_init` | `{ nodes: [...], edges: [...] }` |
| `node_start` | `{ node_id, label, query_preview }` |
| `node_complete` | `{ node_id, duration_ms, summary, status }` |
| `node_error` | `{ node_id, error, duration_ms }` |
| `final` | Full `AgentAnswer` as JSON |
| `done` | `{}` |

**JSON endpoint** (kept for non-streaming clients): `POST /api/v1/agent/query`

**Other endpoints:** `GET /agent/conversations`, `GET /agent/conversations/:id`, `GET /agent/usage`, `GET /agent/admin/stats`

### Frontend (`apps/frontend/`)

| File | What it does |
|---|---|
| `types/agent.ts` | TypeScript mirrors of all backend contracts |
| `lib/api.ts` | `agentApi.*` helper functions + `API_URL` |
| `lib/dag-layout.ts` | Pure longest-path layer layout with cycle guard — returns `{ [nodeId]: {x, y} }` |
| `lib/node-inspector.ts` | Pure `buildNodeInspectorView(node, info, call)` view-model |
| `lib/chart-data.ts` | Pure `normalizeCircuitPoints`, `speedGradientColor`, `degradationFit` |
| `components/agent/ReasoningGraphCanvas.tsx` | React Flow canvas (`@xyflow/react`). Currently `h-[380px]`, dark `#0d0d0d` background. Nodes positioned by `layeredLayout`. |
| `components/agent/nodes/AgentDAGNode.tsx` | Dark card node `w-[240px]`. States: idle/running/done/error with gold/emerald/red borders. |
| `components/agent/edges/AnimatedLaserEdge.tsx` | Bezier SVG edge. CSS classes: `edge-idle`, `edge-running` (animated dashes), `edge-done` (glow), `edge-error`. |
| `components/agent/NodeInspectorDrawer.tsx` | Slide-over drawer inside the canvas showing tool identity, SQL, input/output evidence. |
| `components/agent/EvidenceCards.tsx` | 3-card row: session context, pit stop, speed delta. |
| `components/agent/AgentProgressRail.tsx` | Live SSE progress rail during loading. |
| `components/agent/AgentSpeedChart.tsx` | Before/after speed bar chart. |
| `components/agent/TelemetryOverlayChart.tsx` | Multi-channel lap overlay (speed, throttle, brake, gear, DRS). |
| `components/agent/CircuitHeatmap.tsx` | SVG circuit map colored by speed. |
| `components/agent/TyreDegradationChart.tsx` | Stint scatter + OLS regression lines. |
| `components/agent/RefusalBanner.tsx` | Amber warning banner for agent refusals. |
| `components/agent/ToolTraceAccordion.tsx` | Expandable tool trace accordion (admin sees full, users see redacted). |
| `app/agent/page.tsx` | Main agent page. 3-column layout: left sidebar (280px) + center (fluid) + right sidebar (300px). Handles SSE streaming, `ChatTurn` state, conversation history, usage, admin stats. |
| `app/globals.css` | Edge flow + node pulse keyframes, React Flow control overrides, Rajdhani font. |

### Infrastructure / other

- **Auth:** Clerk (Next.js middleware + Flask JWT verify). Left sidebar shows `UserButton`.
- **DB migrations:** `0019_add_agent_tables.py` creates `users`, `agent_conversations`, `agent_messages`, `agent_runs`, `agent_tool_calls`.
- **Ingestion:** 2024 British GP Race telemetry seeded via `make seed`. `load_laps` persists `pit_in_time_ms`, `pit_out_time_ms`, `stint`, `fresh_tyre`.
- **Tests:** 119 backend tests passing (`uv run pytest`). Frontend: `pnpm lint` clean, `pnpm tsc --noEmit` clean, `pnpm build` compiles.
- **Cost tracking:** per-call USD logged via OpenRouter `usage.cost`. Admin stats endpoint aggregates totals.

### Conventions — do not break these

- Tools live in `tools.py`; contracts in `types.py`; SQL is always `text()` + `:param` binds, never f-strings.
- Every tool: one frozen input dataclass → one frozen output dataclass.
- Typed errors: `NotFoundError` = data not found, `DataError` = unusable/unsupported.
- SQL gathers, pure Python derives. Pure helpers take `list[dict]` and no DB.
- `ORDER BY` everywhere, `round(x, 2)` for computed numbers.
- `extensions.engine` only accessible inside `create_app()`. Standalone scripts use `create_engine(settings.db_url)` directly.
- House quality: `uv run ruff check`, `uv run ruff format --check`, `uv run pytest apps/backend/tests/`.

---

## L28 — Cinematic DAG Canvas + Claude-Quality Output

### Status: NOT YET IMPLEMENTED — implement this next.

This lesson is a **pure frontend overhaul**. Zero backend changes needed. All the SSE events, node states, and data payloads already exist from L24–L27. L28 only changes how the frontend renders them.

---

### 1. What L28 Builds

A complete visual transformation of `app/agent/page.tsx` and its child components:

1. **Full-canvas DAG visualizer** — when a query is running, the DAG fills the entire screen except the left sidebar. The right sidebar hides completely.
2. **Real-time node emergence** — nodes appear as ghosts in topological order (staggered 60ms apart) at `dag_init`, then light up gold at `node_start`, flip to emerald at `node_complete`.
3. **Animated flow edges** — bezier curves with flowing particle dots while running; a latency label (`LATENCY: Xms`) appears mid-edge.
4. **Running node detail** — each gold (running) node shows a status message + collapsed SQL code block inside its body.
5. **Thinking node** — the synthesizer/final node gets a special "thinking" text box with animated dots, then resolves to a completion message.
6. **Canvas dissolve → minimap** — when `final` SSE arrives, the full canvas fades out and shrinks to a compact `~150px` minimap strip (all nodes green, static, clickable to re-expand). The answer then slides in below it.
7. **Claude-quality answer rendering** — `react-markdown` + `remark-gfm` renders the agent answer as full markdown (headings, tables, bold, lists, inline code).
8. **Light canvas background** — the DAG canvas switches from black `#0d0d0d` to a light/cream Figma-style background with a subtle dot grid.

---

### 2. Layout State Machine

The page must manage a `canvasPhase` state that drives which columns are visible:

```ts
type CanvasPhase = 'idle' | 'running' | 'completing' | 'minimap' | 'expanded'
```

| Phase | Left sidebar | Center | Right sidebar |
|---|---|---|---|
| `idle` | visible (280px) | question prompt + past turns | visible (300px) |
| `running` | visible (280px) | **full-canvas DAG** — takes all remaining width | **hidden** |
| `completing` | visible (280px) | canvas fades/scales down with CSS transition | hidden |
| `minimap` | visible (280px) | 150px minimap strip + answer below | visible (300px) returns |
| `expanded` | visible (280px) | full canvas re-opens (when user clicks minimap) | hidden again |

**Transitions:**
- Question submitted → `'running'`
- `final` SSE received → `'completing'` (start 700ms CSS transition)
- After 700ms → `'minimap'` (right sidebar slides back in)
- User clicks minimap strip → `'expanded'`
- User clicks "collapse" button in expanded mode → `'minimap'`

---

### 3. CSS Additions — `app/globals.css`

Add these keyframes and utility classes. Do not remove any existing rules.

```css
/* ── L28 canvas phase transitions ── */
@keyframes canvasDissolve {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.97); }
}

@keyframes answerReveal {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes nodeGhostIn {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to   { opacity: 0.35; transform: translateY(0) scale(1); }
}

@keyframes nodeActivate {
  from { opacity: 0.35; transform: scale(0.98); }
  to   { opacity: 1; transform: scale(1); }
}

@keyframes particlePulse {
  0%, 100% { opacity: 0.9; r: 3; }
  50%       { opacity: 0.3; r: 2; }
}

@keyframes thinkingDots {
  0%, 20%  { content: '.';   }
  40%      { content: '..';  }
  60%      { content: '...'; }
  80%,100% { content: '';    }
}

.canvas-dissolving {
  animation: canvasDissolve 0.7s ease forwards;
}

.answer-reveal {
  animation: answerReveal 0.5s ease both;
}

/* Ghost state for newly appeared nodes (before node_start fires) */
.agent-node-ghost { opacity: 0.35; }

/* Activated state — node_start has fired */
.agent-node-active { animation: nodeActivate 0.25s ease both; opacity: 1; }

/* ── L28 markdown prose styles ── */
.pitwall-prose {
  font-family: 'Inter', sans-serif;
  font-size: 0.9375rem;
  line-height: 1.75;
  color: #1e293b;
}
.pitwall-prose h1, .pitwall-prose h2, .pitwall-prose h3 {
  font-weight: 800;
  color: #0f172a;
  margin: 1.25em 0 0.5em;
  line-height: 1.25;
}
.pitwall-prose h1 { font-size: 1.375rem; }
.pitwall-prose h2 { font-size: 1.125rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25em; }
.pitwall-prose h3 { font-size: 1rem; }
.pitwall-prose p  { margin: 0.75em 0; }
.pitwall-prose strong { font-weight: 700; color: #0f172a; }
.pitwall-prose em { font-style: italic; color: #475569; }
.pitwall-prose code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8125rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 0.1em 0.35em;
  color: #e8002d;
}
.pitwall-prose pre {
  background: #0f172a;
  border-radius: 8px;
  padding: 1em 1.25em;
  overflow-x: auto;
  margin: 1em 0;
}
.pitwall-prose pre code {
  background: none;
  border: none;
  color: #e2e8f0;
  font-size: 0.8125rem;
  padding: 0;
}
.pitwall-prose ul, .pitwall-prose ol {
  padding-left: 1.5em;
  margin: 0.75em 0;
}
.pitwall-prose li { margin: 0.3em 0; }
.pitwall-prose table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  margin: 1em 0;
}
.pitwall-prose th {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 0.5em 0.75em;
  text-align: left;
  font-weight: 700;
  color: #334155;
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.pitwall-prose td {
  border: 1px solid #e2e8f0;
  padding: 0.5em 0.75em;
  color: #475569;
}
.pitwall-prose tr:nth-child(even) td { background: #f8fafc; }
.pitwall-prose blockquote {
  border-left: 3px solid #e8002d;
  margin: 1em 0;
  padding: 0.5em 1em;
  color: #64748b;
  background: #fff5f5;
}
```

---

### 4. Upgrade `ReasoningGraphCanvas.tsx`

**File:** `components/agent/ReasoningGraphCanvas.tsx`

**What to change:**

#### 4a. Props — add `phase` and `animationIndex`

```ts
interface Props {
  nodes: AgentDAGNodeSpec[]
  edges: AgentDAGEdge[]
  states: Record<string, AgentNodeRunInfo>
  onSelectNode?: (nodeId: string) => void
  phase: 'running' | 'completing' | 'minimap' | 'expanded'
  // animationIndex: map of nodeId → topo rank (0-based), used to stagger ghost entrance
  animationIndex: Record<string, number>
}
```

#### 4b. Canvas background — switch to light

Change the wrapper `div` background from `bg-[#0d0d0d]` to:
- `bg-[#f9fafb]` (near-white, Figma-like)
- Grid dots via React Flow `BackgroundVariant.Dots` with `color="#d1d5db"` (light grey), `gap={20}`, `size={1}`

#### 4c. Canvas height — full screen during `running`

The canvas `div` should be `h-full w-full` — height is controlled by the parent in `page.tsx`. Do not hardcode height here.

#### 4d. Ghost nodes — staggered entrance

Each `rfNode` should carry an `animationDelay` in its data:

```ts
data: {
  ...existing fields,
  animationDelay: (animationIndex[node.id] ?? 0) * 60, // ms
  isGhost: states[node.id] === undefined || states[node.id]?.state === 'idle'
}
```

#### 4e. Minimap mode

When `phase === 'minimap'`, wrap the React Flow in a `pointer-events-none` container. Pass `fitView` always. The parent controls the `height` (150px in minimap, full height in running/expanded).

#### 4f. Full updated component skeleton

```tsx
'use client'

import { useMemo } from 'react'
import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow,
  type Edge as FlowEdge, type EdgeTypes, type Node as FlowNode, type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layeredLayout } from '@/lib/dag-layout'
import { AgentDAGEdge, AgentDAGNode as AgentDAGNodeSpec, AgentNodeRunInfo } from '@/types/agent'
import AgentDAGNode, { type AgentDAGNodeData } from './nodes/AgentDAGNode'
import AnimatedLaserEdge, { type EdgeTone } from './edges/AnimatedLaserEdge'

const nodeTypes: NodeTypes = { agent: AgentDAGNode }
const edgeTypes: EdgeTypes = { laser: AnimatedLaserEdge }

interface Props {
  nodes: AgentDAGNodeSpec[]
  edges: AgentDAGEdge[]
  states: Record<string, AgentNodeRunInfo>
  onSelectNode?: (nodeId: string) => void
  phase: 'running' | 'completing' | 'minimap' | 'expanded'
  animationIndex: Record<string, number>
}

export default function ReasoningGraphCanvas({
  nodes, edges, states, onSelectNode, phase, animationIndex,
}: Props) {
  const isMinimap = phase === 'minimap'

  const rfNodes = useMemo<FlowNode[]>(() => {
    const position = layeredLayout(nodes)
    return nodes.map((node) => {
      const info: AgentNodeRunInfo = states[node.id] ?? { state: 'idle' }
      return {
        id: node.id,
        type: 'agent',
        position: position[node.id],
        data: {
          label: node.label,
          tool_name: node.tool_name,
          state: info.state,
          duration_ms: info.duration_ms ?? null,
          summary: info.summary ?? null,
          query_preview: info.query_preview ?? null,
          animationDelay: (animationIndex[node.id] ?? 0) * 60,
        } satisfies AgentDAGNodeData,
      }
    })
  }, [nodes, states, animationIndex])

  const rfEdges = useMemo<FlowEdge[]>(() =>
    edges.map((edge) => {
      const sourceInfo = states[edge.source]
      const targetInfo = states[edge.target]
      let tone: EdgeTone = 'idle'
      if (targetInfo?.state === 'running') tone = 'running'
      else if (targetInfo?.state === 'error') tone = 'error'
      else if (sourceInfo?.state === 'done' || sourceInfo?.state === 'error') tone = 'done'
      const latency = sourceInfo?.duration_ms ?? null
      return {
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: 'laser',
        data: { tone, latency_ms: latency },
      }
    }),
    [edges, states]
  )

  return (
    <div className={`h-full w-full ${isMinimap ? 'pointer-events-none' : ''}`}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: isMinimap ? 0.6 : 1 }}
        minZoom={0.2}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => !isMinimap && onSelectNode?.(node.id)}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d1d5db"
        />
        {!isMinimap && <Controls showInteractive={false} position="bottom-left" />}
      </ReactFlow>
    </div>
  )
}
```

---

### 5. Upgrade `AgentDAGNode.tsx`

**File:** `components/agent/nodes/AgentDAGNode.tsx`

**What to change:**

#### 5a. New `AgentDAGNodeData` fields

```ts
export interface AgentDAGNodeData {
  label: string
  tool_name: string
  state: AgentNodeState
  duration_ms?: number | null
  summary?: string | null         // NEW: from node_complete event
  query_preview?: string | null   // NEW: from node_start event (the SQL/key preview)
  animationDelay: number          // NEW: ms stagger for ghost entrance (0, 60, 120, ...)
  [key: string]: unknown
}
```

#### 5b. Light-themed node card

The node card must switch from dark to a **light-themed design** to match the light canvas:

- Background: `bg-white` with a `1px` border
- Header section: `bg-slate-50` — shows tool type badge + sequential ID
- Border color driven by state:
  - `idle`: `border-slate-200` (light grey, ghosted with `opacity-60`)
  - `running`: `border-amber-400` with `agent-node-running` pulse
  - `done`: `border-emerald-400`
  - `error`: `border-red-500`
- Width: `w-[280px]` (slightly wider than current `240px`)
- Node header: two-row layout:
  - Top row: `TOOL_NODE` label on left + sequential ID (e.g. `SEC-01`) on right — both uppercase monospace, `text-[9px]`, `text-slate-400`
  - Second row: Tool name in bold uppercase, e.g. `WEATHER_DATA` (Rajdhani font, `text-[13px]`)
- State badge: same logic as current but in light colors
- Body section (shown when running or done):
  - Status line: e.g. `"Resolving British GP 2024..."` in `text-[11px] text-slate-600`
  - Collapsed SQL block: `<details>` or a collapsed `<pre>` showing truncated `query_preview` in `JetBrains Mono text-[9px]`, background `#f8fafc`, border `#e2e8f0`
- Running node: show a thin animated progress bar at the bottom of the card (1px tall, amber, CSS `@keyframes` shimmer left-to-right)
- Ghost (idle, not yet started): `opacity-60`, no body content shown

#### 5c. Ghost entrance animation

Apply the `animationDelay` as an inline style `animationDelay: data.animationDelay + 'ms'` on a CSS class `agent-node-ghost` that plays `nodeGhostIn` (defined in globals.css). When `state` changes from `idle` to `running`, the class switches to `agent-node-active`.

#### 5d. Handle positions — keep Left/Right

Keep `Handle type="target" position={Position.Left}` and `Handle type="source" position={Position.Right}` since the layout is horizontal left-to-right. Style them to be invisible circles `!bg-transparent !border-slate-300`.

#### 5e. Full updated node skeleton

```tsx
'use client'

import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import {
  Activity, Database, Flag, Gauge, Loader2, Search, ShieldCheck,
  TrendingDown, User, Wrench, XCircle, type LucideIcon,
} from 'lucide-react'
import type { AgentNodeState } from '@/types/agent'

export interface AgentDAGNodeData {
  label: string
  tool_name: string
  state: AgentNodeState
  duration_ms?: number | null
  summary?: string | null
  query_preview?: string | null
  animationDelay: number
  [key: string]: unknown
}

type AgentNode = Node<AgentDAGNodeData, 'agent'>

const TOOL_ICONS: Record<string, LucideIcon> = {
  resolve_session: Flag,
  resolve_driver: User,
  find_pit_stops: Wrench,
  get_lap_telemetry_artifacts: Database,
  compute_speed_window: Gauge,
  inspect_lap_events: Search,
  stint_degradation_scanner: TrendingDown,
  telemetry_inspector: Activity,
  verify_evidence: ShieldCheck,
  synthesizer: Loader2,
}

// Sequential IDs for display (matches topo order in practice)
const TOOL_IDS: Record<string, string> = {
  resolve_session: 'SEC-01',
  resolve_driver: 'DRV-02',
  find_pit_stops: 'PIT-03',
  get_lap_telemetry_artifacts: 'ART-04',
  compute_speed_window: 'SPD-05',
  inspect_lap_events: 'LAP-03',
  stint_degradation_scanner: 'DEG-04',
  telemetry_inspector: 'TEL-04',
  verify_evidence: 'VER-06',
  synthesizer: 'SYN-07',
}

const BORDER_CLASS: Record<AgentNodeState, string> = {
  idle: 'border-slate-200',
  running: 'border-amber-400 agent-node-running',
  done: 'border-emerald-400',
  error: 'border-red-500',
}

function StateBadge({ state, durationMs }: { state: AgentNodeState; durationMs?: number | null }) {
  if (state === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
  if (state === 'done')    return <span className="font-mono text-[10px] font-bold text-emerald-600">{durationMs ?? 0}ms</span>
  if (state === 'error')   return <XCircle className="h-3.5 w-3.5 text-red-500" />
  return <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
}

function AgentDAGNode({ data }: NodeProps<AgentNode>) {
  const Icon = TOOL_ICONS[data.tool_name] ?? Database
  const toolId = TOOL_IDS[data.tool_name] ?? 'NOD-XX'
  const isGhost = data.state === 'idle'
  const isRunning = data.state === 'running'
  const isDone = data.state === 'done'
  const isSynthesizer = data.tool_name === 'synthesizer'

  return (
    <div
      className={`w-[280px] rounded-[6px] border bg-white shadow-md transition-all duration-300 ${BORDER_CLASS[data.state]} ${isGhost ? 'opacity-60' : 'opacity-100'}`}
      style={{ animationDelay: `${data.animationDelay}ms` }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !min-w-0 !border !border-slate-300 !bg-white" />

      {/* Header */}
      <div className="border-b border-slate-100 bg-slate-50 px-2.5 py-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            TOOL_NODE
          </span>
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">
            {toolId}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className={`h-3.5 w-3.5 shrink-0 ${isDone ? 'text-emerald-500' : isRunning ? 'text-amber-500' : 'text-slate-400'}`} />
            <span className="rajdhani truncate text-[13px] font-bold uppercase tracking-[0.06em] text-slate-800">
              {data.tool_name.replace(/_/g, '_')}
            </span>
          </div>
          <StateBadge state={data.state} durationMs={data.duration_ms} />
        </div>

        {/* Status line + SQL preview — shown when running or done */}
        {(isRunning || isDone) && (
          <div className="mt-2 space-y-1.5">
            {/* Status text */}
            <div className="text-[11px] text-slate-500 leading-4">
              {isRunning
                ? isSynthesizer
                  ? <ThinkingText />
                  : (data.label || 'Processing...')
                : data.summary ?? data.label}
            </div>

            {/* Collapsed SQL block */}
            {data.query_preview && (
              <details className="group">
                <summary className="cursor-pointer font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400 hover:text-slate-600 select-none">
                  query ▸
                </summary>
                <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-all rounded-[3px] border border-slate-200 bg-slate-50 p-1.5 font-mono text-[9px] leading-[1.4] text-slate-600">
                  {data.query_preview}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Running progress bar */}
        {isRunning && (
          <div className="mt-2 h-[2px] w-full overflow-hidden rounded bg-amber-100">
            <div className="h-full animate-[shimmer_1.5s_ease-in-out_infinite] bg-amber-400" />
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !min-w-0 !border !border-slate-300 !bg-white" />
    </div>
  )
}

// Animated thinking dots for the synthesizer node
function ThinkingText() {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-600">
      Synthesizing
      <span className="ml-0.5 inline-flex gap-[2px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1 w-1 rounded-full bg-amber-500 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    </span>
  )
}

export default memo(AgentDAGNode)
```

Also add to `globals.css`:
```css
@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
```

---

### 6. Upgrade `AnimatedLaserEdge.tsx`

**File:** `components/agent/edges/AnimatedLaserEdge.tsx`

Add a **latency label** at the midpoint of each bezier path, and refine edge stroke styles to match the light canvas.

```tsx
'use client'

import { getBezierPath, BaseEdge, type EdgeProps, EdgeLabelRenderer } from '@xyflow/react'

export type EdgeTone = 'idle' | 'running' | 'done' | 'error'

export default function AnimatedLaserEdge({
  sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.4,
  })

  const tone: EdgeTone = (data?.tone as EdgeTone | undefined) ?? 'done'
  const latency: number | null = (data?.latency_ms as number | null) ?? null

  return (
    <>
      <BaseEdge path={path} className={`edge-laser edge-${tone}`} />

      {/* Latency label — only shown when done and latency is known */}
      {tone === 'done' && latency !== null && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="font-mono text-[8px] font-semibold uppercase tracking-[0.06em] text-slate-400"
          >
            LATENCY: {latency}ms
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
```

Update edge CSS in `globals.css` to match light canvas:

```css
/* ── L28 light-canvas edge overrides ── */
.edge-laser.edge-idle    { stroke: #cbd5e1; stroke-width: 1.5; }
.edge-laser.edge-running {
  stroke: #f59e0b;
  stroke-width: 2;
  stroke-dasharray: 6 4;
  filter: drop-shadow(0 0 4px rgba(245, 158, 11, 0.5));
  animation: graphEdgeFlow 0.7s linear infinite;
}
.edge-laser.edge-done {
  stroke: #10b981;
  stroke-width: 1.5;
  filter: drop-shadow(0 0 3px rgba(16, 185, 129, 0.35));
}
.edge-laser.edge-error { stroke: #ef4444; stroke-width: 2; }
```

---

### 7. Upgrade `NodeInspectorDrawer.tsx`

**File:** `components/agent/NodeInspectorDrawer.tsx`

The drawer keeps its dark `#0d0d0d` background (it overlays the light canvas, providing contrast). Add these visual changes:

#### 7a. ACTIVE/IDLE badge at the very top

When `view.state === 'running'`, show a red blinking dot + `ACTIVE ● PROCESSING` header bar just under the tool name.

```tsx
{view.state === 'running' && (
  <div className="flex items-center gap-2 border-b border-[#2A2A2A] bg-[#1a0a00] px-3 py-2">
    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
    <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-red-400">
      ACTIVE
    </span>
    <span className="ml-auto font-mono text-[9px] text-amber-400">● PROCESSING</span>
  </div>
)}
```

#### 7b. CPU/MEM mock stats (shown when running)

Below the ACTIVE badge, show a small stats row. Use timing-derived values as mock:

```tsx
{view.state === 'running' && (
  <div className="flex gap-4 border-b border-[#2A2A2A] px-3 py-2">
    <div>
      <div className="font-mono text-[8px] text-slate-600">CPU</div>
      <div className="font-mono text-[11px] font-bold text-slate-300">84.2%</div>
    </div>
    <div>
      <div className="font-mono text-[8px] text-slate-600">MEM</div>
      <div className="font-mono text-[11px] font-bold text-slate-300">2.14G</div>
    </div>
  </div>
)}
```

#### 7c. Thinking text when synthesizer is running

When `view.toolName === 'synthesizer'` and `view.state === 'running'`, show an animated text block:

```tsx
{view.toolName === 'synthesizer' && view.state === 'running' && (
  <div className="border-b border-[#2A2A2A] px-3 py-3">
    <div className="font-mono text-[10px] leading-5 text-emerald-300">
      Received session + driver + pit data.
      <br />
      Computing final debrief
      <span className="animate-pulse">...</span>
    </div>
  </div>
)}
```

---

### 8. Upgrade `page.tsx` — the main orchestration

**File:** `app/agent/page.tsx`

This is the most substantial change. Below is a full specification.

#### 8a. Install `react-markdown` and `remark-gfm`

Run before editing:
```bash
pnpm add react-markdown remark-gfm --filter @pitwall/frontend
```

#### 8b. New imports

```ts
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
```

#### 8c. New state

```ts
type CanvasPhase = 'idle' | 'running' | 'completing' | 'minimap' | 'expanded'
const [canvasPhase, setCanvasPhase] = useState<CanvasPhase>('idle')
const [animationIndex, setAnimationIndex] = useState<Record<string, number>>({})
```

#### 8d. Compute `animationIndex` from topo order when `dag_init` fires

When processing the `dag_init` SSE event, compute the topo-sort rank for each node so nodes can stagger their ghost entrance. The `layeredLayout` function in `lib/dag-layout.ts` already does the layered layout — we need the layer index (rank) per node.

Add a helper to `lib/dag-layout.ts` (or inline in page.tsx):

```ts
// Returns { [nodeId]: rank } where rank is 0-based topo layer index
function topoRankMap(nodes: AgentDAGNode[], edges: AgentDAGEdge[]): Record<string, number> {
  const deps: Record<string, string[]> = {}
  nodes.forEach(n => { deps[n.id] = [...(n.depends_on ?? [])] })
  const rank: Record<string, number> = {}
  const visited = new Set<string>()

  function dfs(id: string): number {
    if (visited.has(id)) return rank[id] ?? 0
    visited.add(id)
    const depRanks = (deps[id] ?? []).map(dfs)
    rank[id] = depRanks.length ? Math.max(...depRanks) + 1 : 0
    return rank[id]
  }

  nodes.forEach(n => dfs(n.id))
  return rank
}
```

In `handleFrame`, when `p.type === 'dag_init'`:

```ts
if (p.type === 'dag_init' && Array.isArray(p.nodes)) {
  const rankMap = topoRankMap(p.nodes as AgentDAGNode[], p.edges as AgentDAGEdge[])
  setAnimationIndex(rankMap)
}
```

#### 8e. Canvas phase transitions

In the `ask` function:

```ts
// Before the SSE loop starts
setCanvasPhase('running')

// Inside handleFrame, when event === 'final':
setCanvasPhase('completing')
setTimeout(() => setCanvasPhase('minimap'), 700)
```

When `newConversation()` is called, reset: `setCanvasPhase('idle')`.

#### 8f. Layout grid — phase-aware

Replace the current static `grid-cols-[280px_minmax(0,1fr)_300px]` with a phase-driven layout:

```tsx
<div
  className={`mx-auto grid max-w-[100%] gap-0 transition-all duration-500 ${
    canvasPhase === 'running' || canvasPhase === 'completing' || canvasPhase === 'expanded'
      ? 'grid-cols-[280px_1fr]'         // Left sidebar + full canvas
      : 'lg:grid-cols-[280px_minmax(0,1fr)_300px]' // Normal 3-col
  }`}
>
```

The right sidebar `<aside>` must be conditionally rendered:

```tsx
{(canvasPhase === 'idle' || canvasPhase === 'minimap') && (
  <aside className="space-y-4">
    {/* ... all existing aside content unchanged ... */}
  </aside>
)}
```

#### 8g. Center column — canvas + turns area

The center `<section>` should render differently per phase:

```tsx
<section className="min-w-0 flex flex-col" style={{ minHeight: 'calc(100vh - 140px)' }}>
  {/* Breadcrumb trail — shown during running */}
  {(canvasPhase === 'running' || canvasPhase === 'completing') && latestDagTurn && (
    <div className="border-b border-slate-200 bg-white px-4 py-2 text-[10px] font-mono uppercase tracking-[0.06em] text-slate-400 overflow-x-auto whitespace-nowrap">
      {latestDagTurn.nodes
        .filter(n => latestDagTurn.nodeStates[n.id]?.state === 'done')
        .map(n => n.tool_name.replace(/_/g, ' ').toUpperCase())
        .join(' › ')}
      {loadingQuestion && <span className="ml-2 animate-pulse text-amber-500">›</span>}
    </div>
  )}

  {/* FULL CANVAS — running/completing/expanded phases */}
  {latestDagTurn && (canvasPhase === 'running' || canvasPhase === 'completing' || canvasPhase === 'expanded') && (
    <div
      className={`relative flex-1 ${canvasPhase === 'completing' ? 'canvas-dissolving' : ''}`}
      style={{ minHeight: canvasPhase === 'expanded' ? '80vh' : 'calc(100vh - 200px)' }}
    >
      <ReasoningGraphCanvas
        nodes={latestDagTurn.nodes}
        edges={latestDagTurn.edges}
        states={latestDagTurn.nodeStates}
        onSelectNode={setSelectedNodeId}
        phase={canvasPhase === 'expanded' ? 'expanded' : 'running'}
        animationIndex={animationIndex}
      />
      <NodeInspectorDrawer
        view={selectedNodeView}
        onClose={() => setSelectedNodeId(null)}
      />
    </div>
  )}

  {/* MINIMAP STRIP — after canvas dissolves */}
  {latestDagTurn && canvasPhase === 'minimap' && (
    <div
      className="relative cursor-pointer border-b border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
      style={{ height: '150px' }}
      onClick={() => setCanvasPhase('expanded')}
      title="Click to re-expand reasoning graph"
    >
      <ReasoningGraphCanvas
        nodes={latestDagTurn.nodes}
        edges={latestDagTurn.edges}
        states={latestDagTurn.nodeStates}
        onSelectNode={() => {}}
        phase="minimap"
        animationIndex={animationIndex}
      />
      {/* Overlay label */}
      <div className="absolute bottom-2 right-3 rounded border border-slate-200 bg-white/90 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500 shadow-sm">
        {latestDagTurn.nodes.length} nodes · {latestDagTurn.edges.length} edges · Click to expand
      </div>
    </div>
  )}

  {/* CONVERSATION TURNS — shown in idle and minimap phases */}
  <div className={`flex-1 space-y-5 overflow-y-auto p-4 sm:p-6 ${canvasPhase === 'running' || canvasPhase === 'completing' ? 'hidden' : 'block'}`}>

    {/* Empty state */}
    {turns.length === 0 && !loadingQuestion && canvasPhase === 'idle' && (
      /* ... keep existing empty state card unchanged ... */
    )}

    {/* Chat turns */}
    {turns.map((turn) => (
      <div key={turn.id} className="space-y-4">
        {/* User bubble — keep existing */}

        {/* Agent reply — upgrade answer body */}
        {turn.reply && (
          <div className="answer-reveal border-l-2 border-rose-500 bg-white/90 shadow-sm">
            {/* Header row — keep existing bot label + intent badge */}

            {/* UPGRADED: Markdown answer body */}
            <div className="pitwall-prose px-4 py-3">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {turn.reply.answer}
              </ReactMarkdown>
            </div>

            {/* Evidence cards, charts, trace accordion — keep all existing */}
            <RefusalBanner refusals={turn.reply.refusals} />
            <EvidenceCards ... />
            <AgentSpeedChart ... />
            <TelemetryOverlayChart ... />
            <CircuitHeatmap ... />
            <TyreDegradationChart ... />
            <ToolTraceAccordion ... />
          </div>
        )}

        {/* Progress rail during loading — keep existing */}
        {/* Error state — keep existing */}
      </div>
    ))}
  </div>

  {/* Input form — keep existing, minor tweak below */}
  <form onSubmit={ask} className="border-t border-slate-200 bg-white/94 p-3">
    {/* STRATEGY_BOT LISTENING indicator */}
    <div className="mb-2 flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-rose-500">
        Strategy_Bot Listening
      </span>
    </div>
    <div className="flex gap-2">
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="In British GP 2024, when did Carlos pit?"
        disabled={Boolean(loadingQuestion)}
        className="min-w-0 flex-1 border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-[12px] placeholder:font-semibold placeholder:text-slate-400 focus:border-rose-400 focus:bg-white"
      />
      <button
        type="submit"
        disabled={Boolean(loadingQuestion) || !question.trim()}
        className="flex h-12 w-12 shrink-0 items-center justify-center bg-rose-600 text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        aria-label="Send question"
      >
        {loadingQuestion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
  </form>
</section>
```

#### 8h. Update `node_start` event handling to store `query_preview`

The `AgentNodeRunInfo` type in `types/agent.ts` needs a new field:

```ts
// types/agent.ts — add to AgentNodeRunInfo
export type AgentNodeRunInfo = {
  state: AgentNodeState
  duration_ms?: number
  summary?: string
  error?: string
  query_preview?: string   // NEW — from node_start SSE payload
}
```

In `applyNodeEvent` in `page.tsx`:

```ts
if (event.type === 'node_start') {
  return {
    ...states,
    [nodeId]: {
      state: 'running',
      query_preview: event.query_preview ?? undefined,  // NEW
    },
  }
}
```

Also update the `AgentProgressEvent` type in `types/agent.ts` to include `query_preview?`:

```ts
export interface AgentProgressEvent {
  type: 'dag_init' | 'node_start' | 'node_complete' | 'node_error' | 'route' | 'plan' | 'compose'
  node_id?: string
  label?: string
  query_preview?: string   // NEW
  duration_ms?: number
  summary?: string
  error?: string
  status?: string
  nodes?: AgentDAGNode[]
  edges?: AgentDAGEdge[]
}
```

---

### 9. Update `types/agent.ts`

Only these additions — do not remove existing types:

```ts
// Add query_preview to AgentNodeRunInfo
export type AgentNodeRunInfo = {
  state: AgentNodeState
  duration_ms?: number
  summary?: string
  error?: string
  query_preview?: string   // new
}

// Add query_preview to AgentProgressEvent
export interface AgentProgressEvent {
  // ... all existing fields ...
  query_preview?: string   // new
}
```

---

### 10. No Backend Changes

**Do not touch any backend files.** The SSE protocol already emits `query_preview` on `node_start` events. If a particular tool does not supply `query_preview`, the field will simply be `null` and the node body will not show the SQL block — that is fine.

---

### 11. Dependency to install

```bash
# Run from the frontend package directory or the repo root with filter
pnpm add react-markdown remark-gfm --filter @pitwall/frontend
```

Check `apps/frontend/package.json` for the correct package name filter. If the workspace package is named differently (e.g. `frontend`), adjust accordingly.

---

### 12. Verification Steps

Run all of these before considering L28 done:

```bash
# Backend — should still be 119 passing, no backend changes needed
uv run pytest apps/backend/tests/

# Frontend type check
cd apps/frontend && pnpm tsc --noEmit

# Frontend lint
pnpm lint

# Frontend build
pnpm build
```

**Manual browser checks:**
1. Load `/agent` page — 3-column layout visible, no canvas shown (idle state)
2. Type a question and press Enter — right sidebar disappears, canvas expands to fill space
3. Watch nodes appear as ghosts in left-to-right order with stagger (dag_init)
4. First node lights up gold, SQL details collapse appears inside (node_start)
5. Node flips to green with `Xms` badge (node_complete)
6. Concurrent nodes (session + driver) activate simultaneously
7. Synthesizer node shows animated dots "Synthesizing..."
8. Canvas fades out (700ms), minimap strip appears at top with all nodes green
9. Right sidebar slides back in
10. Answer renders with markdown — headings, tables, bold are styled correctly
11. Click minimap → full canvas re-opens in expanded mode
12. Click a node → NodeInspectorDrawer opens with ACTIVE/PROCESSING badge when running

---

### 13. Design Rationale

**Why full-screen canvas?** The DAG is the core intellectual contribution of the system. Making it fill the screen makes it legible and impressive — each node is large enough to show SQL context. A small 380px box forces nodes to be tiny and unreadable.

**Why light canvas background?** Dark-on-dark (black canvas + dark nodes) makes text inside nodes very hard to read. A light cream/white canvas makes the node cards pop as readable documents, matching tools like Figma, n8n, and Retool that successfully use light canvases for complex graphs.

**Why ghost nodes at dag_init rather than on node_start?** Showing the full graph shape immediately tells the user what's about to happen — they can mentally prepare for the pipeline. Nodes appearing one by one would be confusing (is it broken? why is there only one node?). Ghost-then-activate is the best of both worlds.

**Why left-to-right layout?** The architecture doc diagrams, the SSE dependency chain (session + driver → pit stops → telemetry → verify → synthesize), and typical pipeline mental models all flow left to right. Top-to-bottom would require more vertical scroll in a landscape-oriented browser.

**Why canvas shrinks to minimap instead of disappearing?** The user might want to review which nodes ran and how long they took while reading the answer. The 150px minimap provides that reference without taking up valuable reading space.

**Why react-markdown + remark-gfm?** The LLM already produces valid markdown in its answers. Rendering it as `whitespace-pre-wrap` throws away all formatting. `react-markdown` is 6KB gzipped, has zero dependencies beyond `remark`, and covers all the cases (tables, bold, headings, code blocks) that make answers look Claude/GPT quality.

---

## Established Conventions — Always Follow

These apply to every future lesson:

- Tools: `tools.py`. Contracts: `types.py`. SQL: `text()` + `:param` binds only, never f-strings.
- Every tool: one frozen input dataclass → one frozen output dataclass.
- Errors: `NotFoundError` = not found, `DataError` = unusable.
- SQL gathers, pure Python derives. Pure helpers take `list[dict]` and no DB.
- `ORDER BY` everywhere. `round(x, 2)` for computed numbers.
- `extensions.engine` only inside `create_app()`. Scripts use `create_engine(settings.db_url)`.
- Quality gate: `uv run ruff check`, `uv run ruff format --check`, `uv run pytest apps/backend/tests/`, `pnpm lint`, `pnpm tsc --noEmit`, `pnpm build`.

---

## Goal Statement

Build a public Pitwall AI agent that answers race questions from stored F1 data while keeping cost, safety, and evidence quality under control.

The system's three invariants:
1. **LLM plans. Tools compute. Verifier checks. LLM explains.**
2. **Zero hallucinations** — the evidence gate refuses rather than inventing numbers.
3. **Parameterized SQL only** — the LLM can choose a tool, never write SQL.

## L29+ — Future Agent Capabilities (Agent Expansion)

These features are prioritized for development after L28 to expand the chatbot's domain knowledge and answering capabilities.

### 1. Position and Gap Tracking
* **Goal**: Answer questions like "What was Sainz's gap to the leader when he pitted?" and "Did the undercut work?"
* **Data Source**: FastF1 `session.laps["Position"]` (already extracted in `extract_laps()`, just needs to be saved to Postgres).
* **Implementation**:
  * Add `position` column to `lap_times` table.
  * Add tool `gap_and_position_snapshot(session_key, driver_number, lap_number)` returning position, gap to leader, and gap to cars ahead/behind.
  * Wire into the existing `GAP_AND_STRATEGY_ANALYZER` tool.

### 2. Race Control Events (Safety Cars, Yellow Flags)
* **Goal**: Answer questions like "Was there a safety car when Sainz pitted on lap 26?"
* **Data Source**: FastF1 `session.race_control_messages`.
* **Implementation**:
  * Create `race_control_events` table (flag type, timestamp, sector).
  * Add tool `fetch_race_control_window(session_key, lap_range)` to return flags/SC events intersecting a driver's lap window.

### 3. Qualifying Intent & DAG
* **Goal**: Answer questions like "What was Sainz's Q3 time?" or "Which sector was Hamilton fastest in qualifying?"
* **Data Source**: Existing `Qualifying` session data.
* **Implementation**:
  * Add `qualifying_lap_analysis` to `Intent` enum.
  * Update LLM router prompt to detect Q1/Q2/Q3 questions and set `session_type: "Q"`.
  * Create a specific DAG plan for qualifying (bypassing pit stops, focusing on `inspect_lap_events` and `telemetry_inspector`).

### 4. OpenF1 Team Radio + Transcripts
* **Goal**: Answer questions like "What did Carlos's engineer say before the pit?" and provide playable audio clips.
* **Data Source**: OpenF1 API (`GET /v1/team_radio?session_key=X&driver_number=Y`).
* **Implementation**:
  * **Ingestion**: Fetch metadata (timestamp, `recording_url`). Correlate `date` timestamp with the driver's lap start/end times from `lap_times` to derive `lap_number`.
  * **Transcription (Stretch)**: Run audio `.mp3` through an offline Whisper model to generate text transcripts, enabling text-searchable radio queries.
  * **Storage**: `team_radio` table (session_key, driver_number, lap_number, date, recording_url, transcript).
  * **Tool**: `fetch_radio_messages(session_key, driver_number, lap_range)`.
  * **UI**: New `<RadioClip>` React component to play F1 CDN `.mp3` files inline inside the markdown answer.

### 5. Weather Correlation
* **Goal**: Answer questions like "Was it raining when he pitted?" or "Track temp delta between stints?"
* **Data Source**: FastF1 `session.weather_data`.
* **Implementation**:
  * Create `weather_events` table (timestamp, track_temp, air_temp, humidity, rainfall, wind_speed).
  * Add tool `fetch_weather_window(session_key, lap_range)`.

### 6. Continuous Conversation & Counter-Question Context (L29 — next)
* **Goal**: Real multi-turn chat. Follow-up questions reference prior context instead of re-stating the whole question. When a detail is missing, the agent asks a short counter-question, and the user's reply resolves that detail back into the **ORIGINAL query context** — then the same DAG plan is re-run.
  * Example: user asks "Compare Verstappen and Hamilton in Monaco GP 2026" → agent replies "Which lap?" → user answers "Lap 40" → agent runs the original comparison DAG with `target_lap=40`, without re-extracting year/GP/driver context.
* **Implementation**:
  * Persist the resolved routed context (`year`, `gp_name`, `driver(s)`, `target_lap`, `compare_driver`, `window`) on each `agent_message` / run.
  * Router: when required entities are missing/ambiguous, emit a `clarification` request (new `Intent` / `RoutedQuestion.clarification` field listing the missing params) instead of silently failing or inventing data.
  * Merge turn: a follow-up message that supplies a missing param overlays it onto the previous turn's routed context and re-runs the same DAG.
  * Frontend: render the counter-question in the answer; the user's reply continues the same `conversation_id`.

### 7. DAG Visual Improvements (later polish)
* Zoom-to-node when opening the node inspector; smooth slide instead of snap on minimap re-expand/collapse; bundle long edges; scale node density on the minimap so the graph stays readable at 150px.
