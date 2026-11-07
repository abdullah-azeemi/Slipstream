'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './analyst.css'
import { roundSizes, thoughtsByRound, type AnalystRunState, type AnalystStep } from '@/lib/analyst-graph'
import EChart from './EChart'

function StateDot({ state }: { state: AnalystStep['state'] }) {
  const color = state === 'running' ? '#3d7f8a' : state === 'error' ? '#c4574c' : '#4c9a6a'
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${state === 'running' ? 'animate-pulse' : ''}`} style={{ background: color }} />
}

export default function AnswerPanel({
  run,
  selectedId,
  onSelect,
}: {
  run: AnalystRunState
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const selected = run.steps.find((s) => s.id === selectedId) ?? null
  const byRound = thoughtsByRound(run)
  const rounds = [...new Set(run.steps.map((s) => s.round))].sort((a, b) => a - b)
  const sizes = roundSizes(run)

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-5">
      {run.status === 'error' && (
        <div className="rounded border border-[#e5b5af] bg-[#fbeeec] p-3 text-sm text-[#8a3b32]">{run.error ?? 'The analysis failed.'}</div>
      )}

      <section>
        <div className="an-mono mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-[#8a9498]">
          <span>Reasoning</span>
          <span>
            {run.steps.length} step{run.steps.length === 1 ? '' : 's'}
            {run.status === 'done' ? ` · $${run.costUsd.toFixed(4)}` : ''}
          </span>
        </div>
        {run.steps.length === 0 && <p className="text-sm text-[#8a9498]">Waiting for the first step…</p>}
        <ol className="space-y-2">
          {rounds.map((round, turn) => (
            <li key={round} className="space-y-1.5">
              <div className="an-mono text-[10px] uppercase tracking-wider text-[#a3adb0]">
                Turn {turn + 1}{(sizes.get(round) ?? 1) > 1 ? ` · ${sizes.get(round)} in parallel` : ''}
              </div>
              {(byRound.get(round) ?? []).map((t) => (
                <p key={t.seq} className="border-l-2 border-[#6c9aa3] pl-2.5 text-[13px] leading-snug text-[#2c4a52]">{t.text}</p>
              ))}
              {run.steps.filter((s) => s.round === round).map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id === selectedId ? null : s.id)}
                  className={`an-mono flex w-full items-center gap-2 rounded border px-2.5 py-1.5 text-left text-[12px] ${
                    s.id === selectedId ? 'border-[#3d7f8a] bg-[#f1f7f8]' : 'border-[#e3e6e3] bg-white hover:border-[#b9c4c6]'
                  }`}
                >
                  <StateDot state={s.state} />
                  <span className="font-semibold text-[#1f2a2e]">{s.tool}</span>
                  <span className="truncate text-[#8a9498]">{s.title}</span>
                </button>
              ))}
            </li>
          ))}
        </ol>
      </section>

      {selected && (
        <section className="rounded border border-[#d5dad8] bg-[#fbfbf9] p-3">
          <div className="an-mono mb-2 text-[11px] uppercase tracking-wider text-[#8a9498]">Step · {selected.tool}</div>
          {selected.preview && <pre className="an-mono mb-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[#f1efe9] p-2 text-[11px] leading-relaxed text-[#46545a]">{selected.preview}</pre>}
          {selected.summary && <pre className="an-mono max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-[#46545a]">{selected.summary}</pre>}
        </section>
      )}

      {run.answer && (
        <section>
          <div className="an-mono mb-2 text-[11px] uppercase tracking-wider text-[#8a9498]">Answer</div>
          <div className="an-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.answer}</ReactMarkdown>
          </div>
          {run.charts.map((c, i) => (
            <figure key={`${c.callId}-${i}`} className="mt-4 rounded border border-[#e3e6e3] bg-white p-3">
              <figcaption className="an-mono mb-1 text-[11px] uppercase tracking-wider text-[#8a9498]">{c.title}</figcaption>
              <EChart option={c.option} height={260} />
            </figure>
          ))}
        </section>
      )}
    </div>
  )
}
