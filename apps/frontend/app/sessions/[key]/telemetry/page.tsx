'use client'

import { use, useEffect, useRef, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import {
  getSegmentDriverNumbers,
  getSegmentEntries,
  getSegmentLapByDriver,
  getSegmentSummary,
  reconcileSelectedDrivers,
  type QualiSegmentsData,
} from '@/lib/telemetry-quali'
import { teamColour, formatLapTime } from '@/lib/utils'
import type { Driver, TelemetrySample } from '@/types/f1'
import CornerAnalysis from '@/components/telemetry/CornerAnalysis'
import RaceAnalysis from '@/components/analysis/RaceAnalysis'
import PracticeAnalysis from '@/components/analysis/PracticeAnalysis'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Session type helpers ──────────────────────────────────────────────────────

function isRaceSession(type: string | null) { return type === 'R' }
function isPracticeSession(type: string | null) { return type === 'FP1' || type === 'FP2' || type === 'FP3' }

function sessionModeLabel(type: string | null): string {
  if (!type) return ''
  if (isRaceSession(type)) return 'Race Analysis'
  if (isPracticeSession(type)) return 'Practice Analysis'
  return 'Speed Traces'
}

// ── Telemetry fetch (Qualifying mode) ─────────────────────────────────────────

async function fetchTelemetryCompare(
  sessionKey: number,
  drivers: number[],
  laps?: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ samples: any[]; lapNumbers: Map<number, number> }> {
  const lapsQuery = laps ? `&laps=${laps}` : ''
  const res = await fetch(
    `${BASE}/api/v1/sessions/${sessionKey}/telemetry/compare?drivers=${drivers.join(',')}${lapsQuery}`
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

// ── Constants ─────────────────────────────────────────────────────────────────
const CHART_BG = '#0A0A0A'
const AXIS_COLOR = '#1E1E1E'
const TEXT_DIM = '#3F3F46'
const TEXT_MID = '#71717A'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RED_ACCENT = '#E8002D'
const GREEN_DRS = '#22FF88'
const BRAKE_COLOR = '#FF2D55'
const CROSSHAIR = 'rgba(255,255,255,0.12)'

// ── Interpolation ─────────────────────────────────────────────────────────────
type Interp = {
  dist: number[]; speed: number[]; throttle: number[];
  gear: number[]; rpm: number[]; brake: boolean[]; drs: number[];
  x: number[]; y: number[];
}

function interpolateSamples(samples: TelemetrySample[], points = 400): Interp {
  if (!samples.length) return { dist: [], speed: [], throttle: [], gear: [], rpm: [], brake: [], drs: [], x: [], y: [] }
  const sorted = [...samples].filter(s => s.distance_m != null).sort((a, b) => a.distance_m! - b.distance_m!)
  if (!sorted.length) return { dist: [], speed: [], throttle: [], gear: [], rpm: [], brake: [], drs: [], x: [], y: [] }
  const minDist = sorted[0].distance_m!
  const maxDist = sorted[sorted.length - 1].distance_m!
  const step = (maxDist - minDist) / (points - 1)
  const dist = Array.from({ length: points }, (_, i) => minDist + i * step)

  function lerp(field: keyof TelemetrySample, d: number): number {
    const idx = sorted.findIndex(s => s.distance_m! >= d)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (idx <= 0) return (sorted[0]?.[field] as any) ?? 0
    const a = sorted[idx - 1], b = sorted[idx]
    const t = (d - a.distance_m!) / ((b.distance_m! - a.distance_m!) || 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (((a[field] as any) ?? 0) * (1 - t) + ((b[field] as any) ?? 0) * t) as number
  }

  return {
    dist,
    speed: dist.map(d => lerp('speed_kmh', d)),
    throttle: dist.map(d => lerp('throttle_pct', d)),
    gear: dist.map(d => Math.round(lerp('gear', d))),
    rpm: dist.map(d => lerp('rpm', d)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    brake: dist.map(d => lerp('brake' as any, d) > 0.5),
    drs: dist.map(d => lerp('drs', d)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    x: dist.map(d => lerp('x_pos' as any, d)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y: dist.map(d => lerp('y_pos' as any, d)),
  }
}

// ── Drawing helpers ───────────────────────────────────────────────────────────
const PAD = { top: 10, right: 10, bottom: 26, left: 48 }

function chartCoords(W: number, H: number) {
  return {
    cW: W - PAD.left - PAD.right,
    cH: H - PAD.top - PAD.bottom,
    toX: (nx: number) => PAD.left + nx * (W - PAD.left - PAD.right),
    toY: (ny: number, cH: number) => PAD.top + cH - ny * cH,
  }
}

function drawGridAndAxes(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  yMin: number, yMax: number,
  gridCount: number,
  isRpm: boolean,
  sectorLines: number[],
) {
  const { cW, cH } = chartCoords(W, H)
  ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, H)
  for (let i = 0; i <= gridCount; i++) {
    const y = PAD.top + cH - (i / gridCount) * cH
    ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
    ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
    const val = yMin + (i / gridCount) * (yMax - yMin)
    ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
    ctx.fillText(isRpm ? `${(val / 1000).toFixed(0)}k` : Math.round(val).toString(), PAD.left - 6, y + 3)
  }
  sectorLines.forEach((nx, si) => {
    const sx = PAD.left + nx * cW
    ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1
    ctx.setLineDash([3, 4]); ctx.moveTo(sx, PAD.top); ctx.lineTo(sx, PAD.top + cH); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = TEXT_DIM; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText(`S${si + 2}`, sx, PAD.top + cH + 16)
  })
  ctx.fillStyle = TEXT_DIM; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'center'
  for (let i = 0; i <= 4; i++) {
    const nx = i / 4
    const x = PAD.left + nx * cW
    ctx.fillText(`${(nx * 100).toFixed(0)}%`, x, PAD.top + cH + 16)
  }
}

function drawLine(ctx: CanvasRenderingContext2D, vals: number[], colour: string, W: number, H: number, yMin: number, yMax: number, lw = 2) {
  const { cW, cH } = chartCoords(W, H)
  ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.lineJoin = 'round'
  vals.forEach((v, i) => {
    const nx = i / (vals.length - 1)
    const ny = (v - yMin) / (yMax - yMin)
    const cx = PAD.left + nx * cW
    const cy = PAD.top + cH - ny * cH
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy)
  })
  ctx.stroke()
}

function drawCrosshair(ctx: CanvasRenderingContext2D, nx: number, W: number, H: number) {
  const { cW, cH } = chartCoords(W, H)
  const cx = PAD.left + nx * cW
  ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
  ctx.moveTo(cx, PAD.top); ctx.lineTo(cx, PAD.top + cH); ctx.stroke()
}

function drawDots(ctx: CanvasRenderingContext2D, nx: number, W: number, H: number, driverData: DriverRenderData[], field: string, yMin: number, yMax: number) {
  const { cW, cH } = chartCoords(W, H)
  const cx = PAD.left + nx * cW
  driverData.forEach(({ interp, colour }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vals = (interp as any)[field] as number[]
    const idx = Math.round(nx * (vals.length - 1))
    const v = vals[idx] ?? 0
    const ny = (v - yMin) / (yMax - yMin)
    const cy = PAD.top + cH - ny * cH
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fillStyle = colour; ctx.fill()
    ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5; ctx.stroke()
  })
}

type DriverRenderData = { interp: Interp; colour: string; abbr: string }

// ── Chart configs (qualifying mode) ──────────────────────────────────────────
const CHARTS = [
  { label: 'SPEED', unit: 'km/h', field: 'speed', yMin: 60, yMax: 360, height: 200, gridCount: 6, isRpm: false },
  { label: 'THROTTLE', unit: '%', field: 'throttle', yMin: 0, yMax: 100, height: 120, gridCount: 4, isRpm: false },
  { label: 'GEAR', unit: '1–8', field: 'gear', yMin: 1, yMax: 8, height: 100, gridCount: 7, isRpm: false },
  { label: 'RPM', unit: 'rpm', field: 'rpm', yMin: 4000, yMax: 13000, height: 130, gridCount: 5, isRpm: true },
]

type DriverSectorTimes = {
  s1_ms: number | null
  s2_ms: number | null
  s3_ms: number | null
  lap_number: number
}

// ── Main page ─────────────────────────────────────────────────────────────────


// ── Q1/Q2/Q3 segment types ───────────────────────────────────────────────────
export default function TelemetryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const sessionKey = parseInt(key)

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [telData, setTelData] = useState<Map<number, Interp>>(new Map())
  const [tooltipNx, setTooltipNx] = useState<number | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tooltipData, setTooltipData] = useState<{ dist: number; values: any[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sessionYear, setSessionYear] = useState<number | null>(null)
  const [sessionType, setSessionType] = useState<string | null>(null)
  const [sectorTimes, setSectorTimes] = useState<Map<number, DriverSectorTimes>>(new Map())
  const [telLapNumbers, setTelLapNumbers] = useState<Map<number, number>>(new Map())
  const [qualiSegments, setQualiSegments] = useState<QualiSegmentsData | null>(null)
  const [activeSegment, setActiveSegment] = useState<'Q1' | 'Q2' | 'Q3'>('Q1')
  const [selectedSegment, setSelectedSegment] = useState<'Q1' | 'Q2' | 'Q3'>('Q3')


  const is2026 = sessionYear === 2026

  const chartRefs = useRef<(HTMLCanvasElement | null)[]>([null, null, null, null])
  const deltaRef = useRef<HTMLCanvasElement | null>(null)
  const drsRef = useRef<HTMLCanvasElement | null>(null)
  const trackRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const segmentEntries = getSegmentEntries(qualiSegments, selectedSegment)
  const segmentDriverNumbers = getSegmentDriverNumbers(segmentEntries)
  const segmentLapByDriver = getSegmentLapByDriver(segmentEntries)
  const segmentDriverKey = segmentEntries.map(entry => entry.driver_number).join(',')
  const segmentSummary = getSegmentSummary(selectedSegment, segmentEntries)

  // Load session metadata + drivers
  useEffect(() => {
    api.sessions.get(sessionKey).then(s => {
      setSessionYear(s.year)
      setSessionType(s.session_type ?? null)
    }).catch(() => { })

    api.drivers.list(sessionKey).then(d => {
      setDrivers(d)
      if (d.length >= 2) setSelected([d[0].driver_number, d[1].driver_number])
    })
  }, [sessionKey])

  // Keep the qualifying selection aligned to the active segment.
  useEffect(() => {
    if (!sessionType) return
    if (isRaceSession(sessionType) || isPracticeSession(sessionType)) return
    if (!qualiSegments?.segments) return

    setSelected(prev => {
      const next = reconcileSelectedDrivers(prev, drivers, segmentDriverNumbers)
      return next.length === prev.length && next.every((dn, i) => dn === prev[i]) ? prev : next
    })
  }, [drivers, qualiSegments, selectedSegment, sessionType, segmentDriverKey, segmentDriverNumbers])

  // Load telemetry (qualifying mode only)
  useEffect(() => {
    if (!selected.length || !sessionType) return
    if (isRaceSession(sessionType) || isPracticeSession(sessionType)) return

     
    // Build pinned lap numbers from selected segment if available
    const buildLapsParam = (seg: 'Q1' | 'Q2' | 'Q3') => {
      if (!qualiSegments?.segments) return undefined
      const entries = qualiSegments.segments[seg]
      if (!entries?.length) return undefined
      const pairs = selected
        .map(dn => {
          const entry = entries.find(e => e.driver_number === dn)
          return entry ? `${dn}:${entry.lap_number}` : null
        })
        .filter(Boolean)
      return pairs.length ? pairs.join(',') : undefined
    }

    setLoading(true)
    const lapsParam = buildLapsParam(selectedSegment)
    fetchTelemetryCompare(sessionKey, selected, lapsParam)
      .then(({ samples, lapNumbers }) => {
        setTelLapNumbers(lapNumbers)
        const byDriver = new Map<number, TelemetrySample[]>()
        samples.forEach(s => {
          if (!byDriver.has(s.driver_number)) byDriver.set(s.driver_number, [])
          byDriver.get(s.driver_number)!.push(s)
        })
        const interped = new Map<number, Interp>()
        byDriver.forEach((rows, dn) => interped.set(dn, interpolateSamples(rows)))
        setTelData(interped)
      })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, selected.join(','), sessionType, selectedSegment, qualiSegments])

  // Fetch sector times for qualifying mode
  useEffect(() => {
    if (!selected.length || !telLapNumbers.size) return
    const fetchAll = selected.map(async (driverNum) => {
      try {
        const laps = await api.laps.list(sessionKey, driverNum)
        const telLap = telLapNumbers.get(driverNum)
        const matched = laps.find(l => l.lap_number === telLap)
          ?? laps.reduce((best, l) =>
            (l.lap_time_ms ?? Infinity) < (best.lap_time_ms ?? Infinity) ? l : best
            , laps[0])
        if (!matched) return null
        return {
          driverNum,
          times: {
            s1_ms: matched.s1_ms ?? null,
            s2_ms: matched.s2_ms ?? null,
            s3_ms: matched.s3_ms ?? null,
            lap_number: matched.lap_number,
          } as DriverSectorTimes,
        }
      } catch { return null }
    })
    Promise.all(fetchAll).then(results => {
      const map = new Map<number, DriverSectorTimes>()
      results.forEach(r => { if (r) map.set(r.driverNum, r.times) })
      setSectorTimes(map)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, selected.join(','), telLapNumbers])


  // Fetch Q1/Q2/Q3 segment leaderboards for qualifying sessions
  useEffect(() => {
    if (!sessionType || isRaceSession(sessionType) || isPracticeSession(sessionType)) return
    fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/quali-segments`)
      .then(r => r.json())
      .then((data: QualiSegmentsData) => {
        setQualiSegments(data)
      })
      .catch(() => {})
  }, [sessionKey, sessionType])

  // Build driver render data (qualifying canvas)
  const driverData: DriverRenderData[] = selected
    .map(dn => {
      const interp = telData.get(dn)
      const d = drivers.find(x => x.driver_number === dn)
      if (!interp || !d) return null
      return { interp, colour: teamColour(d.team_colour, d.team_name), abbr: d.abbreviation }
    })
    .filter(Boolean) as DriverRenderData[]

  const sectorLines = [1 / 3, 2 / 3]

  // Render qualifying canvases
  useEffect(() => {
    if (!driverData.length) return
    if (sessionType && (isRaceSession(sessionType) || isPracticeSession(sessionType))) return

    const W = containerRef.current?.clientWidth ?? 900

    CHARTS.forEach((cfg, i) => {
      const canvas = chartRefs.current[i]
      if (!canvas) return
      canvas.width = W; canvas.height = cfg.height
      const ctx = canvas.getContext('2d')!
      drawGridAndAxes(ctx, W, cfg.height, cfg.yMin, cfg.yMax, cfg.gridCount, cfg.isRpm, sectorLines)
      if (cfg.field === 'speed' && driverData[0]) {
        const { cW, cH } = chartCoords(W, cfg.height)
        const br = driverData[0].interp.brake
        let inBrake = false, bs = 0
        br.forEach((b, i) => {
          const nx = i / (br.length - 1)
          if (b && !inBrake) { inBrake = true; bs = nx }
          if (!b && inBrake) {
            inBrake = false
            ctx.fillStyle = 'rgba(255,45,85,0.08)'
            ctx.fillRect(PAD.left + bs * cW, PAD.top, (nx - bs) * cW, cH)
          }
        })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      driverData.forEach(d => drawLine(ctx, (d.interp as any)[cfg.field], d.colour, W, cfg.height, cfg.yMin, cfg.yMax))
      if (tooltipNx !== null) {
        drawCrosshair(ctx, tooltipNx, W, cfg.height)
        drawDots(ctx, tooltipNx, W, cfg.height, driverData, cfg.field, cfg.yMin, cfg.yMax)
      }
    })

    // Delta chart
    if (deltaRef.current && driverData.length >= 2) {
      const canvas = deltaRef.current
      canvas.width = W; canvas.height = 120
      const ctx = canvas.getContext('2d')!
      const a = driverData[0].interp.speed
      const b = driverData[1].interp.speed
      const n = Math.min(a.length, b.length)
      const deltas = Array.from({ length: n }, (_, i) => a[i] - b[i])
      const maxD = Math.max(...deltas.map(Math.abs), 15)
      const { cW, cH } = chartCoords(W, 120)
      const midY = PAD.top + cH / 2
      ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, 120)
      ctx.beginPath(); ctx.strokeStyle = '#333'; ctx.lineWidth = 1
      ctx.moveTo(PAD.left, midY); ctx.lineTo(PAD.left + cW, midY); ctx.stroke()
      for (const m of [-1, -0.5, 0.5, 1]) {
        const y = PAD.top + cH / 2 - m * cH / 2
        const lv = (m * maxD).toFixed(0)
        ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
        ctx.fillText(lv, PAD.left - 6, y + 3)
        ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
        ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(PAD.left, midY)
      deltas.forEach((d, i) => {
        ctx.lineTo(PAD.left + (i / (n - 1)) * cW, midY - (d / maxD) * (cH / 2))
      })
      ctx.lineTo(PAD.left + cW, midY); ctx.closePath()
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
      grad.addColorStop(0, driverData[0].colour + '44')
      grad.addColorStop(0.5, '#0A0A0A')
      grad.addColorStop(1, driverData[1].colour + '44')
      ctx.fillStyle = grad; ctx.fill()
      ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
      deltas.forEach((d, i) => {
        const cx = PAD.left + (i / (n - 1)) * cW
        const cy = midY - (d / maxD) * (cH / 2)
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy)
      })
      ctx.stroke()
      ctx.fillStyle = driverData[0].colour + 'CC'; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'left'
      ctx.fillText(`▲ ${driverData[0].abbr} faster`, PAD.left + 6, PAD.top + 14)
      ctx.fillStyle = driverData[1].colour + 'CC'
      ctx.fillText(`▼ ${driverData[1].abbr} faster`, PAD.left + 6, PAD.top + cH - 6)
      if (tooltipNx !== null) {
        const cx = PAD.left + tooltipNx * cW
        const idx = Math.round(tooltipNx * (n - 1))
        const d = deltas[idx] ?? 0
        const cy = midY - (d / maxD) * (cH / 2)
        ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
        ctx.moveTo(cx, PAD.top); ctx.lineTo(cx, PAD.top + cH); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2)
        ctx.fillStyle = d >= 0 ? driverData[0].colour : driverData[1].colour
        ctx.fill(); ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5; ctx.stroke()
        const label = `${d >= 0 ? '+' : ''}${d.toFixed(1)} km/h`
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px JetBrains Mono, monospace'
        ctx.textAlign = cx > PAD.left + cW / 2 ? 'right' : 'left'
        ctx.fillText(label, cx + (cx > PAD.left + cW / 2 ? -10 : 10), PAD.top + 22)
      }
    }

    // DRS chart
    if (drsRef.current) {
      const canvas = drsRef.current
      const rowH = 20
      const totalH = driverData.length * (rowH + 6) + PAD.top + PAD.bottom
      canvas.width = W; canvas.height = totalH
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, totalH)
      const { cW } = chartCoords(W, totalH)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      driverData.forEach(({ interp, colour, abbr }, di) => {
        const y = PAD.top + di * (rowH + 6)
        ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
        ctx.fillText(abbr, PAD.left - 6, y + rowH / 2 + 4)
        ctx.fillStyle = '#1A1A1A'
        ctx.beginPath(); ctx.roundRect?.(PAD.left, y, cW, rowH, 3); ctx.fill()
        const n = interp.drs.length
        let inDrs = false, ds = 0
        interp.drs.forEach((v, i) => {
          const open = v > 8
          if (open && !inDrs) { inDrs = true; ds = i }
          if (!open && inDrs) {
            inDrs = false
            const x1 = PAD.left + (ds / (n - 1)) * cW
            const x2 = PAD.left + (i / (n - 1)) * cW
            ctx.fillStyle = GREEN_DRS
            ctx.beginPath(); ctx.roundRect?.(x1, y, x2 - x1, rowH, 2); ctx.fill()
          }
        })
        if (inDrs) {
          const x1 = PAD.left + (ds / (n - 1)) * cW
          ctx.fillStyle = GREEN_DRS
          ctx.beginPath(); ctx.roundRect?.(x1, y, cW - (x1 - PAD.left), rowH, 2); ctx.fill()
        }
        if (tooltipNx !== null) {
          const cx = PAD.left + tooltipNx * cW
          ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
          ctx.moveTo(cx, PAD.top); ctx.lineTo(cx, PAD.top + totalH - PAD.bottom); ctx.stroke()
        }
      })
    }

    // Track map
    if (trackRef.current && driverData[0]?.interp.x.length) {
      const canvas = trackRef.current
      canvas.width = W; canvas.height = 340
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, 340)
      const interp = driverData[0].interp
      const xs = interp.x, ys = interp.y, n = xs.length
      const xMin = Math.min(...xs), xMax = Math.max(...xs)
      const yMin = Math.min(...ys), yMax = Math.max(...ys)
      const mapPad = 48
      const scale = Math.min((W - mapPad * 2) / (xMax - xMin || 1), (340 - mapPad * 2) / (yMax - yMin || 1)) * 0.9
      const offX = (W - (xMax - xMin) * scale) / 2 - xMin * scale
      const offY = (340 - (yMax - yMin) * scale) / 2 - yMin * scale
      const tx = (x: number) => x * scale + offX
      const ty = (y: number) => y * scale + offY
      ctx.beginPath()
      xs.forEach((x, i) => i === 0 ? ctx.moveTo(tx(x), ty(ys[i])) : ctx.lineTo(tx(x), ty(ys[i])))
      ctx.closePath()
      ctx.strokeStyle = '#2A2A2A'; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke()
      const sectColours = ['#E8002D55', '#FFD70055', '#B347FF55']
      sectColours.forEach((col, si) => {
        const s = Math.floor(si * n / 3), e = Math.floor((si + 1) * n / 3)
        ctx.beginPath()
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        for (let i = s; i <= e; i++) i === s ? ctx.moveTo(tx(xs[i]), ty(ys[i])) : ctx.lineTo(tx(xs[i]), ty(ys[i]))
        ctx.strokeStyle = col; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke()
      })
      let inB = false, bs = 0
      interp.brake.forEach((b, i) => {
        if (b && !inB) { inB = true; bs = i }
        if (!b && inB) {
          inB = false
          ctx.beginPath()
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          for (let j = bs; j <= i; j++) j === bs ? ctx.moveTo(tx(xs[j]), ty(ys[j])) : ctx.lineTo(tx(xs[j]), ty(ys[j]))
          ctx.strokeStyle = BRAKE_COLOR; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.stroke()
        }
      })
      let inD = false, ds2 = 0
      interp.drs.forEach((v, i) => {
        if (v > 8 && !inD) { inD = true; ds2 = i }
        if (v <= 8 && inD) {
          inD = false
          ctx.beginPath()
          // eslint-disable-next-line @typescript-eslint/no-unused-expressions
          for (let j = ds2; j <= i; j++) j === ds2 ? ctx.moveTo(tx(xs[j]), ty(ys[j])) : ctx.lineTo(tx(xs[j]), ty(ys[j]))
          ctx.strokeStyle = GREEN_DRS; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke()
        }
      })
      if (tooltipNx !== null) {
        const idx = Math.round(tooltipNx * (n - 1))
        driverData.forEach(({ colour }) => {
          const ix = tx(xs[idx]), iy = ty(ys[idx])
          ctx.beginPath(); ctx.arc(ix, iy, 8, 0, Math.PI * 2)
          ctx.fillStyle = colour
          ctx.shadowColor = colour; ctx.shadowBlur = 16
          ctx.fill(); ctx.shadowBlur = 0
        })
      }
      ctx.beginPath(); ctx.arc(tx(xs[0]), ty(ys[0]), 5, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'; ctx.fill()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverData.map(d => d.abbr).join(','), tooltipNx, telData, sessionType])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cW = rect.width - PAD.left - PAD.right
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / cW))
    setTooltipNx(nx)
    if (!driverData.length) return
    const n = driverData[0].interp.dist.length
    const idx = Math.round(nx * (n - 1))
    setTooltipData({
      dist: driverData[0].interp.dist[idx],
      values: driverData.map(d => ({
        abbr: d.abbr,
        colour: d.colour,
        speed: d.interp.speed[idx] ?? 0,
        throttle: d.interp.throttle[idx] ?? 0,
        gear: d.interp.gear[idx] ?? 0,
        rpm: d.interp.rpm[idx] ?? 0,
        brake: d.interp.brake[idx] ?? false,
      })),
    })
  }, [driverData])

  const handleMouseLeave = useCallback(() => {
    setTooltipNx(null); setTooltipData(null)
  }, [])

  const toggleDriver = (dn: number) => {
    if (!isRaceSession(sessionType) && !isPracticeSession(sessionType) && qualiSegments?.segments && !segmentDriverNumbers.has(dn)) {
      return
    }
    setSelected(prev => prev.includes(dn)
      ? prev.filter(d => d !== dn)
      : prev.length < 4 ? [...prev, dn] : prev)
  }

  // ── Driver list for analysis components ───────────────────────────────────

  const driverList = drivers.map(d => ({
    driver_number: d.driver_number,
    abbreviation: d.abbreviation,
    team_name: d.team_name ?? '',
    team_colour: d.team_colour ?? '666666',
  }))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className="telemetry-stack">

      {/* Header */}
      <section className="panel" style={{ padding: '22px 22px 18px', marginBottom: '6px' }}>
        <div className="eyebrow" style={{ marginBottom: '10px' }}>
          Session Console
        </div>
        <h1 className="page-title">
          {sessionModeLabel(sessionType) || 'Telemetry'}
        </h1>
        <p className="page-subtitle" style={{ marginTop: '8px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>
          {isRaceSession(sessionType)
            ? 'Lap time evolution · position changes · stint pace'
            : isPracticeSession(sessionType)
              ? 'Long run pace · tyre degradation rate'
              : 'Fastest lap telemetry — distance-aligned overlay'}
        </p>
      </section>

      {/* ── Race mode ── */}
      {isRaceSession(sessionType) && (
        <RaceAnalysis sessionKey={sessionKey} drivers={driverList} />
      )}

      {/* ── Practice mode ── */}
      {isPracticeSession(sessionType) && (
        <PracticeAnalysis sessionKey={sessionKey} drivers={driverList} />
      )}

      {/* ── Qualifying mode ── */}
      {!isRaceSession(sessionType) && !isPracticeSession(sessionType) && (
        <>
          <div className="telemetry-top-grid">
            <div className="panel-soft" style={{ padding: '16px' }}>
              {/* Segment selector — Q1 / Q2 / Q3 */}
              {qualiSegments?.segments && (
                <div style={{ marginBottom: '14px' }}>
                  <div className="eyebrow" style={{ marginBottom: '10px' }}>
                    Segment Lens
                  </div>
                  <div className="telemetry-chip-row" style={{ alignItems: 'center' }}>
                    {(['Q1', 'Q2', 'Q3'] as const).map(seg => {
                      const isActive = selectedSegment === seg
                      const segColour = seg === 'Q1' ? '#3671C6' : seg === 'Q2' ? '#FFD700' : '#E8002D'
                      const count = qualiSegments.segments[seg]?.length ?? 0
                      const isDisabled = count === 0
                      return (
                        <button key={seg} disabled={isDisabled} onClick={() => setSelectedSegment(seg)} style={{
                          padding: '8px 16px', borderRadius: '999px',
                          border: isActive ? `1.5px solid ${segColour}` : '1px solid rgba(152, 181, 211, 0.14)',
                          background: isActive ? `${segColour}22` : 'rgba(255,255,255,0.02)',
                          color: isDisabled ? '#3F3F46' : isActive ? '#fff' : '#9fb2c6',
                          fontSize: '13px', fontFamily: 'monospace', fontWeight: isActive ? 700 : 500,
                          transition: 'all 0.15s', opacity: isDisabled ? 0.45 : 1,
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                        }}>
                          {seg}
                          <span style={{ marginLeft: '6px', fontSize: '10px', color: isActive ? segColour : '#5e7289' }}>
                            {count}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: '#5e7289', marginTop: '10px' }}>
                    {selectedSegment === 'Q3' ? 'Top 10 shootout telemetry' : selectedSegment === 'Q2' ? 'Mid-session cutline comparison' : 'Full-field opening benchmark'}
                  </div>
                </div>
              )}

              {/* Driver selector */}
              <div>
                <div className="eyebrow" style={{ marginBottom: '10px' }}>
                  Drivers (max 4)
                </div>
                <div className="telemetry-driver-grid">
                  {drivers.map(d => {
                    const isSel = selected.includes(d.driver_number)
                    const colour = teamColour(d.team_colour, d.team_name)
                    const isUnavailable = !isRaceSession(sessionType) && !isPracticeSession(sessionType) && qualiSegments?.segments
                      ? !segmentDriverNumbers.has(d.driver_number)
                      : false
                    const segmentLap = segmentLapByDriver.get(d.driver_number)
                    return (
                      <button key={d.driver_number} disabled={isUnavailable} onClick={() => toggleDriver(d.driver_number)} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '8px', padding: '10px 12px', borderRadius: '14px',
                        border: isSel ? `1.5px solid ${colour}` : '1px solid rgba(152, 181, 211, 0.12)',
                        background: isSel ? `${colour}18` : 'rgba(255,255,255,0.02)',
                        color: isUnavailable ? '#3F3F46' : isSel ? '#fff' : '#c2d1df',
                        fontSize: '12px', fontWeight: isSel ? 700 : 500,
                        fontFamily: 'monospace', transition: 'all 0.12s',
                        opacity: isUnavailable ? 0.45 : 1,
                        cursor: isUnavailable ? 'not-allowed' : 'pointer',
                      }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isUnavailable ? '#3F3F46' : colour, display: 'inline-block', flexShrink: 0 }} />
                          <span>{d.abbreviation}</span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          {segmentLap ? <span style={{ color: '#9fb2c6', fontSize: '10px' }}>L{segmentLap}</span> : null}
                          {isSel && <span style={{ color: colour, fontSize: '10px' }}>●</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {driverData.length > 0 && (
                  <div className="telemetry-chip-row" style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid rgba(152, 181, 211, 0.1)' }}>
                    {driverData.map(d => (
                      <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '999px', background: 'rgba(255,255,255,0.03)' }}>
                        <div style={{ width: '24px', height: '2px', background: d.colour }} />
                        <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#d8e4ee', fontWeight: 600 }}>
                          {d.abbr}
                          {(() => {
                            const driver = drivers.find(x => x.abbreviation === d.abbr)
                            const lapNumber = driver ? telLapNumbers.get(driver.driver_number) : null
                            return lapNumber ? ` · L${lapNumber}` : ''
                          })()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {segmentEntries.length > 0 && (
              <div className="panel-soft telemetry-summary-grid" style={{ padding: '16px' }}>
              <div style={{ padding: '12px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(152, 181, 211, 0.1)', minWidth: 0 }}>
                <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em', marginBottom: '6px' }}>
                  SEGMENT
                </div>
                <div style={{ fontSize: '18px', color: '#fff', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>
                  {selectedSegment}
                </div>
                <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#71717A', marginTop: '4px' }}>
                  {segmentSummary.label} · {segmentSummary.count} drivers
                </div>
              </div>
              <div style={{ padding: '12px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(152, 181, 211, 0.1)', minWidth: 0 }}>
                <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em', marginBottom: '6px' }}>
                  FASTEST
                </div>
                <div style={{ fontSize: '18px', color: '#fff', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>
                  {segmentSummary.leader?.abbreviation ?? '—'}
                </div>
                <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#71717A', marginTop: '4px' }}>
                  {segmentSummary.leader ? `${formatLapTime(segmentSummary.leader.lap_time_ms)} · L${segmentSummary.leader.lap_number}` : 'No lap'}
                </div>
              </div>
              <div style={{ padding: '12px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(152, 181, 211, 0.1)', minWidth: 0 }}>
                <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em', marginBottom: '6px' }}>
                  CUTOFF
                </div>
                <div style={{ fontSize: '18px', color: '#fff', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>
                  {segmentSummary.cutoff?.abbreviation ?? (selectedSegment === 'Q3' ? 'Pole' : '—')}
                </div>
                <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#71717A', marginTop: '4px' }}>
                  {segmentSummary.cutoff
                    ? `${formatLapTime(segmentSummary.cutoff.lap_time_ms)} · P${segmentSummary.cutoff.position}`
                    : selectedSegment === 'Q3'
                      ? 'Top 10 shootout'
                      : 'Not available'}
                </div>
              </div>
              </div>
            )}
          </div>

          {loading && (
            <div className="panel-soft" style={{ textAlign: 'center', padding: '48px', color: '#5e7289', fontFamily: 'monospace', fontSize: '13px' }}>
              Loading telemetry...
            </div>
          )}

          {!loading && driverData.length > 0 && (
            <>
              {/* Tooltip */}
              {tooltipData && (
                <div className="telemetry-tooltip panel-soft" style={{
                  position: 'fixed', left: 80, top: 80, zIndex: 200, pointerEvents: 'none',
                  padding: '10px 14px',
                }}>
                  <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', marginBottom: '8px' }}>
                    {(tooltipData.dist / 1000).toFixed(2)} km
                  </div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {tooltipData.values.map((v: any) => (
                    <div key={v.abbr} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div style={{ width: '3px', height: '32px', borderRadius: '2px', background: v.colour, flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        <div style={{ fontSize: '10px', color: v.colour, fontFamily: 'monospace', fontWeight: 700 }}>{v.abbr}</div>
                        <div style={{ fontSize: '14px', fontFamily: 'monospace', color: '#fff', fontWeight: 700 }}>{v.speed.toFixed(0)} km/h</div>
                        <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#71717A' }}>
                          G{v.gear} · {v.throttle.toFixed(0)}% thr · {(v.rpm / 1000).toFixed(1)}k
                          {v.brake && <span style={{ color: BRAKE_COLOR, marginLeft: '6px', fontWeight: 700 }}>BRAKE</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Speed / Throttle / Gear / RPM */}
              {CHARTS.map((cfg, i) => (
                <div key={cfg.field} className="panel-soft telemetry-chart-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px 2px' }}>
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>{cfg.label}</span>
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46' }}>{cfg.unit}</span>
                  </div>
                  <canvas
                    ref={el => { chartRefs.current[i] = el }}
                    height={cfg.height}
                    style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                  />
                </div>
              ))}

              {/* Speed Delta */}
              {driverData.length >= 2 && (
                <div className="panel-soft telemetry-chart-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px 2px' }}>
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>SPEED DELTA</span>
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46' }}>
                      {driverData[0].abbr} vs {driverData[1].abbr} · km/h advantage
                    </span>
                  </div>
                  <canvas ref={deltaRef} height={120}
                    style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
                    onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                </div>
              )}

              {/* DRS — hidden for 2026 */}
              {!is2026 && (
                <div className="panel-soft telemetry-chart-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 8px' }}>
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>DRS OPEN</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <div style={{ width: '14px', height: '6px', borderRadius: '2px', background: GREEN_DRS }} />
                      <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>DRS Open zone</span>
                    </div>
                  </div>
                  <div style={{ padding: '0 0 8px 0' }}>
                    <canvas ref={drsRef} height={driverData.length * 26 + 36}
                      style={{ display: 'block', width: '100%' }} />
                  </div>
                </div>
              )}

              {/* Sector Times */}
              {driverData.length >= 2 && (
                <div className="panel-soft" style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>SECTOR TIMES</span>
                    <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>fastest telemetry lap · from timing data</span>
                  </div>
                  {(() => {
                    const SECTOR_KEYS = ['s1_ms', 's2_ms', 's3_ms'] as const
                    const SECTOR_LABELS = ['S1', 'S2', 'S3']
                    const SECTOR_COLOURS = ['#E8002D', '#FFD700', '#B347FF']
                    const hasSectorData = sectorTimes.size > 0
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {SECTOR_KEYS.map((key, si) => {
                          const label = SECTOR_LABELS[si]; const sCol = SECTOR_COLOURS[si]
                          const driverSectors = driverData.map(d => {
                            const dn = drivers.find(x => x.abbreviation === d.abbr)?.driver_number
                            const times = dn !== undefined ? sectorTimes.get(dn) : undefined
                            return { abbr: d.abbr, colour: d.colour, ms: times?.[key] ?? null }
                          })
                          const validMs = driverSectors.map(d => d.ms).filter((v): v is number => v !== null)
                          const fastestMs = validMs.length ? Math.min(...validMs) : null
                          const slowestMs = validMs.length ? Math.max(...validMs) : null
                          const deltaMs = fastestMs !== null && slowestMs !== null ? slowestMs - fastestMs : null
                          return (
                            <div key={si}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                                <div style={{ width: '4px', height: '16px', borderRadius: '2px', background: sCol, flexShrink: 0 }} />
                                <span style={{ fontSize: '10px', fontFamily: 'monospace', fontWeight: 700, color: sCol, letterSpacing: '0.08em' }}>{label}</span>
                                {deltaMs !== null && deltaMs > 0 && (
                                  <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B', marginLeft: 'auto' }}>
                                    Δ {(deltaMs / 1000).toFixed(3)}s
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '14px' }}>
                                {driverSectors.map(({ abbr, colour, ms }) => {
                                  const isFastest = ms !== null && ms === fastestMs
                                  const barPct = ms !== null && fastestMs !== null && slowestMs !== null
                                    ? 60 + ((slowestMs - ms) / ((slowestMs - fastestMs) || 1)) * 40 : 60
                                  return (
                                    <div key={abbr} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ width: '30px', fontSize: '10px', fontFamily: 'monospace', color: isFastest ? '#fff' : '#52525B', flexShrink: 0, fontWeight: isFastest ? 700 : 400 }}>{abbr}</span>
                                      <div style={{ flex: 1, height: '18px', background: '#1A1A1A', borderRadius: '4px', overflow: 'hidden' }}>
                                        {!hasSectorData ? (
                                          <div style={{ width: '40%', height: '100%', borderRadius: '4px', background: 'linear-gradient(90deg, #1A1A1A 25%, #2A2A2A 50%, #1A1A1A 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
                                        ) : (
                                          <div style={{ width: `${barPct}%`, height: '100%', borderRadius: '4px', background: isFastest ? colour : colour + '40', transition: 'width 0.4s ease' }} />
                                        )}
                                      </div>
                                      <span style={{ width: '64px', textAlign: 'right', fontSize: '11px', fontFamily: 'monospace', fontWeight: isFastest ? 700 : 400, color: isFastest ? '#fff' : '#52525B', flexShrink: 0 }}>
                                        {ms !== null ? formatLapTime(ms) : '—'}
                                      </span>
                                      {isFastest && <span style={{ fontSize: '8px', fontFamily: 'monospace', color: sCol, width: '14px', flexShrink: 0 }}>▲</span>}
                                    </div>
                                  )
                                })}
                              </div>
                              {si < 2 && <div style={{ height: '1px', background: '#1A1A1A', marginTop: '10px' }} />}
                            </div>
                          )
                        })}
                        <div style={{ display: 'flex', gap: '16px', paddingTop: '8px', borderTop: '1px solid #1A1A1A', alignItems: 'center' }}>
                          {driverData.map(d => (
                            <div key={d.abbr} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                              <div style={{ width: '12px', height: '4px', borderRadius: '2px', background: d.colour }} />
                              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#71717A' }}>{d.abbr}</span>
                            </div>
                          ))}
                          <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', marginLeft: 'auto' }}>▲ fastest in sector</span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}


              {/* Q1 / Q2 / Q3 Segment Leaderboards */}
              {qualiSegments?.segments && (
                <div className="panel-soft" style={{ padding: '12px 16px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>
                      QUALIFYING SEGMENTS
                    </span>
                    {/* Tab strip */}
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {(['Q1', 'Q2', 'Q3'] as const).map(seg => {
                        const count = qualiSegments.segments[seg]?.length ?? 0
                        const isActive = activeSegment === seg
                        const segColour = seg === 'Q1' ? '#3671C6' : seg === 'Q2' ? '#FFD700' : '#E8002D'
                        return (
                          <button
                            key={seg}
                            onClick={() => setActiveSegment(seg)}
                            style={{
                              padding: '6px 12px', borderRadius: '999px', cursor: 'pointer',
                              border: isActive ? `1.5px solid ${segColour}` : '1.5px solid #2A2A2A',
                              background: isActive ? `${segColour}18` : 'transparent',
                              color: isActive ? '#fff' : '#52525B',
                              fontSize: '11px', fontFamily: 'monospace', fontWeight: isActive ? 700 : 400,
                              transition: 'all 0.12s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {seg}
                            {count > 0 && (
                              <span style={{ marginLeft: '5px', fontSize: '9px', color: isActive ? segColour : '#3F3F46' }}>
                                {count}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Leaderboard */}
                  {(() => {
                    const entries = qualiSegments.segments[activeSegment] ?? []
                    const segColour = activeSegment === 'Q1' ? '#3671C6' : activeSegment === 'Q2' ? '#FFD700' : '#E8002D'
                    const cutLine = activeSegment === 'Q1' ? 15 : activeSegment === 'Q2' ? 10 : null

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', overflowX: 'auto' }}>
                        <div style={{ minWidth: '620px' }}>
                        {/* Column headers */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '28px 36px 1fr 80px 60px 60px 60px',
                          gap: '4px', paddingBottom: '6px',
                          borderBottom: '1px solid #1A1A1A', marginBottom: '4px',
                        }}>
                          {['P', 'DRV', 'TEAM', 'TIME', 'S1', 'S2', 'S3'].map(h => (
                            <span key={h} style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', textAlign: h === 'TIME' || h === 'S1' || h === 'S2' || h === 'S3' ? 'right' : 'left' }}>
                              {h}
                            </span>
                          ))}
                        </div>

                        {entries.map((entry, idx) => {
                          const isFastest = idx === 0
                          const isEliminated = entry.eliminated
                          const showCutLine = cutLine !== null && idx === cutLine - 1

                          const fmtMs = (ms: number | null) => {
                            if (ms === null) return '—'
                            const s = ms / 1000
                            const mins = Math.floor(s / 60)
                            const secs = (s % 60).toFixed(3).padStart(6, '0')
                            return mins > 0 ? `${mins}:${secs}` : `${secs}`
                          }

                          const fmtGap = (ms: number) => {
                            if (ms === 0) return ''
                            return `+${(ms / 1000).toFixed(3)}`
                          }

                          return (
                            <div key={entry.driver_number}>
                              {/* Cut line separator */}
                              {showCutLine && (
                                <div style={{
                                  height: '1px', background: '#E8002D33',
                                  margin: '4px 0', position: 'relative',
                                }}>
                                  <span style={{
                                    position: 'absolute', right: 0, top: '-8px',
                                    fontSize: '8px', fontFamily: 'monospace', color: '#E8002D66',
                                  }}>
                                    ELIMINATION LINE
                                  </span>
                                </div>
                              )}
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: '28px 36px 1fr 80px 60px 60px 60px',
                                gap: '4px', alignItems: 'center',
                                padding: '5px 4px', borderRadius: '6px',
                                background: isFastest ? `${segColour}0A` : 'transparent',
                                opacity: isEliminated ? 0.45 : 1,
                              }}>
                                {/* Position */}
                                <span style={{
                                  fontSize: '11px', fontFamily: 'monospace',
                                  color: isFastest ? segColour : '#52525B',
                                  fontWeight: isFastest ? 700 : 400,
                                }}>
                                  P{entry.position}
                                </span>

                                {/* Driver abbreviation */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <div style={{
                                    width: '3px', height: '14px', borderRadius: '2px',
                                    background: `#${entry.team_colour}`,
                                    flexShrink: 0,
                                  }} />
                                  <span style={{
                                    fontSize: '11px', fontFamily: 'monospace',
                                    color: isFastest ? '#fff' : '#A1A1AA',
                                    fontWeight: isFastest ? 700 : 500,
                                  }}>
                                    {entry.abbreviation}
                                  </span>
                                </div>

                                {/* Team */}
                                <span style={{
                                  fontSize: '10px', fontFamily: 'monospace',
                                  color: '#52525B', overflow: 'hidden',
                                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {entry.team_name}
                                </span>

                                {/* Lap time + gap */}
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{
                                    fontSize: '12px', fontFamily: 'monospace',
                                    color: isFastest ? '#fff' : '#A1A1AA',
                                    fontWeight: isFastest ? 700 : 400,
                                  }}>
                                    {fmtMs(entry.lap_time_ms)}
                                  </div>
                                  {entry.gap_ms > 0 && (
                                    <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>
                                      {fmtGap(entry.gap_ms)}
                                    </div>
                                  )}
                                </div>

                                {/* S1 */}
                                <span style={{
                                  fontSize: '10px', fontFamily: 'monospace',
                                  color: '#52525B', textAlign: 'right',
                                }}>
                                  {entry.s1_ms ? (entry.s1_ms / 1000).toFixed(3) : '—'}
                                </span>

                                {/* S2 */}
                                <span style={{
                                  fontSize: '10px', fontFamily: 'monospace',
                                  color: '#52525B', textAlign: 'right',
                                }}>
                                  {entry.s2_ms ? (entry.s2_ms / 1000).toFixed(3) : '—'}
                                </span>

                                {/* S3 */}
                                <span style={{
                                  fontSize: '10px', fontFamily: 'monospace',
                                  color: '#52525B', textAlign: 'right',
                                }}>
                                  {entry.s3_ms ? (entry.s3_ms / 1000).toFixed(3) : '—'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}


              {/* Track Map */}
              <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 0' }}>
                  <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>TRACK MAP</span>
                  <div style={{ display: 'flex', gap: '14px' }}>
                    {[
                      { col: BRAKE_COLOR, label: 'Braking' },
                      ...(!is2026 ? [{ col: GREEN_DRS, label: 'DRS Zone' }] : []),
                      { col: '#E8002D88', label: 'S1' },
                      { col: '#FFD70088', label: 'S2' },
                      { col: '#B347FF88', label: 'S3' },
                    ].map(({ col, label }) => (
                      <div key={label} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                        <div style={{ width: '14px', height: '4px', borderRadius: '2px', background: col }} />
                        <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <canvas ref={trackRef} height={340}
                  style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
                  onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
              </div>

              <CornerAnalysis
                sessionKey={sessionKey}
                drivers={selected}
                driverMap={Object.fromEntries(
                  drivers.map(d => [d.driver_number, { abbreviation: d.abbreviation, team_colour: d.team_colour }])
                )}
              />
            </>
          )}
        </>
      )}

      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  )
}
