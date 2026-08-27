import type { StintSummary, TelemetrySamplePoint } from '@/types/agent'

export const CIRCUIT_BOX_W = 720
export const CIRCUIT_BOX_H = 420
export const CIRCUIT_PAD = 16

export interface CircuitPoints {
  width: number
  height: number
  points: Array<[number, number]>
  path: string
}

export function normalizeCircuitPoints(
  samples: TelemetrySamplePoint[]
): CircuitPoints | null {
  const xy = samples
    .map((s) => [s.x_pos, s.y_pos] as const)
    .filter((pair): pair is readonly [number, number] =>
      pair[0] != null && pair[1] != null
    ) as Array<[number, number]>
  if (xy.length < 2) return null

  const xs = xy.map(([x]) => x)
  const ys = xy.map(([, y]) => y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  let maxX = Math.max(...xs)
  let maxY = Math.max(...ys)
  if (maxX === minX) maxX = minX + 1
  if (maxY === minY) maxY = minY + 1

  const innerW = CIRCUIT_BOX_W - 2 * CIRCUIT_PAD
  const innerH = CIRCUIT_BOX_H - 2 * CIRCUIT_PAD
  const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY))
  const originX = CIRCUIT_PAD + (innerW - scale * (maxX - minX)) / 2
  const originY = CIRCUIT_PAD + (innerH - scale * (maxY - minY)) / 2

  const points: Array<[number, number]> = xy.map(([x, y]) => [
    Math.round(originX + (x - minX) * scale),
    Math.round(originY + (y - minY) * scale),
  ])

  const path = points
    .map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px} ${py}`)
    .join(' ')

  return { width: CIRCUIT_BOX_W, height: CIRCUIT_BOX_H, points, path }
}

export function speedGradientColor(speed: number, maxSpeed: number): string {
  if (maxSpeed <= 0) return '#2CF4C5'
  const t = Math.min(1, Math.max(0, speed / maxSpeed))
  const slow: [number, number, number] = [232, 0, 45]
  const mid: [number, number, number] = [255, 215, 0]
  const fast: [number, number, number] = [44, 244, 197]
  const from = t < 0.5 ? slow : mid
  const to = t < 0.5 ? mid : fast
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * k)) as [
    number,
    number,
    number,
  ]
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

export interface DegradationFitLine {
  ageStart: number
  ageEnd: number
  startMs: number
  endMs: number
}

export function degradationFit(stint: StintSummary): DegradationFitLine | null {
  if (!stint.laps.length || !Number.isFinite(stint.degradation_slope_ms_per_lap)) {
    return null
  }
  const slope = stint.degradation_slope_ms_per_lap
  const paceAtAge = (age: number) =>
    stint.initial_pace_ms + slope * (stint.start_lap - 1 + age)
  const ageStart = stint.laps[0].tyre_age
  const ageEnd = stint.laps[stint.laps.length - 1].tyre_age
  return {
    ageStart,
    ageEnd,
    startMs: Math.round(paceAtAge(ageStart)),
    endMs: Math.round(paceAtAge(ageEnd)),
  }
}