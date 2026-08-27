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
}

const STATE_RING: Record<AgentNodeState, string> = {
  idle: 'border-[#2A2A2A]',
  running: 'border-[#FFD700] agent-node-running',
  done: 'border-[#2CF4C5]',
  error: 'border-[#E8002D]',
}

function StateBadge({ state, durationMs }: { state: AgentNodeState; durationMs?: number | null }) {
  if (state === 'running') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FFD700]" />
  }
  if (state === 'done') {
    return <span className="font-mono text-[10px] font-bold text-[#2CF4C5]">{durationMs ?? 0}ms</span>
  }
  if (state === 'error') {
    return <XCircle className="h-3.5 w-3.5 text-[#E8002D]" />
  }
  return <span className="h-2 w-2 rounded-full bg-slate-600" />
}

function AgentDAGNode({ data }: NodeProps<AgentNode>) {
  const Icon = TOOL_ICONS[data.tool_name] ?? Database

  return (
    <div className={`w-[240px] rounded-[6px] border bg-[#111111] px-3 py-2.5 shadow-md ${STATE_RING[data.state]}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !min-w-0 !border-0 !bg-slate-400" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-3.5 w-3.5 shrink-0 text-[#2CF4C5]" />
          <span className="rajdhani truncate text-[12px] font-bold uppercase tracking-[0.08em] text-white">
            {data.tool_name.replace(/_/g, ' ')}
          </span>
        </div>
        <StateBadge state={data.state} durationMs={data.duration_ms} />
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{data.label}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !min-w-0 !border-0 !bg-slate-400" />
    </div>
  )
}

export default memo(AgentDAGNode)