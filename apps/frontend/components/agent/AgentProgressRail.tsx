import { CheckCircle2, CircleDot, Loader2, XCircle } from 'lucide-react'
import { AgentProgressEvent } from '@/types/agent'

interface Props {
  events: AgentProgressEvent[]
}

export default function AgentProgressRail({ events }: Props) {
  if (!events.length) return null

  return (
    <div className="mt-4 border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
          Live progress
        </div>
        <div className="font-mono text-[10px] font-bold text-slate-400">
          {events.length} events
        </div>
      </div>

      <div className="space-y-2">
        {events.slice(-8).map((event, index) => {
          const Icon =
            event.status === 'running'
              ? Loader2
              : event.status === 'error'
                ? XCircle
                : event.status === 'ok'
                  ? CheckCircle2
                  : CircleDot
          const tone =
            event.status === 'running'
              ? 'text-rose-500'
              : event.status === 'error'
                ? 'text-rose-600'
                : 'text-emerald-600'

          return (
            <div
              key={`${event.type}-${event.stage ?? event.tool_name ?? index}-${index}`}
              className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 text-[11px]"
            >
              <Icon
                className={`h-3.5 w-3.5 ${tone} ${
                  event.status === 'running' ? 'animate-spin' : ''
                }`}
              />
              <div className="min-w-0 truncate font-bold uppercase tracking-[0.05em] text-slate-600">
                {event.label}
              </div>
              {event.duration_ms !== undefined && event.duration_ms !== null && (
                <div className="font-mono text-[10px] font-bold text-slate-400">
                  {event.duration_ms}ms
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
