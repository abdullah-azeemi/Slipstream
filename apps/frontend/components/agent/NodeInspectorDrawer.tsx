'use client'

import type { ReactNode } from 'react'
import { Activity, Clock3, Database, Terminal, X } from 'lucide-react'
import type { NodeInspectorView } from '@/lib/node-inspector'
import type { AgentNodeState } from '@/types/agent'

const STATE_META: Record<AgentNodeState, { label: string; className: string }> = {
  idle: { label: 'IDLE', className: 'border-slate-600 text-slate-500' },
  running: { label: 'RUNNING', className: 'border-[#FFD700]/60 text-[#FFD700]' },
  done: { label: 'DONE', className: 'border-[#2CF4C5]/60 text-[#2CF4C5]' },
  error: { label: 'ERROR', className: 'border-[#E8002D]/60 text-[#E8002D]' },
}

interface Props {
  view: NodeInspectorView | null
  onClose: () => void
}

export default function NodeInspectorDrawer({ view, onClose }: Props) {
  if (!view) return null

  const meta = STATE_META[view.state]

  return (
    <aside className="absolute inset-y-0 right-0 z-10 flex w-[300px] flex-col border-l border-[#2A2A2A] bg-[#0d0d0d]">
      <header className="flex items-start justify-between gap-2 border-b border-[#2A2A2A] p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 shrink-0 text-[#2CF4C5]" />
            <span className="rajdhani truncate text-[12px] font-bold uppercase tracking-[0.08em] text-white">
              {view.toolName.replace(/_/g, ' ') || 'unknown node'}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{view.label}</div>
          <div className="truncate font-mono text-[9px] text-slate-600">{view.nodeId}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close inspector"
          className="shrink-0 border border-[#2A2A2A] p-1 text-slate-400 transition hover:border-slate-500 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* ACTIVE / PROCESSING badge — shown while the node is running */}
      {view.state === 'running' && (
        <div className="flex items-center gap-2 border-b border-[#2A2A2A] bg-[#1a0a00] px-3 py-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-red-400">
            ACTIVE
          </span>
          <span className="ml-auto font-mono text-[9px] text-amber-400">● PROCESSING</span>
        </div>
      )}

      {/* CPU / MEM mock stats — shown while running */}
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

      {/* Thinking text when synthesizer is running */}
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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`border px-1.5 py-0.5 font-mono text-[9px] font-bold ${meta.className}`}>
            {meta.label}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] font-bold text-slate-400">
            <Clock3 className="h-3 w-3" />
            {view.durationMs ?? 0}ms
          </span>
        </div>

        {view.description && (
          <p className="text-[11px] leading-5 text-slate-400">{view.description}</p>
        )}

        {view.dependsOn.length > 0 && (
          <div>
            <SectionLabel>depends on</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {view.dependsOn.map((dep) => (
                <span
                  key={dep}
                  className="border border-[#2A2A2A] px-1.5 py-0.5 font-mono text-[9px] uppercase text-slate-400"
                >
                  {dep}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <SectionLabel icon={<Database className="h-3 w-3 text-[#2CF4C5]" />}>
            query / payload
          </SectionLabel>
          <pre className="max-h-44 whitespace-pre-wrap break-words border border-[#2A2A2A] bg-[#111111] p-2 font-mono text-[10px] leading-4 text-emerald-100/90">
            {view.call?.input_summary || '{"no input recorded"}'}
          </pre>
        </div>

        <div>
          <SectionLabel icon={<Activity className="h-3 w-3 text-[#2CF4C5]" />}>
            evidence / output
          </SectionLabel>
          <pre className="max-h-44 whitespace-pre-wrap break-words border border-[#2A2A2A] bg-[#111111] p-2 font-mono text-[10px] leading-4 text-slate-300">
            {view.call?.output_summary || view.summary || '{"no output recorded"}'}
          </pre>
        </div>

        {view.call?.error && (
          <div className="border border-[#E8002D]/60 bg-[#E8002D]/10 p-2">
            <SectionLabel tone="error">error</SectionLabel>
            <p className="whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-rose-300">
              {view.call.error}
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}

function SectionLabel({
  icon,
  tone = 'default',
  children,
}: {
  icon?: ReactNode
  tone?: 'default' | 'error'
  children: ReactNode
}) {
  return (
    <div
      className={`mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
        tone === 'error' ? 'text-rose-400' : 'text-slate-500'
      }`}
    >
      {icon}
      {children}
    </div>
  )
}