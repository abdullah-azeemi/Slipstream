import type { AnalystEvent } from '@/types/analyst'

export type StepState = 'running' | 'done' | 'error'

export interface AnalystChart {
  callId: string
  title: string
  option: Record<string, unknown>
}

export interface AnalystStep {
  id: string
  round: number
  tool: string
  title: string
  preview: string
  state: StepState
  durationMs: number | null
  summary: string
  charts: AnalystChart[]
}

export interface AnalystThought {
  round: number
  text: string
  seq: number
}

export interface AnalystRunState {
  question: string | null
  steps: AnalystStep[]
  thoughts: AnalystThought[]
  charts: AnalystChart[]
  answer: string | null
  costUsd: number
  stepCount: number
  status: 'idle' | 'running' | 'done' | 'error'
  error: string | null
  /** t_ms of the latest event: how long the run has been going. */
  elapsedMs: number
}

export const emptyRun: AnalystRunState = {
  question: null,
  steps: [],
  thoughts: [],
  charts: [],
  answer: null,
  costUsd: 0,
  stepCount: 0,
  status: 'idle',
  error: null,
  elapsedMs: 0,
}

/** Pure, immutable reducer: one streamed event in, next run state out. */
function reduceOne(run: AnalystRunState, ev: AnalystEvent): AnalystRunState {
  switch (ev.type) {
    case 'run_start':
      return { ...emptyRun, question: ev.question, status: 'running' }
    case 'thought':
      return { ...run, thoughts: [...run.thoughts, { round: ev.round, text: ev.text, seq: ev.seq }] }
    case 'tool_start':
      return {
        ...run,
        steps: [
          ...run.steps,
          {
            id: ev.call_id,
            round: ev.round,
            tool: ev.tool,
            title: ev.title,
            preview: ev.preview,
            state: 'running',
            durationMs: null,
            summary: '',
            charts: [],
          },
        ],
      }
    case 'tool_end':
      return {
        ...run,
        steps: run.steps.map((s) =>
          s.id === ev.call_id
            ? {
                ...s,
                state: ev.ok ? 'done' : 'error',
                durationMs: ev.duration_ms,
                summary: ev.summary,
                title: ev.title || s.title,
                preview: ev.preview || s.preview,
              }
            : s
        ),
      }
    case 'chart': {
      const chart: AnalystChart = { callId: ev.call_id, title: ev.title, option: ev.option }
      return {
        ...run,
        charts: [...run.charts, chart],
        steps: run.steps.map((s) => (s.id === ev.call_id ? { ...s, charts: [...s.charts, chart] } : s)),
      }
    }
    case 'final':
      return { ...run, answer: ev.markdown, costUsd: ev.cost_usd, stepCount: ev.steps, status: 'done' }
    case 'error':
      return { ...run, status: 'error', error: ev.message }
    default:
      return run
  }
}

export function applyEvent(run: AnalystRunState, ev: AnalystEvent): AnalystRunState {
  const next = reduceOne(run, ev)
  return { ...next, elapsedMs: Math.max(ev.type === 'run_start' ? 0 : run.elapsedMs, ev.t_ms) }
}

export function reduceEvents(events: AnalystEvent[]): AnalystRunState {
  return events.reduce(applyEvent, emptyRun)
}

export const QUESTION_ID = 'question'

export interface AnalystEdge {
  id: string
  source: string
  target: string
  state: 'idle' | 'running' | 'done' | 'error'
}

/**
 * Dynamic DAG: steps issued in the same model turn are siblings, and every
 * step depends on all steps of the previous turn (the first turn depends on
 * the question).
 */
export function edgesOf(run: AnalystRunState): AnalystEdge[] {
  const rounds = [...new Set(run.steps.map((s) => s.round))].sort((a, b) => a - b)
  const edges: AnalystEdge[] = []
  rounds.forEach((round, i) => {
    const sources = i === 0 ? [QUESTION_ID] : run.steps.filter((s) => s.round === rounds[i - 1]).map((s) => s.id)
    for (const target of run.steps.filter((s) => s.round === round)) {
      for (const source of sources) {
        edges.push({
          id: `${source}->${target.id}`,
          source,
          target: target.id,
          state: target.state === 'running' ? 'running' : target.state === 'error' ? 'error' : 'done',
        })
      }
    }
  })
  return edges
}

export const CARD_W = 288
export const CARD_H = 222
export const GAP_X = 88
export const GAP_Y = 64

export interface Position {
  x: number
  y: number
}

/**
 * Left-to-right layout that wraps after `maxCols` grid columns. The question and each model
 * turn get a column; a turn with three or more parallel steps takes two grid columns and lays
 * its steps out two across, so parallel work reads as a block rather than a tall tower.
 */
export function layoutRun(run: AnalystRunState, maxCols = 3): Record<string, Position> {
  const positions: Record<string, Position> = { [QUESTION_ID]: { x: 0, y: 0 } }
  const rounds = [...new Set(run.steps.map((s) => s.round))].sort((a, b) => a - b)
  const perRow = Math.max(1, maxCols)
  const columns = [
    { ids: [QUESTION_ID], span: 1 },
    ...rounds.map((r) => {
      const ids = run.steps.filter((s) => s.round === r).map((s) => s.id)
      return { ids, span: Math.min(ids.length >= 3 ? 2 : 1, perRow) }
    }),
  ]
  const stepX = CARD_W + GAP_X
  const height = (n: number) => n * CARD_H + (n - 1) * GAP_Y
  const rowsOf = (c: { ids: string[]; span: number }) => Math.ceil(c.ids.length / c.span)

  const gridRows: (typeof columns)[] = [[]]
  let used = 0
  for (const column of columns) {
    if (used + column.span > perRow && gridRows[gridRows.length - 1].length) {
      gridRows.push([])
      used = 0
    }
    gridRows[gridRows.length - 1].push(column)
    used += column.span
  }

  let rowTop = 0
  for (const row of gridRows) {
    const rowHeight = Math.max(...row.map((c) => height(rowsOf(c))))
    let spanBefore = 0
    for (const column of row) {
      const top = rowTop + (rowHeight - height(rowsOf(column))) / 2
      column.ids.forEach((id, i) => {
        positions[id] = {
          x: (spanBefore + (i % column.span)) * stepX,
          y: top + Math.floor(i / column.span) * (CARD_H + GAP_Y),
        }
      })
      spanBefore += column.span
    }
    rowTop += rowHeight + GAP_Y * 1.4
  }
  return positions
}

/** Thoughts belong to the turn that issued the steps; reviewer notes fall back to the last turn. */
export function thoughtsByRound(run: AnalystRunState): Map<number, AnalystThought[]> {
  const rounds = new Set(run.steps.map((s) => s.round))
  const last = Math.max(-1, ...rounds)
  const out = new Map<number, AnalystThought[]>()
  for (const t of run.thoughts) {
    const key = rounds.has(t.round) ? t.round : last
    if (key < 0) continue
    out.set(key, [...(out.get(key) ?? []), t])
  }
  return out
}

/** How many steps each model turn issued, by round: more than one means they ran in parallel. */
export function roundSizes(run: AnalystRunState): Map<number, number> {
  const sizes = new Map<number, number>()
  for (const s of run.steps) sizes.set(s.round, (sizes.get(s.round) ?? 0) + 1)
  return sizes
}

export interface RunCounts {
  running: number
  done: number
  failed: number
  total: number
}

export function runCounts(run: AnalystRunState): RunCounts {
  const count = (state: StepState) => run.steps.filter((s) => s.state === state).length
  return { running: count('running'), done: count('done'), failed: count('error'), total: run.steps.length }
}

export interface Activity {
  verb: string
  detail: string
  busy: boolean
}

const VERBS: Record<string, string> = {
  find_sessions: 'Searching',
  race_summary: 'Reading the race',
  load_laps: 'Loading',
  load_telemetry: 'Loading',
  load_context: 'Loading',
  run_python: 'Computing',
}

/** What the agent is doing right now, in words, for the floating pill. */
export function currentActivity(run: AnalystRunState): Activity | null {
  if (run.question == null) return null
  if (run.status === 'error') return { verb: 'Stopped', detail: run.error ?? 'the analysis failed', busy: false }
  if (run.status === 'done') return { verb: 'Answer ready', detail: `${run.steps.length} steps`, busy: false }
  const active = run.steps.filter((s) => s.state === 'running')
  if (active.length > 1) {
    return { verb: `Running ${active.length} steps in parallel`, detail: active.map((s) => s.title).join(' · '), busy: true }
  }
  if (active.length === 1) return { verb: VERBS[active[0].tool] ?? 'Working on', detail: active[0].title, busy: true }
  return run.steps.length
    ? { verb: 'Reading the results', detail: 'deciding the next step', busy: true }
    : { verb: 'Planning', detail: 'choosing what data to load', busy: true }
}

export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
