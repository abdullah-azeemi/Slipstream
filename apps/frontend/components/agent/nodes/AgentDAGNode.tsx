'use client'

import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import {
  Activity,
  Database,
  Flag,
  Gauge,
  Loader2,
  Search,
  ShieldCheck,
  TrendingDown,
  User,
  Wrench,
  XCircle,
  type LucideIcon,
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
  if (state === 'running') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
  }
  if (state === 'done') {
    return <span className="font-mono text-[10px] font-bold text-emerald-600">{durationMs ?? 0}ms</span>
  }
  if (state === 'error') {
    return <XCircle className="h-3.5 w-3.5 text-red-500" />
  }
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
      className={`w-[280px] rounded-[6px] border bg-white shadow-md transition-all duration-300 ${
        BORDER_CLASS[data.state]
      } ${isGhost ? 'agent-node-ghost opacity-60' : isRunning ? 'agent-node-active' : ''}`}
      style={{ animationDelay: `${data.animationDelay}ms` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !min-w-0 !border !border-slate-300 !bg-white"
      />

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
            <Icon
              className={`h-3.5 w-3.5 shrink-0 ${
                isDone ? 'text-emerald-500' : isRunning ? 'text-amber-500' : 'text-slate-400'
              }`}
            />
            <span className="rajdhani truncate text-[13px] font-bold uppercase tracking-[0.06em] text-slate-800">
              {data.tool_name.replace(/_/g, ' ')}
            </span>
          </div>
          <StateBadge state={data.state} durationMs={data.duration_ms} />
        </div>

        {/* Status line + SQL preview — shown when running or done */}
        {(isRunning || isDone) && (
          <div className="mt-2 space-y-1.5">
            {/* Status text */}
            <div className="text-[11px] leading-4 text-slate-500">
              {isRunning
                ? isSynthesizer
                  ? <ThinkingText />
                  : (data.label || 'Processing...')
                : data.summary ?? data.label}
            </div>

            {/* Collapsed SQL block */}
            {data.query_preview && (
              <details className="group">
                <summary className="cursor-pointer select-none font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400 hover:text-slate-600">
                  query ▸
                </summary>
                <pre className="mt-1 max-h-20 overflow-auto break-all whitespace-pre-wrap rounded-[3px] border border-slate-200 bg-slate-50 p-1.5 font-mono text-[9px] leading-[1.4] text-slate-600">
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

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !min-w-0 !border !border-slate-300 !bg-white"
      />
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
            className="inline-block h-1 w-1 animate-bounce rounded-full bg-amber-500"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    </span>
  )
}

export default memo(AgentDAGNode)