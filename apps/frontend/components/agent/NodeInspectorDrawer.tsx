'use client'

import { Clock3, Database, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { NodeInspectorView } from '@/lib/node-inspector'
import type { AgentNodeState } from '@/types/agent'

const STATE_META: Record<AgentNodeState, { label: string; className: string }> = {
  idle: { label: 'Waiting', className: 'bg-slate-100 text-slate-500' },
  running: { label: 'Running', className: 'bg-amber-50 text-amber-700' },
  done: { label: 'Complete', className: 'bg-emerald-50 text-emerald-700' },
  error: { label: 'Failed', className: 'bg-rose-50 text-rose-700' },
  self_correcting: { label: 'Retrying', className: 'bg-violet-50 text-violet-700' },
}

interface Props {
  view: NodeInspectorView | null
  onClose: () => void
}

export default function NodeInspectorDrawer({ view, onClose }: Props) {
  if (!view) return null

  const status = STATE_META[view.state]
  const input = view.call?.input_summary || JSON.stringify(view.inputParams, null, 2)
  const output = view.call?.output_summary || view.summary || 'Waiting for a result.'

  return (
    <aside
      aria-label={`${view.label} tool details`}
      className="absolute inset-y-0 right-0 z-10 flex w-[min(320px,90vw)] flex-col border-l border-slate-200 bg-white shadow-lg"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold uppercase tracking-[0.08em] text-slate-800">
            {view.label || view.toolName.replace(/_/g, ' ')}
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-slate-400">
            {view.toolName}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close tool details"
          className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-1 text-[10px] font-semibold ${status.className}`}>
            {status.label}
          </span>
          {view.durationMs !== null && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
              <Clock3 className="h-3 w-3" />
              {view.durationMs < 10 ? view.durationMs.toFixed(1) : Math.round(view.durationMs)} ms
            </span>
          )}
        </div>

        {view.description && <p className="text-[11px] leading-4 text-slate-600">{view.description}</p>}

        {view.dependsOn.length > 0 && (
          <div>
            <SectionLabel>Depends on</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {view.dependsOn.map((dependency) => (
                <span key={dependency} className="rounded bg-slate-100 px-2 py-1 font-mono text-[9px] text-slate-600">
                  {dependency}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <SectionLabel icon={<Database className="h-3 w-3 text-rose-500" />}>Input</SectionLabel>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] leading-4 text-slate-700">
            {input || 'No input recorded.'}
          </pre>
        </div>

        <div>
          <SectionLabel icon={<Database className="h-3 w-3 text-emerald-600" />}>Output</SectionLabel>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] leading-4 text-slate-700">
            {output}
          </pre>
        </div>

        {view.error && (
          <div className="rounded border border-rose-200 bg-rose-50 p-2 text-[10px] leading-4 text-rose-700">
            {view.error}
          </div>
        )}
      </div>
    </aside>
  )
}

function SectionLabel({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
      {icon}
      {children}
    </div>
  )
}
