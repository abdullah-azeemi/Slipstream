import { describe, expect, it } from 'vitest'
import type { AnalystEvent } from '@/types/analyst'
import { CARD_H, QUESTION_ID, edgesOf, layoutRun, reduceEvents, thoughtsByRound } from './analyst-graph'

const base = (seq: number) => ({ seq, t_ms: seq * 100 })
const start = (id: string, round: number, title = id): AnalystEvent => ({
  ...base(0), type: 'tool_start', round, call_id: id, tool: 'run_python', title, preview: 'print(1)',
})
const end = (id: string, round: number, ok = true): AnalystEvent => ({
  ...base(1), type: 'tool_end', round, call_id: id, ok, duration_ms: 50, summary: 'OK', title: `${id} done`, preview: '',
})

describe('reduceEvents', () => {
  it('runs a step from running to done and keeps the start preview when the end has none', () => {
    const running = reduceEvents([{ ...base(0), type: 'run_start', question: 'q' }, start('a', 0)])
    expect(running.status).toBe('running')
    expect(running.steps[0].state).toBe('running')
    const done = reduceEvents([{ ...base(0), type: 'run_start', question: 'q' }, start('a', 0), end('a', 0)])
    expect(done.steps[0]).toMatchObject({ state: 'done', durationMs: 50, title: 'a done', preview: 'print(1)' })
  })

  it('marks failed tools as error and attaches charts to their step', () => {
    const run = reduceEvents([
      { ...base(0), type: 'run_start', question: 'q' },
      start('a', 0),
      { ...base(2), type: 'chart', round: 0, call_id: 'a', title: 'Deg', option: { series: [] } },
      end('a', 0, false),
    ])
    expect(run.steps[0].state).toBe('error')
    expect(run.steps[0].charts).toHaveLength(1)
    expect(run.charts[0].title).toBe('Deg')
  })

  it('final sets the answer, cost and done status; error sets the error', () => {
    const done = reduceEvents([{ ...base(0), type: 'run_start', question: 'q' }, { ...base(3), type: 'final', markdown: 'ans', cost_usd: 0.004, steps: 2 }])
    expect(done).toMatchObject({ status: 'done', answer: 'ans', costUsd: 0.004, stepCount: 2 })
    const err = reduceEvents([{ ...base(0), type: 'run_start', question: 'q' }, { ...base(1), type: 'error', message: 'boom' }])
    expect(err).toMatchObject({ status: 'error', error: 'boom' })
  })

  it('a new run_start resets everything', () => {
    const run = reduceEvents([
      { ...base(0), type: 'run_start', question: 'one' }, start('a', 0),
      { ...base(0), type: 'run_start', question: 'two' },
    ])
    expect(run.question).toBe('two')
    expect(run.steps).toHaveLength(0)
  })
})

describe('edgesOf and layoutRun', () => {
  const run = reduceEvents([
    { ...base(0), type: 'run_start', question: 'q' },
    start('a', 0), start('b', 0), start('c', 1),
  ])

  it('first turn hangs off the question and the next turn depends on every sibling', () => {
    const edges = edgesOf(run).map((e) => `${e.source}->${e.target}`)
    expect(edges).toEqual([`${QUESTION_ID}->a`, `${QUESTION_ID}->b`, 'a->c', 'b->c'])
  })

  it('edge state follows the target step', () => {
    expect(edgesOf(run).every((e) => e.state === 'running')).toBe(true)
  })

  it('lays turns out left to right and siblings in one column', () => {
    const pos = layoutRun(run)
    expect(pos[QUESTION_ID].x).toBeLessThan(pos.a.x)
    expect(pos.a.x).toBe(pos.b.x)
    expect(pos.a.x).toBeLessThan(pos.c.x)
    expect(pos.a.y).not.toBe(pos.b.y)
  })

  it('wraps to a new row after maxCols columns and keeps cards from overlapping', () => {
    const long = reduceEvents([
      { ...base(0), type: 'run_start', question: 'q' },
      start('a', 0), start('b', 1), start('c', 2), start('d', 3),
    ])
    const pos = layoutRun(long, 3)
    expect(pos.c.x).toBeLessThan(pos.b.x + 1) // c starts the second row at the left edge
    expect(pos[QUESTION_ID].x).toBe(pos.c.x)
    expect(pos.c.y).toBeGreaterThan(pos.a.y + CARD_H)
    expect(layoutRun(long, 2).b.x).toBe(layoutRun(long, 2)[QUESTION_ID].x)
  })

  it('has no edges before the first tool call', () => {
    expect(edgesOf(reduceEvents([{ ...base(0), type: 'run_start', question: 'q' }]))).toEqual([])
  })
})

describe('thoughtsByRound', () => {
  it('groups by turn and moves reviewer notes onto the last turn', () => {
    const run = reduceEvents([
      { ...base(0), type: 'run_start', question: 'q' },
      { ...base(1), type: 'thought', round: 0, text: 'first' },
      start('a', 0),
      { ...base(2), type: 'thought', round: 5, text: 'Reviewer: fix' },
    ])
    const map = thoughtsByRound(run)
    expect(map.get(0)?.map((t) => t.text)).toEqual(['first', 'Reviewer: fix'])
  })
})
