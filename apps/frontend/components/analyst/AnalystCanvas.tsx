'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, CloudSun, Flag, Search, Table2, Terminal, type LucideIcon } from 'lucide-react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './analyst.css'
import {
  CARD_H,
  QUESTION_ID,
  currentActivity,
  edgesOf,
  formatElapsed,
  layoutRun,
  roundSizes,
  runCounts,
  thoughtsByRound,
  type AnalystRunState,
  type AnalystStep,
} from '@/lib/analyst-graph'
import EChart from './EChart'

type StepData = { step: AnalystStep; selected: boolean; siblings: number }

const TOOL_ICONS: Record<string, LucideIcon> = {
  find_sessions: Search,
  race_summary: Flag,
  load_laps: Table2,
  load_telemetry: Activity,
  load_context: CloudSun,
  run_python: Terminal,
}

function Target() {
  return (
    <div className="an-target" aria-hidden>
      <i /><i /><i /><i />
      <b />
    </div>
  )
}

function footerOf(step: AnalystStep, siblings: number): string {
  if (step.state === 'running') return siblings > 1 ? `running · 1 of ${siblings} in parallel` : 'running…'
  const secs = step.durationMs == null ? '' : step.durationMs < 1000 ? `${step.durationMs} ms` : `${(step.durationMs / 1000).toFixed(1)} s`
  if (step.state === 'error') return `failed${secs ? ` · ${secs}` : ''}`
  const charts = step.charts.length ? `${step.charts.length} chart${step.charts.length > 1 ? 's' : ''} · ` : ''
  const parallel = siblings > 1 ? `${siblings} in parallel · ` : ''
  return `${parallel}${charts}${secs}`
}

const StepCard = memo(function StepCard({ data }: NodeProps<FlowNode<StepData>>) {
  const { step, selected, siblings } = data
  const Icon = TOOL_ICONS[step.tool] ?? Terminal
  return (
    <div className="an-card" data-state={step.state} data-selected={selected}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="an-card-head">
        <span className="an-path">/ {step.tool}</span>
        <span className="an-title">{step.title}</span>
      </div>
      <div className="an-thumb">
        {step.charts[0] ? (
          <EChart option={step.charts[0].option} height={150} mini />
        ) : step.tool === 'run_python' && step.preview ? (
          <pre className="an-code">{step.preview}</pre>
        ) : (
          <div className="an-stat">
            <Icon className="an-stat-icon" size={22} strokeWidth={1.6} aria-hidden />
            <div className="an-stat-text">
              {step.state === 'running' ? 'working…' : (step.preview || step.summary).slice(0, 170)}
            </div>
          </div>
        )}
        {step.state === 'running' && <Target />}
      </div>
      <div className="an-foot" data-state={step.state}>{footerOf(step, siblings)}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
})

const QuestionCard = memo(function QuestionCard({
  data,
}: NodeProps<FlowNode<{ question: string; thinking: boolean; starts: number }>>) {
  return (
    <div className="an-q">
      <div className="an-card-head">
        <span className="an-path">/ question</span>
        <span className="an-title">{data.thinking ? 'thinking…' : 'asked'}</span>
      </div>
      <div className="an-q-body">{data.question}</div>
      <div className="an-foot">{data.starts > 0 ? `start · ${data.starts}` : 'start'}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
})

const Chip = memo(function Chip({ data }: NodeProps<FlowNode<{ text: string }>>) {
  return (
    <div className="an-chip">
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
        <circle cx="2" cy="3" r="1.3" /><circle cx="7" cy="3" r="1.3" />
        <circle cx="2" cy="7" r="1.3" /><circle cx="7" cy="7" r="1.3" />
        <circle cx="2" cy="11" r="1.3" /><circle cx="7" cy="11" r="1.3" />
      </svg>
      <span>{data.text}</span>
    </div>
  )
})

const nodeTypes: NodeTypes = { step: StepCard, question: QuestionCard, chip: Chip }

function StatusBar({ run, live }: { run: AnalystRunState; live: boolean }) {
  const counts = runCounts(run)
  const [now, setNow] = useState(0)
  const base = useRef({ ms: 0, at: 0 })
  useEffect(() => {
    base.current = { ms: run.elapsedMs, at: performance.now() }
    setNow(0)
  }, [run.elapsedMs])
  useEffect(() => {
    if (!live || run.status !== 'running') return
    const t = setInterval(() => setNow(performance.now() - base.current.at), 250)
    return () => clearInterval(t)
  }, [live, run.status])

  if (run.question == null) return null
  const finished = counts.done + counts.failed
  const pct = run.status === 'done' ? 100 : counts.total ? Math.round((finished / counts.total) * 100) : 4
  const label =
    run.status === 'done' ? 'Done' : run.status === 'error' ? 'Stopped' : counts.total === 0 ? 'Thinking' : counts.running ? 'Running' : 'Reading'
  const detail =
    run.status === 'done'
      ? `${counts.total} steps${run.costUsd > 0 ? ` · $${run.costUsd.toFixed(4)}` : ''}`
      : `${counts.running} in progress · ${counts.done} done${counts.failed ? ` · ${counts.failed} failed` : ''}`
  return (
    <div className="an-status" data-status={run.status}>
      <span className="an-status-dot" aria-hidden />
      <strong>{label}</strong>
      <span className="an-status-detail">{detail}</span>
      <div className="an-status-bar" aria-hidden><i style={{ width: `${pct}%` }} /></div>
      <span className="an-status-num">{finished}/{counts.total}</span>
      <span className="an-status-num">{formatElapsed(run.elapsedMs + (live ? now : 0))}</span>
    </div>
  )
}

function ActivityPill({ run }: { run: AnalystRunState }) {
  const activity = currentActivity(run)
  if (!activity) return null
  const counts = runCounts(run)
  return (
    <div className="an-pill" data-busy={activity.busy}>
      <span className="an-pill-dots" aria-hidden><i /><i /><i /></span>
      <span className="an-pill-verb">{activity.verb}</span>
      <span className="an-pill-detail">{activity.detail}</span>
      {counts.total > 0 && (
        <span className="an-pill-counts">
          <b className="an-sq an-sq-run" />{counts.running}
          <b className="an-sq an-sq-done" />{counts.done}
          {counts.failed > 0 && (<><b className="an-sq an-sq-fail" />{counts.failed}</>)}
        </span>
      )}
    </div>
  )
}

function AutoFit({ trigger, focus }: { trigger: string; focus: string[] | null }) {
  const { fitView } = useReactFlow()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  useEffect(() => {
    if (!width || !height) return
    const fit = () =>
      fitView({
        padding: 0.2,
        maxZoom: 1,
        duration: 450,
        ...(focus ? { nodes: focus.map((id) => ({ id })) } : {}),
      })
    // a second attempt covers a fit that lands while an earlier animation is still running
    const timers = [setTimeout(fit, 150), ...(focus ? [] : [setTimeout(fit, 800)])]
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, width, height, fitView])
  return null
}

export default function AnalystCanvas({
  run,
  selectedId,
  onSelect,
  live = false,
}: {
  run: AnalystRunState
  selectedId: string | null
  onSelect: (id: string | null) => void
  live?: boolean
}) {
  const boardRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(3)
  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const measure = () => setCols(el.clientWidth >= 900 ? 3 : el.clientWidth >= 580 ? 2 : 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nodes = useMemo<FlowNode[]>(() => {
    if (run.question == null) return []
    const pos = layoutRun(run, cols)
    const list: FlowNode[] = [
      {
        id: QUESTION_ID,
        type: 'question',
        position: pos[QUESTION_ID],
        draggable: false,
        data: {
          question: run.question,
          thinking: run.status === 'running' && run.steps.length === 0,
          starts: roundSizes(run).get(Math.min(...run.steps.map((s) => s.round))) ?? 0,
        },
      },
    ]
    const sizes = roundSizes(run)
    for (const step of run.steps) {
      list.push({
        id: step.id,
        type: 'step',
        position: pos[step.id],
        draggable: false,
        data: { step, selected: step.id === selectedId, siblings: sizes.get(step.round) ?? 1 } satisfies StepData,
      })
    }
    // thoughts float over the first card of their turn, like annotations on a screenshot
    thoughtsByRound(run).forEach((thoughts, round) => {
      const anchor = run.steps.find((s) => s.round === round)
      if (!anchor) return
      thoughts.forEach((t, i) => {
        list.push({
          id: `thought-${t.seq}`,
          type: 'chip',
          position: { x: pos[anchor.id].x + 14 + i * 18, y: pos[anchor.id].y + CARD_H * 0.16 + i * 34 },
          draggable: false,
          selectable: false,
          zIndex: 20,
          data: { text: t.text },
        })
      })
    })
    return list
  }, [run, selectedId, cols])

  const edges = useMemo<FlowEdge[]>(
    () =>
      edgesOf(run).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'default',
        className: e.state === 'running' ? 'an-edge-running' : undefined,
        style: { stroke: e.state === 'error' ? '#c4574c' : '#8fb4d6', strokeWidth: 1.4 },
      })),
    [run]
  )

  // while running, follow the latest two turns; when finished, show the whole graph
  const focus = useMemo(() => {
    if (run.status !== 'running' || run.steps.length < 3) return null
    const rounds = [...new Set(run.steps.map((s) => s.round))].sort((a, b) => a - b).slice(-2)
    return run.steps.filter((s) => rounds.includes(s.round)).map((s) => s.id)
  }, [run])

  return (
    <div ref={boardRef} className="an-board relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.25}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelect(node.type === 'step' ? node.id : null)}
        onPaneClick={() => onSelect(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="#d9dcd7" />
        <Controls showInteractive={false} position="bottom-left" />
        <AutoFit trigger={`${run.steps.length}:${run.status}:${cols}`} focus={focus} />
      </ReactFlow>
      <StatusBar run={run} live={live} />
      <ActivityPill run={run} />
      {run.question == null && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[#8a9498] an-mono">
          Ask a question to watch the analyst work.
        </div>
      )}
    </div>
  )
}
