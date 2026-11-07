import { fetchWithAuth } from '@/lib/auth-token'
import type { TelemetrySample } from '@/types/f1'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Session helpers ───────────────────────────────────────────────────────────
export const isRaceSession = (t: string | null) => t === 'R'
export const isPracticeSession = (t: string | null) => t === 'FP1' || t === 'FP2' || t === 'FP3'

// ── Telemetry fetch ───────────────────────────────────────────────────────────
export async function fetchTelemetryCompare(
  sessionKey: number,
  drivers: number[],
  laps?: string,
  signal?: AbortSignal,
): Promise<{ samples: TelemetrySample[]; lapNumbers: Map<number, number> }> {
  const query = laps ? `&laps=${laps}` : ''
  const res = await fetchWithAuth(
    `${BASE}/api/v1/sessions/${sessionKey}/telemetry/compare?drivers=${drivers.join(',')}${query}`,
    { signal },
  )
  if (!res.ok) throw new Error(`telemetry ${res.status}`)
  const data = await res.json()
  const lapNumbers = new Map<number, number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let samples: any[] = []
  if (Array.isArray(data)) {
    samples = data
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    samples = Object.entries(data).flatMap(([dn, val]: [string, any]) => {
      const driverNum = parseInt(dn)
      const rows = Array.isArray(val) ? val : (val?.samples ?? [])
      if (val?.lap_number) lapNumbers.set(driverNum, val.lap_number)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return rows.map((r: any) => ({ ...r, driver_number: driverNum }))
    })
  }
  return { samples, lapNumbers }
}

// ── Interpolation ─────────────────────────────────────────────────────────────
export type Interp = {
  dist: number[]; speed: number[]; throttle: number[]
  gear: number[]; rpm: number[]; brake: number[]; drs: number[]
  x: number[]; y: number[]
}

export function interpolateSamples(samples: TelemetrySample[], points = 500): Interp {
  const empty: Interp = { dist: [], speed: [], throttle: [], gear: [], rpm: [], brake: [], drs: [], x: [], y: [] }
  if (!samples.length) return empty
  const sorted = [...samples].filter(s => s.distance_m != null).sort((a, b) => a.distance_m! - b.distance_m!)
  if (!sorted.length) return empty
  const minD = sorted[0].distance_m!
  const maxD = sorted[sorted.length - 1].distance_m!
  const step = (maxD - minD) / (points - 1)
  const dist = Array.from({ length: points }, (_, i) => minD + i * step)
  const lerp = (field: keyof TelemetrySample, d: number): number => {
    const idx = sorted.findIndex(s => s.distance_m! >= d)
    if (idx <= 0) {
      const val = sorted[0]?.[field]
      return typeof val === 'boolean' ? (val ? 100 : 0) : (val as number ?? 0)
    }
    const a = sorted[idx - 1], b = sorted[idx]
    const t = (d - a.distance_m!) / ((b.distance_m! - a.distance_m!) || 1)
    const vA = typeof a[field] === 'boolean' ? (a[field] ? 100 : 0) : (a[field] as number ?? 0)
    const vB = typeof b[field] === 'boolean' ? (b[field] ? 100 : 0) : (b[field] as number ?? 0)
    return vA * (1 - t) + vB * t
  }

  return {
    dist,
    speed: dist.map(d => lerp('speed_kmh', d)),
    throttle: dist.map(d => lerp('throttle_pct', d)),
    gear: dist.map(d => Math.round(lerp('gear', d))),
    rpm: dist.map(d => lerp('rpm', d)),
    brake: dist.map(d => {
      const b = lerp('brake', d);
      return b > 10 ? 100 : 0;
    }),
    drs: dist.map(d => lerp('drs', d)),
    x: dist.map(d => lerp('x_pos', d)),
    y: dist.map(d => lerp('y_pos', d)),
  }
}

export type DriverSectorTimes = { s1_ms: number | null; s2_ms: number | null; s3_ms: number | null; lap_number: number }
export type TooltipValue = {
  abbr: string
  colour: string
  speed: number
  throttle: number
  gear: number
  rpm: number
  brake: number
}
export type TooltipSnapshot = { dist: number; progress: number; verticalProgress: number; speedDelta: number | null; values: TooltipValue[] }
export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'type' in error) {
    const type = String((error as { type?: unknown }).type ?? '').trim()
    return type ? `Request failed while handling ${type}` : fallback
  }
  return fallback
}

