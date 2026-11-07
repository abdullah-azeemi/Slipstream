'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
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
  edgesOf,
  layoutRun,
  thoughtsByRound,
  type AnalystRunState,
  type AnalystStep,
} from '@/lib/analyst-graph'
import EChart from './EChart'

type StepData = { step: AnalystStep; selected: boolean }

function Target() {
  return (
    <div className="an-target" aria-hidden>
      <i /><i /><i /><i />
      <b />
    </div>
  )
}

function footerOf(step: AnalystStep): string {
  if (step.state === 'running') return 'running…'
  const secs = step.durationMs == null ? '' : step.durationMs < 1000 ? `${step.durationMs} ms` : `${(step.durationMs / 1000).toFixed(1)} s`
  if (step.state === 'error') return `failed${secs ? ` · ${secs}` : ''}`
  const charts = step.charts.length ? `${step.charts.length} chart${step.charts.length > 1 ? 's' : ''} · ` : ''
  return `${charts}${secs}`
}

const StepCard = memo(function StepCard({ data }: NodeProps<FlowNode<StepData>>) {
  const { step, selected } = data
  return (
    <div className="an-card" data-state={step.state} data-selected={selected}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="an-card-head">
        <span className="an-path">/ {step.tool}</span>
        <span className="an-title">{step.title}</span>
      </div>
      <div className="an-thumb">
        {step.charts[0] ? (
          <EChart option={step.charts[0].option} height={128} mini />
        ) : step.preview ? (
          <pre className="an-code">{step.preview}</pre>
        ) : (
          <div className="an-stat">{step.state === 'running' ? 'working…' : step.summary.slice(0, 160)}</div>
        )}
        {step.state === 'running' && <Target />}
      </div>
      <div className="an-foot" data-state={step.state}>{footerOf(step)}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
})

const QuestionCard = memo(function QuestionCard({ data }: NodeProps<FlowNode<{ question: string; thinking: boolean }>>) {
  return (
    <div className="an-q">
      <div className="an-card-head">
        <span className="an-path">/ question</span>
        <span className="an-title">{data.thinking ? 'thinking…' : 'asked'}</span>
      </div>
      <div className="an-q-body">{data.question}</div>
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

function AutoFit({ trigger, focus }: { trigger: string; focus: string[] | null }) {
  const { fitView } = useReactFlow()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  useEffect(() => {
    if (!width || !height) return
    const t = setTimeout(
      () =>
        fitView({
          padding: 0.2,
          maxZoom: 1,
          duration: 450,
          ...(focus ? { nodes: focus.map((id) => ({ id })) } : {}),
        }),
      150
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, width, height, fitView])
  return null
}

export default function AnalystCanvas({
  run,
  selectedId,
  onSelect,
}: {
  run: AnalystRunState
  selectedId: string | null
  onSelect: (id: string | null) => void
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
        data: { question: run.question, thinking: run.status === 'running' && run.steps.length === 0 },
      },
    ]
    for (const step of run.steps) {
      list.push({
        id: step.id,
        type: 'step',
        position: pos[step.id],
        draggable: false,
        data: { step, selected: step.id === selectedId } satisfies StepData,
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
    <div ref={boardRef} className="an-board h-full w-full">
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
      {run.question == null && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[#8a9498] an-mono">
          Ask a question to watch the analyst work.
        </div>
      )}
    </div>
  )
}
