import { useState } from 'react'
import { CheckCircle2, ChevronDown, Terminal, XCircle } from 'lucide-react'
import { ToolCallRecord } from '@/types/agent'

interface Props {
  trace: ToolCallRecord[]
}

export default function ToolTraceAccordion({ trace }: Props) {
  const [isOpen, setIsOpen] = useState(false)

  if (!trace || trace.length === 0) return null

  const totalDuration = trace.reduce((acc, item) => acc + (item.duration_ms ?? 0), 0)

  return (
    <div className="mt-4 overflow-hidden border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100"
        aria-expanded={isOpen}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-rose-500" />
          <span className="truncate text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-600">
            Tool execution trace
          </span>
          <span className="border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-400">
            {trace.length} calls
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[10px] font-bold text-slate-400">{totalDuration}ms</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {isOpen && (
        <div className="space-y-2 border-t border-slate-200 bg-white p-3">
          {trace.map((item, idx) => (
            <div
              key={`${item.tool_name}-${idx}`}
              className="grid gap-2 border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  {item.status === 'ok' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                  )}
                  <span className="truncate font-mono text-[10px] font-bold uppercase text-slate-700">
                    {item.tool_name}
                  </span>
                  <span className="font-semibold uppercase tracking-[0.06em] text-slate-400">[{item.status}]</span>
                </div>
                <p className="mt-1 line-clamp-2 text-slate-500">
                  {item.output_summary ?? item.input_summary ?? item.error}
                </p>
              </div>

              {item.duration_ms !== undefined && item.duration_ms !== null && (
                <span className="self-start border border-slate-200 bg-white px-1.5 py-0.5 font-bold text-slate-400">
                  {item.duration_ms}ms
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
