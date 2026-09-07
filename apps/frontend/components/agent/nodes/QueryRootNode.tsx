'use client'

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { HelpCircle, CheckCircle2, Loader2 } from 'lucide-react'

export interface QueryRootNodeData {
  question: string
  intent: string
  thinking: boolean
  allDone: boolean
}

interface Props {
  data: QueryRootNodeData
}

const INTENT_DISPLAY_NAMES: Record<string, string> = {
  pit_stop_speed_delta: 'Pit Stop Analysis',
  lap_event_investigation: 'Lap Investigation',
  tyre_degradation_analysis: 'Tyre Degradation',
  telemetry_comparison: 'Telemetry Comparison',
  position_gap_tracking: 'Position & Gap',
  race_control_events: 'Race Control',
  qualifying_lap_analysis: 'Qualifying Analysis',
  team_radio: 'Team Radio',
  weather_correlation: 'Weather Correlation',
  unsupported: 'General Query',
}

function QueryRootNode({ data }: Props) {
  const intentName = INTENT_DISPLAY_NAMES[data.intent] || (data.intent ? data.intent.replace(/_/g, ' ') : 'Race Analysis')

  return (
    <div
      className={`w-[320px] rounded-[6px] border bg-white shadow-lg transition-all duration-300 ${
        data.thinking
          ? 'border-amber-400 agent-node-running'
          : data.allDone
          ? 'border-emerald-500 shadow-emerald-100'
          : 'border-slate-300'
      }`}
    >
      {/* Header */}
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 flex items-center justify-between">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-rose-500">
          USER_QUERY
        </span>
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">
          ROOT-00
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Intent Pill */}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-extrabold uppercase tracking-[0.06em] text-amber-700 border border-amber-200">
            <HelpCircle className="h-3 w-3 text-amber-600" />
            {intentName}
          </span>
          {data.thinking && (
            <span className="flex items-center gap-1 text-[10px] font-extrabold text-amber-600">
              <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
              Thinking...
            </span>
          )}
          {data.allDone && (
            <span className="flex items-center gap-1 text-[10px] font-extrabold text-emerald-600">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              Evidence Collected
            </span>
          )}
        </div>

        {/* Question text */}
        <p className="line-clamp-2 text-[12px] font-bold leading-5 text-slate-800">
          {`"${data.question}"`}
        </p>
      </div>

      {/* Source handle (Right side only) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !min-w-0 !border !border-amber-400 !bg-white"
      />
    </div>
  )
}

export default memo(QueryRootNode)
