'use client'

import { useState } from 'react'
import './analyst.css'
import { callForStep, commandOf, type AnalystRunState, type AnalystStep } from '@/lib/analyst-graph'
import EChart from './EChart'

const TABS = ['Thinking', 'Call', 'Terminal', 'Result'] as const
type Tab = (typeof TABS)[number]

const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="an-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Thinking({ run, step }: { run: AnalystRunState; step: AnalystStep }) {
  const call = callForStep(run, step.id)
  if (!call) return <p className="an-empty">This run was saved before model calls were recorded.</p>
  const tokens = call.promptTokens + call.completionTokens
  return (
    <>
      {call.content ? (
        <p className="an-thinking">{call.content}</p>
      ) : (
        <p className="an-empty">The model asked for this tool without writing any text.</p>
      )}
      <Facts
        rows={[
          ['Model', call.model],
          ['Time', seconds(call.durationMs)],
          ['Tokens', tokens ? `${call.promptTokens} in · ${call.completionTokens} out` : 'not reported'],
          ['Cost', tokens ? `$${call.costUsd.toFixed(5)}` : 'not reported'],
          ['Asked for', call.toolCalls.map((t) => t.tool).join(', ')],
        ]}
      />
    </>
  )
}

function Call({ step }: { step: AnalystStep }) {
  // a script is shown in the Terminal tab, where its line breaks survive
  const args = Object.fromEntries(Object.entries(step.args).filter(([key]) => key !== 'code'))
  return (
    <>
      <Facts rows={[['Tool', step.tool], ['Call id', step.id]]} />
      {Object.keys(args).length > 0 ? (
        <pre className="an-block">{JSON.stringify(args, null, 2)}</pre>
      ) : (
        <p className="an-empty">{'code' in step.args ? 'The only argument is the script: see Terminal.' : 'No arguments recorded.'}</p>
      )}
    </>
  )
}

function Terminal({ step }: { step: AnalystStep }) {
  return (
    <div className="an-term">
      <div className="an-term-label">{step.tool === 'run_python' ? 'python' : 'tool call'}</div>
      <pre>{commandOf(step)}</pre>
      <div className="an-term-label">output</div>
      <pre data-state={step.state}>{step.state === 'running' ? 'running…' : step.output || 'no output'}</pre>
    </div>
  )
}

function Result({ step }: { step: AnalystStep }) {
  const status = step.state === 'running' ? 'running' : step.state === 'error' ? 'failed' : 'succeeded'
  return (
    <>
      <Facts rows={[['Status', status], ['Time', step.durationMs == null ? '…' : seconds(step.durationMs)]]} />
      {step.charts.map((c, i) => (
        <figure key={i} className="an-block">
          <figcaption className="an-term-label">{c.title}</figcaption>
          <EChart option={c.option} height={260} />
        </figure>
      ))}
      {step.charts.length === 0 && step.preview && step.tool !== 'run_python' && <pre className="an-block">{step.preview}</pre>}
      {step.charts.length === 0 && step.tool === 'run_python' && <p className="an-empty">No chart. The printed values are in Terminal.</p>}
    </>
  )
}

/** Everything one node saw and did. */
export default function StepInspector({
  run,
  step,
  onClose,
}: {
  run: AnalystRunState
  step: AnalystStep
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('Terminal')
  return (
    <div className="flex h-full flex-col">
      <div className="an-inspector-head">
        <button onClick={onClose} className="an-back">← Answer</button>
        <span className="an-path">/ {step.tool}</span>
        <span className="an-title">{step.title}</span>
      </div>
      <div className="an-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
        {tab === 'Thinking' && <Thinking run={run} step={step} />}
        {tab === 'Call' && <Call step={step} />}
        {tab === 'Terminal' && <Terminal step={step} />}
        {tab === 'Result' && <Result step={step} />}
      </div>
    </div>
  )
}
