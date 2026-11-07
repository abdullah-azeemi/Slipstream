import { describe, expect, it } from 'vitest'
import { parseSse } from './analyst-stream'
import { replayDelays } from './analyst-replay'
import type { AnalystEvent } from '@/types/analyst'

describe('parseSse', () => {
  it('returns complete frames and keeps the unfinished tail', () => {
    const { frames, rest } = parseSse('event: analyst\ndata: {"type":"run_start"}\n\nevent: saved\ndata: {"run_id":1}\n\nevent: ana')
    expect(frames).toEqual([
      { event: 'analyst', data: { type: 'run_start' } },
      { event: 'saved', data: { run_id: 1 } },
    ])
    expect(rest).toBe('event: ana')
  })

  it('skips malformed frames instead of throwing', () => {
    const { frames } = parseSse('event: analyst\ndata: {oops\n\nevent: done\ndata: {}\n\n')
    expect(frames).toEqual([{ event: 'done', data: {} }])
  })
})

describe('replayDelays', () => {
  const ev = (t_ms: number) => ({ type: 'thought', seq: 0, t_ms, round: 0, text: '' }) as AnalystEvent
  it('caps long gaps, floors tiny ones and scales with speed', () => {
    expect(replayDelays([ev(0), ev(10), ev(20000)])).toEqual([0, 120, 1400])
    expect(replayDelays([ev(0), ev(20000)], 2)).toEqual([0, 700])
  })
})
