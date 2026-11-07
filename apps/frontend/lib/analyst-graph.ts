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
}

/** Pure, immutable reducer: one streamed event in, next run state out. */
export function applyEvent(run: AnalystRunState, ev: AnalystEvent): AnalystRunState {
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

export const CARD_W = 268
export const CARD_H = 196
export const GAP_X = 88
export const GAP_Y = 64

export interface Position {
  x: number
  y: number
}

/**
 * Left-to-right layout that wraps after `maxCols` columns (question, then one
 * column per model turn), so long runs stay readable instead of shrinking.
 * Steps of one turn share a column; each grid row is centred on its tallest column.
 */
export function layoutRun(run: AnalystRunState, maxCols = 3): Record<string, Position> {
  const positions: Record<string, Position> = { [QUESTION_ID]: { x: 0, y: 0 } }
  const rounds = [...new Set(run.steps.map((s) => s.round))].sort((a, b) => a - b)
  const columns = [[QUESTION_ID], ...rounds.map((r) => run.steps.filter((s) => s.round === r).map((s) => s.id))]
  const perRow = Math.max(1, maxCols)
  const colHeight = (n: number) => n * CARD_H + (n - 1) * GAP_Y

  let rowTop = 0
  for (let rowStart = 0; rowStart < columns.length; rowStart += perRow) {
    const rowCols = columns.slice(rowStart, rowStart + perRow)
    const rowHeight = Math.max(...rowCols.map((c) => colHeight(c.length)))
    rowCols.forEach((ids, i) => {
      const top = rowTop + (rowHeight - colHeight(ids.length)) / 2
      ids.forEach((id, row) => {
        positions[id] = { x: i * (CARD_W + GAP_X), y: top + row * (CARD_H + GAP_Y) }
      })
    })
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
