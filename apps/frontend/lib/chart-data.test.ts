import { describe, expect, it } from 'vitest'
import {
  CIRCUIT_BOX_W,
  CIRCUIT_BOX_H,
  degradationFit,
  normalizeCircuitPoints,
  speedGradientColor,
} from './chart-data'
import type { StintSummary, TelemetrySamplePoint } from '@/types/agent'

function sample(x: number | null, y: number | null, speed = 300): TelemetrySamplePoint {
  return {
    distance_m: 0,
    speed_kmh: speed,
    throttle_pct: 100,
    brake: false,
    gear: 8,
    drs: 1,
    x_pos: x,
    y_pos: y,
  }
}

describe('normalizeCircuitPoints', () => {
  it('normalizes xy into the padded box while preserving aspect ratio', () => {
    const view = normalizeCircuitPoints([
      sample(0, 0),
      sample(2000, 0),
      sample(2000, 1000),
      sample(0, 1000),
    ])
    expect(view).not.toBeNull()
    if (!view) return
    expect(view.width).toBe(CIRCUIT_BOX_W)
    expect(view.height).toBe(CIRCUIT_BOX_H)
    const [x0, y0] = view.points[0]
    const [x2, y2] = view.points[2]
    expect(x0).toBeGreaterThanOrEqual(16)
    expect(y0).toBeGreaterThanOrEqual(16)
    expect(x2).toBeLessThanOrEqual(CIRCUIT_BOX_W - 16)
    expect(y2).toBeLessThanOrEqual(CIRCUIT_BOX_H - 16)
    const spanW = x2 - x0
    const spanH = y2 - y0
    expect(spanW).toBeGreaterThan(0)
    expect(spanH).toBeGreaterThan(0)
    expect(spanW / spanH).toBeCloseTo(2.0, 1)
    expect(view.path.startsWith('M')).toBe(true)
    expect(view.points).toHaveLength(4)
  })

  it('returns null when fewer than two xy pairs are present', () => {
    expect(normalizeCircuitPoints([sample(0, 0), sample(null, null)])).toBeNull()
    expect(normalizeCircuitPoints([])).toBeNull()
  })
})

describe('speedGradientColor', () => {
  it('maps the slowest point to red and the fastest to green', () => {
    expect(speedGradientColor(0, 300)).toContain('232, 0, 45')
    expect(speedGradientColor(300, 300)).toContain('44, 244, 197')
  })

  it('uses the emerald fallback when max speed is unknown', () => {
    expect(speedGradientColor(50, 0)).toBe('#2CF4C5')
  })
})

describe('degradationFit', () => {
  it('projects the OLS line onto the tyre-age axis', () => {
    const stint: StintSummary = {
      stint_index: 2,
      compound: 'HARD',
      start_lap: 40,
      end_lap: 43,
      total_laps: 4,
      initial_pace_ms: 78500,
      final_pace_ms: 87100,
      degradation_slope_ms_per_lap: 200,
      cliff_detected: false,
      cliff_lap: null,
      laps: [
        { lap_number: 40, tyre_age: 1, lap_time_ms: 86500 },
        { lap_number: 41, tyre_age: 2, lap_time_ms: 86700 },
        { lap_number: 42, tyre_age: 3, lap_time_ms: 86900 },
        { lap_number: 43, tyre_age: 4, lap_time_ms: 87100 },
      ],
    }
    const fit = degradationFit(stint)
    expect(fit).toEqual({ ageStart: 1, ageEnd: 4, startMs: 86500, endMs: 87100 })
  })

  it('returns null for a stint without scatter points', () => {
    expect(
      degradationFit({
        stint_index: 1,
        compound: 'SOFT',
        start_lap: 5,
        end_lap: 9,
        total_laps: 5,
        initial_pace_ms: 90000,
        final_pace_ms: 90800,
        degradation_slope_ms_per_lap: 200,
        cliff_detected: false,
        cliff_lap: null,
        laps: [],
      })
    ).toBeNull()
  })
})