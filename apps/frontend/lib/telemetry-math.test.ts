import { describe, expect, it } from 'vitest'

import { getErrorMessage, interpolateSamples, isPracticeSession, isRaceSession } from '@/lib/telemetry-math'
import type { TelemetrySample } from '@/types/f1'

const sample = (distance_m: number, speed_kmh: number): TelemetrySample =>
  ({ distance_m, speed_kmh, throttle_pct: 100, gear: 7, rpm: 11000, brake: false, drs: 0, x_pos: distance_m, y_pos: 0 }) as unknown as TelemetrySample

describe('session helpers', () => {
  it('recognises race and practice sessions', () => {
    expect(isRaceSession('R')).toBe(true)
    expect(isRaceSession('Q')).toBe(false)
    expect(isPracticeSession('FP2')).toBe(true)
    expect(isPracticeSession('R')).toBe(false)
    expect(isPracticeSession(null)).toBe(false)
  })
})

describe('interpolateSamples', () => {
  it('returns empty channels for no samples', () => {
    expect(interpolateSamples([]).dist).toEqual([])
  })

  it('resamples to the requested number of points across the distance range', () => {
    const out = interpolateSamples([sample(0, 100), sample(1000, 300)], 5)
    expect(out.dist).toEqual([0, 250, 500, 750, 1000])
    expect(out.speed).toEqual([100, 150, 200, 250, 300])
  })

  it('sorts samples by distance and ignores ones without distance', () => {
    const bad = { ...sample(0, 0), distance_m: null } as unknown as TelemetrySample
    const out = interpolateSamples([sample(1000, 300), bad, sample(0, 100)], 3)
    expect(out.speed).toEqual([100, 200, 300])
  })
})

describe('getErrorMessage', () => {
  it('prefers an Error message', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('falls back for empty or unknown values', () => {
    expect(getErrorMessage('')).toBe('Something went wrong')
    expect(getErrorMessage(null, 'custom')).toBe('custom')
  })

  it('describes event like errors by type', () => {
    expect(getErrorMessage({ type: 'error' })).toBe('Request failed while handling error')
  })
})
