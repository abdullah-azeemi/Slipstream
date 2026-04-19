'use client'

import { use, useEffect, useRef, useState, useCallback } from 'react'
import { api, telemetryApi } from '@/lib/api'
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

// ─────────────────────────────────────────────────────────────────────────────
// Session helpers
// ─────────────────────────────────────────────────────────────────────────────

const isRaceSession = (t: string | null) => t === 'R'
const isPracticeSession = (t: string | null) => t === 'FP1' || t === 'FP2' || t === 'FP3'

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry fetch
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTelemetryCompare(
  sessionKey: number,
  drivers: number[],
  laps?: string,
): Promise<{ samples: TelemetrySample[]; lapNumbers: Map<number, number> }> {
  const query = laps ? `&laps=${laps}` : ''
  const res = await fetch(
    `${BASE}/api/v1/sessions/${sessionKey}/telemetry/compare?drivers=${drivers.join(',')}${query}`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg: '#F0F2F7',   // soft cool-gray page bg
  surface: '#FFFFFF',   // panel surface — clean white
  surfaceHi: '#F7F8FC',   // slightly elevated surface
  border: '#E4E8F0',   // subtle panel borders
  borderMid: '#D0D6E4',   // stronger borders / axis lines
  textDim: '#C0C8D8',   // very muted — grid labels
  textMid: '#8A96AC',   // secondary labels
  textSub: '#5A6478',   // supporting text
  textPrime: '#2E3A50',   // body values
  textBright: '#111827',   // headings / primary labels
  red: '#E8002D',
  gold: '#D4A000',
  purple: '#8B36CC',
  green: '#0A9B5E',
  brake: '#E8002D',
  crosshair: 'rgba(30,40,70,0.12)',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Interpolation
// ─────────────────────────────────────────────────────────────────────────────

type Interp = {
  dist: number[]; speed: number[]; throttle: number[]
  gear: number[]; rpm: number[]; brake: boolean[]; drs: number[]
  x: number[]; y: number[]
}

function interpolateSamples(samples: TelemetrySample[], points = 500): Interp {
  const empty: Interp = { dist: [], speed: [], throttle: [], gear: [], rpm: [], brake: [], drs: [], x: [], y: [] }
  if (!samples.length) return empty

  const sorted = [...samples]
    .filter(s => s.distance_m != null)
    .sort((a, b) => a.distance_m! - b.distance_m!)
  if (!sorted.length) return empty

  const minD = sorted[0].distance_m!
  const maxD = sorted[sorted.length - 1].distance_m!
  const step = (maxD - minD) / (points - 1)
  const dist = Array.from({ length: points }, (_, i) => minD + i * step)

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

// ─────────────────────────────────────────────────────────────────────────────
// Canvas drawing utilities
// ─────────────────────────────────────────────────────────────────────────────

const PAD = { top: 12, right: 16, bottom: 28, left: 52 }

function chartCoords(W: number, H: number) {
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  return { cW, cH }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  yMin: number, yMax: number,
  gridCount: number,
  isRpm: boolean,
) {
  const { cW, cH } = chartCoords(W, H)
  ctx.clearRect(0, 0, W, H)

  // White panel background
  ctx.fillStyle = C.surface
  ctx.fillRect(0, 0, W, H)

  // Horizontal grid lines
  for (let i = 0; i <= gridCount; i++) {
    const y = PAD.top + cH - (i / gridCount) * cH
    ctx.beginPath()
    ctx.strokeStyle = i === 0 ? C.borderMid : C.border
    ctx.lineWidth = 1
    ctx.moveTo(PAD.left, y)
    ctx.lineTo(PAD.left + cW, y)
    ctx.stroke()

    const val = yMin + (i / gridCount) * (yMax - yMin)
    ctx.fillStyle = C.textMid
    ctx.font = '500 9px "JetBrains Mono", monospace'
    ctx.textAlign = 'right'
    ctx.fillText(
      isRpm ? `${(val / 1000).toFixed(0)}k` : Math.round(val).toString(),
      PAD.left - 8,
      y + 3.5,
    )
  }

  // Left axis bar
  ctx.beginPath()
  ctx.strokeStyle = C.borderMid
  ctx.lineWidth = 1
  ctx.moveTo(PAD.left, PAD.top)
  ctx.lineTo(PAD.left, PAD.top + cH)
  ctx.stroke()

  // Distance markers
  ctx.fillStyle = C.textDim
  ctx.font = '500 8px "JetBrains Mono", monospace'
  ctx.textAlign = 'center'
  for (let i = 0; i <= 4; i++) {
    const nx = i / 4
    const x = PAD.left + nx * cW
    ctx.fillText(`${(nx * 100).toFixed(0)}%`, x, PAD.top + cH + 19)

    // Tick
    ctx.beginPath()
    ctx.strokeStyle = C.border
    ctx.lineWidth = 1
    ctx.moveTo(x, PAD.top + cH)
    ctx.lineTo(x, PAD.top + cH + 4)
    ctx.stroke()
  }
}

type DriverRenderData = { interp: Interp; colour: string; abbr: string }

/**
 * Draws the filled area BETWEEN two driver speed traces.
 * Where driver A is faster → fill with A's colour.
 * Where driver B is faster → fill with B's colour.
 * This makes advantage/disadvantage immediately obvious at a glance.
 */
function drawSpeedGapFill(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  driverData: DriverRenderData[],
  yMin: number, yMax: number,
) {
  if (driverData.length < 2) return
  const { cW, cH } = chartCoords(W, H)
  const sA = driverData[0].interp.speed
  const sB = driverData[1].interp.speed
  const n = Math.min(sA.length, sB.length)

  const toX = (i: number) => PAD.left + (i / (n - 1)) * cW
  const toY = (v: number) => PAD.top + cH - ((v - yMin) / (yMax - yMin)) * cH

  // We walk through the series and whenever the "winner" flips we close
  // the current segment and start a new one — this gives exact crossings.
  let segStart = 0

  const flushSegment = (end: number, aWins: boolean) => {
    if (end <= segStart) return
    const driver = aWins ? driverData[0] : driverData[1]
    const other = aWins ? driverData[1] : driverData[0]
    const top = aWins ? sA : sB
    const bottom = aWins ? sB : sA

    ctx.beginPath()
    // Forward along winner (top of gap)
    for (let i = segStart; i <= end; i++) ctx.lineTo(toX(i), toY(top[i]))
    // Backward along loser (bottom of gap)
    for (let i = end; i >= segStart; i--) ctx.lineTo(toX(i), toY(bottom[i]))
    ctx.closePath()

    // Gradient: soft tinted fill, not too heavy on light bg
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
    grad.addColorStop(0, driver.colour + '40')
    grad.addColorStop(0.5, driver.colour + '1A')
    grad.addColorStop(1, other.colour + '08')
    ctx.fillStyle = grad
    ctx.fill()
  }

  let aWinsPrev = sA[0] >= sB[0]

  for (let i = 1; i < n; i++) {
    const aWins = sA[i] >= sB[i]

    if (aWins !== aWinsPrev) {
      // Interpolate the exact crossing point and add it as a boundary
      const t = (sA[i - 1] - sB[i - 1]) / ((sB[i] - sA[i]) + (sA[i - 1] - sB[i - 1]) || 1)
      const xi = i - 1 + t
      // Flush up to crossing
      flushSegment(i - 1, aWinsPrev)
      segStart = i - 1   // new segment starts just before crossover
      aWinsPrev = aWins
    }
  }
  flushSegment(n - 1, aWinsPrev)
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  vals: number[],
  colour: string,
  W: number, H: number,
  yMin: number, yMax: number,
  lw = 1.5,
  glow = false,
  dashed = false,
) {
  const { cW, cH } = chartCoords(W, H)

  if (glow) {
    ctx.save()
    ctx.shadowColor = colour
    ctx.shadowBlur = 4
  }

  if (dashed) ctx.setLineDash([5, 4])

  ctx.beginPath()
  ctx.strokeStyle = colour
  ctx.lineWidth = lw
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  vals.forEach((v, i) => {
    const nx = i / (vals.length - 1)
    const ny = (v - yMin) / (yMax - yMin)
    const cx = PAD.left + nx * cW
    const cy = PAD.top + cH - ny * cH
    i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy)
  })
  ctx.stroke()

  if (dashed) ctx.setLineDash([])
  if (glow) ctx.restore()
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  nx: number, W: number, H: number,
) {
  const { cW, cH } = chartCoords(W, H)
  const cx = PAD.left + nx * cW
  ctx.beginPath()
  ctx.strokeStyle = C.crosshair
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.moveTo(cx, PAD.top)
  ctx.lineTo(cx, PAD.top + cH)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawDots(
  ctx: CanvasRenderingContext2D,
  nx: number, W: number, H: number,
  driverData: DriverRenderData[],
  field: string,
  yMin: number, yMax: number,
) {
  const { cW, cH } = chartCoords(W, H)
  const cx = PAD.left + nx * cW

  driverData.forEach(({ interp, colour }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vals = (interp as any)[field] as number[]
    const idx = Math.round(nx * (vals.length - 1))
    const v = vals[idx] ?? 0
    const ny = (v - yMin) / (yMax - yMin)
    const cy = PAD.top + cH - ny * cH

    ctx.save()
    ctx.shadowColor = colour
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = colour
    ctx.fill()
    ctx.restore()

    ctx.beginPath()
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2)
    ctx.strokeStyle = C.bg
    ctx.lineWidth = 1.5
    ctx.stroke()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart configs
// ─────────────────────────────────────────────────────────────────────────────

const CHARTS = [
  { label: 'SPEED', unit: 'km/h', field: 'speed', yMin: 60, yMax: 360, height: 360, gridCount: 6, isRpm: false },
  { label: 'PEDAL', unit: '%', field: 'throttle', yMin: 0, yMax: 100, height: 180, gridCount: 4, isRpm: false },
  { label: 'GEAR', unit: '1–8', field: 'gear', yMin: 1, yMax: 8, height: 72, gridCount: 4, isRpm: false },
  { label: 'RPM', unit: 'rpm', field: 'rpm', yMin: 4000, yMax: 13000, height: 96, gridCount: 5, isRpm: true },
]

type DriverSectorTimes = {
  s1_ms: number | null
  s2_ms: number | null
  s3_ms: number | null
  lap_number: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ChartPanel({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px 10px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 11, fontFamily: '"Barlow Condensed", sans-serif', fontWeight: 700, letterSpacing: '0.12em', color: C.textBright, textTransform: 'uppercase' }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace', color: C.textDim, letterSpacing: '0.1em' }}>
              {subtitle}
            </span>
          )}
        </div>
        {badge}
      </div>
      {children}
    </div>
  )
}

function StatBadge({ label, value, unit, colour }: { label: string; value: string | number; unit?: string; colour?: string }) {
  return (
    <div style={{
      padding: '8px 12px',
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: 6,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 8, fontFamily: '"JetBrains Mono", monospace', color: C.textDim, letterSpacing: '0.14em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 20, fontFamily: '"Barlow Condensed", sans-serif', fontWeight: 700, color: colour ?? C.textBright, lineHeight: 1 }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace', color: C.textMid }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────────────────────

export default function TelemetryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const sessionKey = parseInt(key)

  // ── State ────────────────────────────────────────────────────────────────

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [telData, setTelData] = useState<Map<number, Interp>>(new Map())
  const [tooltipNx, setTooltipNx] = useState<number | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tooltipData, setTooltipData] = useState<{ dist: number; values: any[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sessionType, setSessionType] = useState<string | null>(null)
  const [sectorTimes, setSectorTimes] = useState<Map<number, DriverSectorTimes>>(new Map())
  const [telLapNumbers, setTelLapNumbers] = useState<Map<number, number>>(new Map())
  const [qualiSegments, setQualiSegments] = useState<QualiSegmentsData | null>(null)
  const [telStats, setTelStats] = useState<import('@/types/f1').DriverTelemetryStats[]>([])
  const [activeSegment, setActiveSegment] = useState<'Q1' | 'Q2' | 'Q3'>('Q1')
  const [selectedSegment, setSelectedSegment] = useState<'Q1' | 'Q2' | 'Q3'>('Q3')

  // ── Refs ─────────────────────────────────────────────────────────────────

  const chartRefs = useRef<(HTMLCanvasElement | null)[]>([null, null, null, null])
  const deltaRef = useRef<HTMLCanvasElement | null>(null)
  const drsRef = useRef<HTMLCanvasElement | null>(null)
  const trackRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // ── Derived ───────────────────────────────────────────────────────────────

  const segmentEntries = getSegmentEntries(qualiSegments, selectedSegment)
  const segmentDriverNumbers = getSegmentDriverNumbers(segmentEntries)
  const segmentLapByDriver = getSegmentLapByDriver(segmentEntries)
  const segmentDriverKey = segmentEntries.map(e => e.driver_number).join(',')
  const segmentSummary = getSegmentSummary(selectedSegment, segmentEntries)
  const isQualifying = !isRaceSession(sessionType) && !isPracticeSession(sessionType)

  // ── Data loading ──────────────────────────────────────────────────────────

  // Session metadata + drivers
  useEffect(() => {
    api.sessions.get(sessionKey)
      .then(s => setSessionType(s.session_type ?? null))
      .catch(() => { })

    api.drivers.list(sessionKey).then(d => {
      setDrivers(d)
      if (d.length >= 2) setSelected([d[0].driver_number, d[1].driver_number])
    })
  }, [sessionKey])

  // Reconcile driver selection for qualifying segments
  useEffect(() => {
    if (!sessionType || !isQualifying || !qualiSegments?.segments) return
    setSelected(prev => {
      const next = reconcileSelectedDrivers(prev, drivers, segmentDriverNumbers)
      return next.length === prev.length && next.every((dn, i) => dn === prev[i]) ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, qualiSegments, selectedSegment, sessionType, segmentDriverKey])

  // Telemetry data (qualifying only)
  useEffect(() => {
    if (!selected.length || !sessionType || !isQualifying) return

    const buildLapsParam = () => {
      if (!qualiSegments?.segments) return undefined
      const entries = qualiSegments.segments[selectedSegment]
      if (!entries?.length) return undefined
      const pairs = selected
        .map(dn => {
          const e = entries.find(x => x.driver_number === dn)
          return e ? `${dn}:${e.lap_number}` : null
        })
        .filter(Boolean)
      return pairs.length ? pairs.join(',') : undefined
    }

    setLoading(true)
    fetchTelemetryCompare(sessionKey, selected, buildLapsParam())
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

  // Sector times
  useEffect(() => {
    if (!selected.length || !telLapNumbers.size) return
    Promise.all(
      selected.map(async dn => {
        try {
          const laps = await api.laps.list(sessionKey, dn)
          const telLap = telLapNumbers.get(dn)
          const matched = laps.find(l => l.lap_number === telLap)
            ?? laps.reduce((best, l) =>
              (l.lap_time_ms ?? Infinity) < (best.lap_time_ms ?? Infinity) ? l : best, laps[0])
          if (!matched) return null
          return {
            driverNum: dn,
            times: {
              s1_ms: matched.s1_ms ?? null,
              s2_ms: matched.s2_ms ?? null,
              s3_ms: matched.s3_ms ?? null,
              lap_number: matched.lap_number,
            } as DriverSectorTimes,
          }
        } catch { return null }
      }),
    ).then(results => {
      const map = new Map<number, DriverSectorTimes>()
      results.forEach(r => { if (r) map.set(r.driverNum, r.times) })
      setSectorTimes(map)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, selected.join(','), telLapNumbers])

  // Qualifying segment leaderboards
  useEffect(() => {
    if (!sessionType || !isQualifying) return
    fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/quali-segments`)
      .then(r => r.json())
      .then((data: QualiSegmentsData) => setQualiSegments(data))
      .catch(() => { })
  }, [sessionKey, sessionType, isQualifying])

  // Telemetry stats
  useEffect(() => {
    if (!selected.length) return
    telemetryApi.stats(sessionKey, selected)
      .then(setTelStats)
      .catch(() => { })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, selected.join(',')])

  // ── Derived render data ───────────────────────────────────────────────────

  const driverData: DriverRenderData[] = selected
    .map(dn => {
      const interp = telData.get(dn)
      const d = drivers.find(x => x.driver_number === dn)
      if (!interp || !d) return null
      return { interp, colour: teamColour(d.team_colour, d.team_name), abbr: d.abbreviation }
    })
    .filter(Boolean) as DriverRenderData[]

  // ── Canvas rendering ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!driverData.length || !isQualifying) return

    const W = containerRef.current?.clientWidth ?? 900

    // Main charts
    CHARTS.forEach((cfg, i) => {
      const canvas = chartRefs.current[i]
      if (!canvas) return
      canvas.width = W
      canvas.height = cfg.height
      const ctx = canvas.getContext('2d')!

      drawGrid(ctx, W, cfg.height, cfg.yMin, cfg.yMax, cfg.gridCount, cfg.isRpm)

      if (cfg.field === 'speed') {
        // 1. Gap fill between lines — the key visual
        drawSpeedGapFill(ctx, W, cfg.height, driverData, cfg.yMin, cfg.yMax)
        // 2. Driver lines: first solid, second dashed (like reference image)
        driverData.forEach((d, i) =>
          drawLine(ctx, d.interp.speed, d.colour, W, cfg.height, cfg.yMin, cfg.yMax, 2.2, true, i > 0),
        )
      } else if (cfg.field === 'throttle') {
        driverData.forEach((d, i) => {
          drawLine(ctx, d.interp.throttle, d.colour, W, cfg.height, 0, 100, 1.8, false, i > 0)
          const brakeVals = d.interp.brake.map(b => b ? 100 : 0)
          drawLine(ctx, brakeVals, C.brake, W, cfg.height, 0, 100, 1.5, false, i > 0)
        })
      } else {
        driverData.forEach((d, i) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          drawLine(ctx, (d.interp as any)[cfg.field], d.colour, W, cfg.height, cfg.yMin, cfg.yMax, 1.8, false, i > 0),
        )
      }

      if (tooltipNx !== null) {
        drawCrosshair(ctx, tooltipNx, W, cfg.height)
        drawDots(ctx, tooltipNx, W, cfg.height, driverData, cfg.field, cfg.yMin, cfg.yMax)
      }
    })

    // Delta chart
    if (deltaRef.current && driverData.length >= 2) {
      const canvas = deltaRef.current
      canvas.width = W
      canvas.height = 110
      const ctx = canvas.getContext('2d')!
      const a = driverData[0].interp.speed
      const b = driverData[1].interp.speed
      const n = Math.min(a.length, b.length)
      const deltas = Array.from({ length: n }, (_, i) => a[i] - b[i])
      const maxD = Math.max(...deltas.map(Math.abs), 15)
      const { cW, cH } = chartCoords(W, 110)
      const midY = PAD.top + cH / 2

      // Background
      ctx.fillStyle = C.surface
      ctx.fillRect(0, 0, W, 110)
      ctx.beginPath()
      ctx.strokeStyle = C.borderMid
      ctx.lineWidth = 1
      ctx.moveTo(PAD.left, midY)
      ctx.lineTo(PAD.left + cW, midY)
      ctx.stroke()

      // Y labels
      for (const m of [-1, -0.5, 0, 0.5, 1]) {
        const y = midY - m * cH / 2
        const lv = (m * maxD).toFixed(0)
        ctx.fillStyle = C.textDim
        ctx.font = '500 9px "JetBrains Mono", monospace'
        ctx.textAlign = 'right'
        ctx.fillText(lv, PAD.left - 8, y + 3)
        if (m !== 0) {
          ctx.beginPath()
          ctx.strokeStyle = C.border
          ctx.lineWidth = 1
          ctx.moveTo(PAD.left, y)
          ctx.lineTo(PAD.left + cW, y)
          ctx.stroke()
        }
      }

      // Area fill
      ctx.beginPath()
      ctx.moveTo(PAD.left, midY)
      deltas.forEach((d, i) =>
        ctx.lineTo(PAD.left + (i / (n - 1)) * cW, midY - (d / maxD) * (cH / 2)),
      )
      ctx.lineTo(PAD.left + cW, midY)
      ctx.closePath()

      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
      grad.addColorStop(0, driverData[0].colour + '2A')
      grad.addColorStop(0.5, 'rgba(0,0,0,0)')
      grad.addColorStop(1, driverData[1].colour + '2A')
      ctx.fillStyle = grad
      ctx.fill()

      // Line
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(200,216,240,0.7)'
      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      deltas.forEach((d, i) => {
        const cx = PAD.left + (i / (n - 1)) * cW
        const cy = midY - (d / maxD) * (cH / 2)
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy)
      })
      ctx.stroke()

      // Labels
      ctx.font = '600 8px "JetBrains Mono", monospace'
      ctx.fillStyle = driverData[0].colour + 'BB'
      ctx.textAlign = 'left'
      ctx.fillText(`↑ ${driverData[0].abbr}`, PAD.left + 6, PAD.top + 12)
      ctx.fillStyle = driverData[1].colour + 'BB'
      ctx.fillText(`↓ ${driverData[1].abbr}`, PAD.left + 6, PAD.top + cH - 4)

      if (tooltipNx !== null) {
        const cx = PAD.left + tooltipNx * cW
        const idx = Math.round(tooltipNx * (n - 1))
        const d = deltas[idx] ?? 0
        const cy = midY - (d / maxD) * (cH / 2)

        drawCrosshair(ctx, tooltipNx, W, 110)

        ctx.save()
        ctx.shadowColor = d >= 0 ? driverData[0].colour : driverData[1].colour
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(cx, cy, 4, 0, Math.PI * 2)
        ctx.fillStyle = d >= 0 ? driverData[0].colour : driverData[1].colour
        ctx.fill()
        ctx.restore()

        ctx.fillStyle = C.textBright
        ctx.font = 'bold 10px "JetBrains Mono", monospace'
        ctx.textAlign = cx > PAD.left + cW / 2 ? 'right' : 'left'
        ctx.fillText(`${d >= 0 ? '+' : ''}${d.toFixed(1)}`, cx + (cx > PAD.left + cW / 2 ? -10 : 10), PAD.top + 20)
      }
    }

    // DRS chart
    if (drsRef.current) {
      const canvas = drsRef.current
      const rowH = 18
      const totalH = driverData.length * (rowH + 8) + PAD.top + PAD.bottom
      canvas.width = W
      canvas.height = totalH
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = C.surface
      ctx.fillRect(0, 0, W, totalH)

      const { cW } = chartCoords(W, totalH)

      driverData.forEach(({ interp, colour, abbr }, di) => {
        const y = PAD.top + di * (rowH + 8)

        ctx.fillStyle = C.textMid
        ctx.font = '600 9px "JetBrains Mono", monospace'
        ctx.textAlign = 'right'
        ctx.fillText(abbr, PAD.left - 8, y + rowH / 2 + 3)

        // Track bg
        ctx.fillStyle = C.border
        ctx.beginPath()
        ctx.roundRect?.(PAD.left, y, cW, rowH, 3)
        ctx.fill()

        // DRS segments
        const nn = interp.drs.length
        let inDrs = false, ds = 0

        interp.drs.forEach((v, i) => {
          const open = v > 8
          if (open && !inDrs) { inDrs = true; ds = i }
          if (!open && inDrs) {
            inDrs = false
            const x1 = PAD.left + (ds / (nn - 1)) * cW
            const x2 = PAD.left + (i / (nn - 1)) * cW
            ctx.fillStyle = C.green
            ctx.beginPath()
            ctx.roundRect?.(x1, y, x2 - x1, rowH, 2)
            ctx.fill()
          }
        })

        if (inDrs) {
          const x1 = PAD.left + (ds / (nn - 1)) * cW
          ctx.fillStyle = C.green
          ctx.beginPath()
          ctx.roundRect?.(x1, y, cW - (x1 - PAD.left), rowH, 2)
          ctx.fill()
        }

        if (tooltipNx !== null) drawCrosshair(ctx, tooltipNx, W, totalH)
      })
    }

    // Track map
    if (trackRef.current && driverData[0]?.interp.x.length) {
      const canvas = trackRef.current
      canvas.width = W
      canvas.height = 320
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = C.surface
      ctx.fillRect(0, 0, W, 320)

      const { x: xs, y: ys } = driverData[0].interp
      const n = xs.length
      const xMin = Math.min(...xs), xMax = Math.max(...xs)
      const yMin = Math.min(...ys), yMax = Math.max(...ys)
      const mp = 56
      const scale = Math.min(
        (W - mp * 2) / (xMax - xMin || 1),
        (320 - mp * 2) / (yMax - yMin || 1),
      ) * 0.92
      const offX = (W - (xMax - xMin) * scale) / 2 - xMin * scale
      const offY = (320 - (yMax - yMin) * scale) / 2 - yMin * scale
      const tx = (x: number) => x * scale + offX
      const ty = (y: number) => y * scale + offY

      // Track outline (thick, dark)
      ctx.beginPath()
      xs.forEach((x, i) => i === 0 ? ctx.moveTo(tx(x), ty(ys[i])) : ctx.lineTo(tx(x), ty(ys[i])))
      ctx.closePath()
      ctx.strokeStyle = C.borderMid
      ctx.lineWidth = 20
      ctx.lineJoin = 'round'
      ctx.stroke()

      // Sector coloring
      const sectorColors = [C.red + '60', C.gold + '60', C.purple + '60']
      sectorColors.forEach((col, si) => {
        const s = Math.floor(si * n / 3)
        const e = Math.floor((si + 1) * n / 3)
        ctx.beginPath()
        for (let i = s; i <= e; i++) i === s ? ctx.moveTo(tx(xs[i]), ty(ys[i])) : ctx.lineTo(tx(xs[i]), ty(ys[i]))
        ctx.strokeStyle = col
        ctx.lineWidth = 14
        ctx.lineJoin = 'round'
        ctx.stroke()
      })

      // Center white line
      ctx.beginPath()
      xs.forEach((x, i) => i === 0 ? ctx.moveTo(tx(x), ty(ys[i])) : ctx.lineTo(tx(x), ty(ys[i])))
      ctx.closePath()
      ctx.strokeStyle = 'rgba(200,216,240,0.12)'
      ctx.lineWidth = 2
      ctx.stroke()

      // Start marker
      ctx.beginPath()
      ctx.arc(tx(xs[0]), ty(ys[0]), 7, 0, Math.PI * 2)
      ctx.fillStyle = C.textBright
      ctx.fill()
      ctx.strokeStyle = C.bg
      ctx.lineWidth = 2
      ctx.stroke()

      // Live cursor
      if (tooltipNx !== null) {
        const idx = Math.round(tooltipNx * (n - 1))
        driverData.forEach(({ colour }) => {
          ctx.save()
          ctx.shadowColor = colour
          ctx.shadowBlur = 12
          ctx.beginPath()
          ctx.arc(tx(xs[idx]), ty(ys[idx]), 6, 0, Math.PI * 2)
          ctx.fillStyle = colour
          ctx.fill()
          ctx.restore()
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverData.map(d => d.abbr).join(','), tooltipNx, telData, sessionType])

  // ── Event handlers ────────────────────────────────────────────────────────

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
    setTooltipNx(null)
    setTooltipData(null)
  }, [])

  // ── Sector dominance ──────────────────────────────────────────────────────

  const sectorWinners = (() => {
    if (driverData.length < 2) return []
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
    return [
      [0, 133], [133, 266], [266, 400],
    ].map(([s, e]) => {
      const a = avg(driverData[0].interp.speed.slice(s, e))
      const b = avg(driverData[1].interp.speed.slice(s, e))
      return a > b ? 0 : 1
    })
  })()

  const toggleDriver = (dn: number) => {
    if (isQualifying && qualiSegments?.segments && !segmentDriverNumbers.has(dn)) return
    setSelected(prev =>
      prev.includes(dn)
        ? prev.filter(d => d !== dn)
        : prev.length < 4 ? [...prev, dn] : prev,
    )
  }

  const driverList = drivers.map(d => ({
    driver_number: d.driver_number,
    abbreviation: d.abbreviation,
    team_name: d.team_name ?? '',
    team_colour: d.team_colour ?? '666666',
  }))

  const fmtMs = (ms: number | null) => {
    if (ms === null) return '—'
    const s = ms / 1000
    const mins = Math.floor(s / 60)
    const secs = (s % 60).toFixed(3).padStart(6, '0')
    return mins > 0 ? `${mins}:${secs}` : secs
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

        .tel-root {
          background: ${C.bg};
          min-height: 100vh;
          font-family: 'JetBrains Mono', monospace;
          color: ${C.textPrime};
          padding: 0 0 80px;
        }

        .tel-container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 0 24px;
        }

        /* Header */
        .tel-header {
          padding: 24px 0 20px;
          border-bottom: 1px solid ${C.border};
          margin-bottom: 20px;
        }

        .tel-header-eyebrow {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }

        .tel-header-tag {
          font-size: 9px;
          letter-spacing: 0.18em;
          color: ${C.textDim};
          text-transform: uppercase;
        }

        .tel-header-dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: ${C.border};
        }

        .tel-title {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 28px;
          font-weight: 800;
          color: ${C.textBright};
          letter-spacing: 0.02em;
          text-transform: uppercase;
          line-height: 1;
          margin: 0;
        }

        /* Panel */
        .panel {
          background: ${C.surface};
          border: 1px solid ${C.border};
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }

        /* Driver cards */
        .driver-cards {
          display: flex;
          gap: 24px;
          margin-top: 20px;
          flex-wrap: wrap;
        }

        .driver-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          background: ${C.surface};
          border: 1px solid ${C.border};
          border-radius: 6px;
        }

        .driver-card-bar {
          width: 3px;
          height: 36px;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .driver-card-meta {
          font-size: 8px;
          letter-spacing: 0.14em;
          color: ${C.textDim};
          text-transform: uppercase;
          margin-bottom: 4px;
        }

        .driver-card-speed {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 22px;
          font-weight: 700;
          color: ${C.textBright};
          line-height: 1;
        }

        .driver-card-sectors {
          display: flex;
          gap: 4px;
          margin-top: 6px;
        }

        .sector-pip {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        /* Top grid */
        .tel-top-grid {
          display: grid;
          grid-template-columns: 340px 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }

        @media (max-width: 900px) {
          .tel-top-grid { grid-template-columns: 1fr; }
        }

        /* Panel */
        .panel {
          background: ${C.surface};
          border: 1px solid ${C.border};
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }

        .panel-header {
          padding: 12px 16px;
          border-bottom: 1px solid ${C.border};
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .panel-label {
          font-size: 9px;
          letter-spacing: 0.16em;
          color: ${C.textDim};
          text-transform: uppercase;
          font-weight: 600;
        }

        .panel-body {
          padding: 14px 16px;
        }

        /* Segment chips */
        .seg-chips {
          display: flex;
          gap: 6px;
          margin-bottom: 14px;
        }

        .seg-chip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px 12px;
          border-radius: 4px;
          border: 1px solid transparent;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          letter-spacing: 0.06em;
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .seg-chip:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .seg-count {
          font-size: 9px;
          padding: 1px 5px;
          border-radius: 3px;
        }

        /* Driver pills */
        .driver-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 4px;
          border: 1px solid ${C.border};
          background: ${C.bg};
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 600;
          color: ${C.textSub};
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.12s ease;
          white-space: nowrap;
        }

        .driver-pill:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .driver-pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }

        /* Scrubber bar */
        .scrubber {
          position: sticky;
          top: 12px;
          z-index: 50;
          height: 44px;
          background: ${C.surface};
          border: 1px solid ${C.borderMid};
          border-radius: 6px;
          display: flex;
          align-items: center;
          padding: 0 16px;
          margin-bottom: 12px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        }

        .scrubber-hint {
          font-size: 10px;
          color: ${C.textDim};
          flex: 1;
          text-align: center;
          letter-spacing: 0.08em;
        }

        .scrubber-dist {
          font-size: 10px;
          color: ${C.textMid};
          width: 80px;
          letter-spacing: 0.06em;
        }

        .scrubber-values {
          display: flex;
          flex: 1;
          justify-content: flex-end;
          gap: 28px;
        }

        .scrubber-driver {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .scrubber-abbr {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
        }

        .scrubber-abbr-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }

        .scrubber-stat {
          text-align: right;
          min-width: 44px;
        }

        .scrubber-stat-val {
          font-size: 13px;
          font-weight: 700;
          color: ${C.textBright};
        }

        .scrubber-stat-unit {
          font-size: 8px;
          color: ${C.textDim};
          margin-left: 2px;
        }

        /* Summary stat grid */
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          padding: 14px;
        }

        .summary-stat {
          padding: 10px 12px;
          background: ${C.bg};
          border: 1px solid ${C.border};
          border-radius: 6px;
        }

        .summary-stat-label {
          font-size: 8px;
          letter-spacing: 0.14em;
          color: ${C.textDim};
          margin-bottom: 6px;
          text-transform: uppercase;
        }

        .summary-stat-val {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 20px;
          font-weight: 700;
          color: ${C.textBright};
          line-height: 1;
        }

        .summary-stat-sub {
          font-size: 9px;
          color: ${C.textMid};
          margin-top: 4px;
          letter-spacing: 0.06em;
        }

        /* Chart stacks */
        .chart-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 10px;
        }

        /* Speed traps */
        .speed-traps-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }

        .trap-card {
          padding: 14px;
          background: ${C.bg};
          border: 1px solid ${C.border};
          border-radius: 6px;
        }

        .trap-label {
          font-size: 8px;
          letter-spacing: 0.14em;
          color: ${C.textDim};
          text-transform: uppercase;
          margin-bottom: 12px;
          font-weight: 600;
        }

        .trap-entry {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }

        .trap-bar {
          width: 3px;
          height: 28px;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .trap-val {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 18px;
          font-weight: 700;
          color: ${C.textBright};
          line-height: 1;
        }

        .trap-abbr {
          font-size: 8px;
          color: ${C.textDim};
          letter-spacing: 0.12em;
          margin-top: 3px;
        }

        /* Sector times */
        .sector-row {
          margin-bottom: 20px;
        }

        .sector-row:last-child { margin-bottom: 0; }

        .sector-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }

        .sector-indicator {
          width: 3px;
          height: 14px;
          border-radius: 2px;
        }

        .sector-label {
          font-size: 9px;
          letter-spacing: 0.16em;
          font-weight: 700;
          text-transform: uppercase;
        }

        .sector-delta {
          font-size: 9px;
          color: ${C.textMid};
          margin-left: auto;
        }

        .sector-bar-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 6px;
          padding-left: 13px;
        }

        .sector-abbr-label {
          width: 28px;
          font-size: 9px;
          text-align: right;
          flex-shrink: 0;
          color: ${C.textSub};
        }

        .sector-abbr-label.fastest {
          color: ${C.textBright};
          font-weight: 700;
        }

        .sector-bar-track {
          flex: 1;
          height: 8px;
          background: ${C.border};
          border-radius: 4px;
          overflow: hidden;
        }

        .sector-bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.4s ease;
        }

        .sector-time {
          width: 58px;
          text-align: right;
          font-size: 10px;
          color: ${C.textSub};
          flex-shrink: 0;
        }

        .sector-time.fastest {
          color: ${C.textBright};
          font-weight: 700;
        }

        .sector-star {
          width: 14px;
          font-size: 7px;
          flex-shrink: 0;
        }

        /* Leaderboard */
        .lb-header-row {
          display: grid;
          grid-template-columns: 28px 38px 1fr 84px 58px 58px 58px;
          gap: 4px;
          padding-bottom: 8px;
          border-bottom: 1px solid ${C.border};
          margin-bottom: 6px;
        }

        .lb-header-cell {
          font-size: 8px;
          letter-spacing: 0.14em;
          color: ${C.textDim};
          font-weight: 600;
          text-transform: uppercase;
        }

        .lb-row {
          display: grid;
          grid-template-columns: 28px 38px 1fr 84px 58px 58px 58px;
          gap: 4px;
          align-items: center;
          padding: 6px 6px;
          border-radius: 4px;
          transition: background 0.1s;
        }

        .lb-row:hover {
          background: ${C.border};
        }

        .lb-cut-line {
          height: 1px;
          background: ${C.red};
          opacity: 0.25;
          margin: 6px 0;
          position: relative;
        }

        .lb-cut-label {
          position: absolute;
          right: 0;
          top: -9px;
          font-size: 7px;
          letter-spacing: 0.14em;
          color: ${C.red};
          opacity: 0.7;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }

        /* DRS label row */
        .drs-row-label {
          font-size: 8px;
          letter-spacing: 0.14em;
          color: ${C.textDim};
          text-transform: uppercase;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .drs-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: ${C.green};
          box-shadow: 0 0 6px ${C.green};
        }

        /* Loading */
        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 80px;
          background: ${C.surface};
          border: 1px solid ${C.border};
          border-radius: 8px;
        }

        .loading-bar {
          width: 200px;
          height: 2px;
          background: ${C.border};
          border-radius: 1px;
          overflow: hidden;
        }

        .loading-bar-fill {
          height: 100%;
          width: 60%;
          background: ${C.red};
          border-radius: 1px;
          animation: slide 1.2s ease-in-out infinite;
        }

        @keyframes slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }

        /* Canvas cursor */
        canvas { cursor: crosshair; }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.surface}; }
        ::-webkit-scrollbar-thumb { background: ${C.borderMid}; border-radius: 3px; }
      `}</style>

      <div className="tel-root">
        <div ref={containerRef} className="tel-container">

          {/* ── Header ────────────────────────────────────────────────────── */}
          <header className="tel-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h1 className="tel-title">
                  Telemetry Analysis
                </h1>

                {/* Driver pills row — simple, no broken backend data */}
                {driverData.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                    {driverData.map((d, i) => (
                      <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <div style={{
                          width: i === 0 ? 18 : 0,
                          height: 0,
                          borderTop: i > 0 ? `2px dashed ${d.colour}` : undefined,
                          borderBottom: i === 0 ? `2.5px solid ${d.colour}` : undefined,
                          display: 'inline-block',
                          width: 18,
                        }} />
                        <span style={{
                          fontSize: 12,
                          fontFamily: '"Barlow Condensed", sans-serif',
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          color: C.textPrime,
                        }}>
                          CAR {d.abbr}
                        </span>
                        {/* Sector dominance pips */}
                        <div style={{ display: 'flex', gap: 3 }}>
                          {[0, 1, 2].map(si => (
                            <div key={si} style={{
                              width: 5, height: 5, borderRadius: '50%',
                              background: sectorWinners[si] === i ? d.colour : C.border,
                            }} />
                          ))}
                        </div>
                        {i < driverData.length - 1 && (
                          <span style={{ color: C.textDim, fontSize: 10, marginLeft: 4 }}>vs</span>
                        )}
                      </div>
                    ))}
                    {driverData.length >= 2 && (
                      <span style={{ fontSize: 10, color: C.textMid, fontFamily: '"JetBrains Mono", monospace', marginLeft: 4 }}>
                        {telLapNumbers.size > 0 ? `LAP ${[...telLapNumbers.values()].join(' VS LAP ')}` : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* ── Race mode ─────────────────────────────────────────────────── */}
          {isRaceSession(sessionType) && (
            <RaceAnalysis sessionKey={sessionKey} drivers={driverList} />
          )}

          {/* ── Practice mode ─────────────────────────────────────────────── */}
          {isPracticeSession(sessionType) && (
            <PracticeAnalysis sessionKey={sessionKey} drivers={driverList} />
          )}

          {/* ── Qualifying mode ───────────────────────────────────────────── */}
          {isQualifying && (
            <>
              {/* Controls: segment lens + driver selector */}
              <div className="tel-top-grid">

                {/* Left: segment + driver selector */}
                <div className="panel">
                  <div className="panel-header">
                    <span className="panel-label">Controls</span>
                  </div>
                  <div className="panel-body">
                    {/* Segment chips */}
                    {qualiSegments?.segments && (
                      <div style={{ marginBottom: 16 }}>
                        <div className="panel-label" style={{ marginBottom: 8 }}>Segment Lens</div>
                        <div className="seg-chips">
                          {(['Q1', 'Q2', 'Q3'] as const).map(seg => {
                            const isActive = selectedSegment === seg
                            const count = qualiSegments.segments[seg]?.length ?? 0
                            const isDisabled = count === 0
                            const segColour = seg === 'Q1' ? '#3671C6' : seg === 'Q2' ? C.gold : C.red
                            return (
                              <button
                                key={seg}
                                disabled={isDisabled}
                                onClick={() => setSelectedSegment(seg)}
                                className="seg-chip"
                                style={{
                                  background: isActive ? `${segColour}18` : C.bg,
                                  borderColor: isActive ? `${segColour}60` : C.border,
                                  color: isDisabled ? C.textDim : isActive ? segColour : C.textSub,
                                }}
                              >
                                {seg}
                                {!isDisabled && (
                                  <span
                                    className="seg-count"
                                    style={{
                                      background: isActive ? `${segColour}22` : C.border,
                                      color: isActive ? segColour : C.textMid,
                                    }}
                                  >
                                    {count}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Driver selector */}
                    <div>
                      <div
                        className="panel-label"
                        style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}
                      >
                        Drivers
                        <span style={{
                          padding: '1px 6px',
                          background: C.border,
                          borderRadius: 3,
                          fontSize: 8,
                          color: C.textMid,
                        }}>MAX 4</span>
                      </div>

                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {drivers.map(d => {
                          const isSel = selected.includes(d.driver_number)
                          const colour = teamColour(d.team_colour, d.team_name)
                          const isUnavailable = isQualifying && qualiSegments?.segments
                            ? !segmentDriverNumbers.has(d.driver_number)
                            : false
                          const segLap = segmentLapByDriver.get(d.driver_number)

                          return (
                            <button
                              key={d.driver_number}
                              disabled={isUnavailable}
                              onClick={() => toggleDriver(d.driver_number)}
                              className="driver-pill"
                              style={{
                                background: isSel ? `${colour}15` : C.bg,
                                borderColor: isSel ? `${colour}50` : C.border,
                                color: isSel ? C.textBright : C.textSub,
                                opacity: isUnavailable ? 0.3 : 1,
                                cursor: isUnavailable ? 'not-allowed' : 'pointer',
                              }}
                            >
                              <div
                                className="driver-pill-dot"
                                style={{ background: isUnavailable ? C.textDim : colour }}
                              />
                              {d.abbreviation}
                              {segLap && (
                                <span style={{ fontSize: 8, color: C.textDim, marginLeft: 1 }}>
                                  L{segLap}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>

                      {driverData.length > 0 && (
                        <div
                          style={{
                            marginTop: 12,
                            paddingTop: 10,
                            borderTop: `1px solid ${C.border}`,
                            display: 'flex',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}
                        >
                          {driverData.map(d => (
                            <div
                              key={d.abbr}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 7,
                                padding: '4px 10px',
                                background: `${d.colour}12`,
                                border: `1px solid ${d.colour}30`,
                                borderRadius: 4,
                              }}
                            >
                              <div style={{ width: 14, height: 2, borderRadius: 1, background: d.colour }} />
                              <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace', color: C.textBright, fontWeight: 700 }}>
                                {d.abbr}
                                {(() => {
                                  const driver = drivers.find(x => x.abbreviation === d.abbr)
                                  const lap = driver ? telLapNumbers.get(driver.driver_number) : null
                                  return lap ? ` · L${lap}` : ''
                                })()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: segment summary stats */}
                {segmentEntries.length > 0 && (
                  <div className="panel">
                    <div className="panel-header">
                      <span className="panel-label">Segment Summary · {selectedSegment}</span>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-stat">
                        <div className="summary-stat-label">Segment</div>
                        <div className="summary-stat-val">{selectedSegment}</div>
                        <div className="summary-stat-sub">{segmentSummary.label} · {segmentSummary.count} drivers</div>
                      </div>
                      <div className="summary-stat">
                        <div className="summary-stat-label">Fastest</div>
                        <div className="summary-stat-val" style={{ color: C.green }}>
                          {segmentSummary.leader?.abbreviation ?? '—'}
                        </div>
                        <div className="summary-stat-sub">
                          {segmentSummary.leader
                            ? `${formatLapTime(segmentSummary.leader.lap_time_ms)} · L${segmentSummary.leader.lap_number}`
                            : 'No lap'}
                        </div>
                      </div>
                      <div className="summary-stat">
                        <div className="summary-stat-label">Cutoff</div>
                        <div className="summary-stat-val" style={{ color: C.red }}>
                          {segmentSummary.cutoff?.abbreviation ?? (selectedSegment === 'Q3' ? '—' : '—')}
                        </div>
                        <div className="summary-stat-sub">
                          {segmentSummary.cutoff
                            ? `${formatLapTime(segmentSummary.cutoff.lap_time_ms)} · P${segmentSummary.cutoff.position}`
                            : selectedSegment === 'Q3' ? 'Top 10 shootout' : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Loading state ──────────────────────────────────────────── */}
              {loading && (
                <div className="loading-state">
                  <div className="panel-label">Loading telemetry data</div>
                  <div className="loading-bar">
                    <div className="loading-bar-fill" />
                  </div>
                </div>
              )}

              {/* ── Charts & analysis ──────────────────────────────────────── */}
              {!loading && driverData.length > 0 && (
                <>
                  {/* Scrubber */}
                  <div className="scrubber">
                    {!tooltipData ? (
                      <span className="scrubber-hint">
                        ← Move cursor over charts to inspect telemetry frame →
                      </span>
                    ) : (
                      <>
                        <span className="scrubber-dist">
                          {(tooltipData.dist / 1000).toFixed(3)} km
                        </span>
                        <div className="scrubber-values">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {tooltipData.values.map((v: any) => (
                            <div key={v.abbr} className="scrubber-driver">
                              <div className="scrubber-abbr">
                                <div className="scrubber-abbr-dot" style={{ background: v.colour }} />
                                <span style={{ color: C.textBright }}>{v.abbr}</span>
                              </div>
                              <div className="scrubber-stat">
                                <span className="scrubber-stat-val">{v.speed.toFixed(0)}</span>
                                <span className="scrubber-stat-unit">kph</span>
                              </div>
                              <div className="scrubber-stat">
                                <span className="scrubber-stat-val">G{v.gear}</span>
                              </div>
                              <div className="scrubber-stat">
                                <span
                                  className="scrubber-stat-val"
                                  style={{ color: v.brake ? C.brake : C.textBright }}
                                >
                                  {v.brake ? 'BRK' : `${v.throttle.toFixed(0)}%`}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Chart stack */}
                  <div className="chart-stack">

                    {/* Speed */}
                    <ChartPanel
                      title="Velocity"
                      subtitle="Speed vs Distance"
                      badge={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          {driverData.map((d, i) => (
                            <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {i === 0
                                ? <div style={{ width: 18, height: 2.5, borderRadius: 2, background: d.colour }} />
                                : <div style={{ width: 18, borderTop: `2px dashed ${d.colour}` }} />
                              }
                              <span style={{ fontSize: 10, color: C.textSub, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>
                                {d.abbr}
                              </span>
                            </div>
                          ))}
                        </div>
                      }
                    >
                      <canvas
                        ref={el => { chartRefs.current[0] = el }}
                        height={CHARTS[0].height}
                        style={{ display: 'block', width: '100%' }}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                      />
                    </ChartPanel>

                    {/* Speed Delta */}
                    {driverData.length >= 2 && (
                      <ChartPanel title="Speed Delta" subtitle={`${driverData[0].abbr} vs ${driverData[1].abbr}`}>
                        <canvas
                          ref={deltaRef}
                          height={110}
                          style={{ display: 'block', width: '100%' }}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={handleMouseLeave}
                        />
                      </ChartPanel>
                    )}

                    {/* Pedal & Gear row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: 10 }}>
                      <ChartPanel
                        title="Pedal Application"
                        subtitle="Throttle & Brake Input"
                        badge={
                          <div style={{ display: 'flex', gap: 6 }}>
                            <span style={{ fontSize: 8, padding: '2px 6px', background: C.border, borderRadius: 3, color: C.textMid, letterSpacing: '0.1em' }}>THR</span>
                            <span style={{ fontSize: 8, padding: '2px 6px', background: `${C.brake}18`, border: `1px solid ${C.brake}30`, borderRadius: 3, color: C.brake, letterSpacing: '0.1em' }}>BRK</span>
                          </div>
                        }
                      >
                        <canvas
                          ref={el => { chartRefs.current[1] = el }}
                          height={CHARTS[1].height}
                          style={{ display: 'block', width: '100%' }}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={handleMouseLeave}
                        />
                      </ChartPanel>

                      <ChartPanel title="Gear Selection" subtitle="1 – 8">
                        <canvas
                          ref={el => { chartRefs.current[2] = el }}
                          height={CHARTS[2].height}
                          style={{ display: 'block', width: '100%' }}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={handleMouseLeave}
                        />
                      </ChartPanel>
                    </div>

                    {/* RPM */}
                    <ChartPanel title="Engine RPM" subtitle="4 000 – 13 000">
                      <canvas
                        ref={el => { chartRefs.current[3] = el }}
                        height={CHARTS[3].height}
                        style={{ display: 'block', width: '100%' }}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                      />
                    </ChartPanel>

                    {/* DRS */}
                    <ChartPanel
                      title="DRS Activation"
                      badge={
                        <div className="drs-row-label">
                          <div className="drs-dot" />
                          Open
                        </div>
                      }
                    >
                      <canvas
                        ref={drsRef}
                        height={60}
                        style={{ display: 'block', width: '100%' }}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                      />
                    </ChartPanel>
                  </div>

                  {/* Sector Times */}
                  {driverData.length >= 2 && (
                    <div className="panel" style={{ marginBottom: 10 }}>
                      <div className="panel-header">
                        <span className="panel-label">Sector Times</span>
                        <span style={{ fontSize: 8, color: C.textDim, letterSpacing: '0.1em' }}>
                          From fastest telemetry lap
                        </span>
                      </div>
                      <div style={{ padding: '16px 20px' }}>
                        {(['s1_ms', 's2_ms', 's3_ms'] as const).map((key, si) => {
                          const label = ['S1', 'S2', 'S3'][si]
                          const sCol = [C.red, C.gold, C.purple][si]
                          const hasSectors = sectorTimes.size > 0

                          const driverSectors = driverData.map(d => {
                            const dn = drivers.find(x => x.abbreviation === d.abbr)?.driver_number
                            const times = dn !== undefined ? sectorTimes.get(dn) : undefined
                            return { abbr: d.abbr, colour: d.colour, ms: times?.[key] ?? null }
                          })

                          const valid = driverSectors.map(d => d.ms).filter((v): v is number => v !== null)
                          const fastMs = valid.length ? Math.min(...valid) : null
                          const slowMs = valid.length ? Math.max(...valid) : null
                          const deltaMs = fastMs !== null && slowMs !== null ? slowMs - fastMs : null

                          return (
                            <div key={si} className="sector-row">
                              <div className="sector-header">
                                <div className="sector-indicator" style={{ background: sCol }} />
                                <span className="sector-label" style={{ color: sCol }}>{label}</span>
                                {deltaMs !== null && deltaMs > 0 && (
                                  <span className="sector-delta">Δ {(deltaMs / 1000).toFixed(3)}s</span>
                                )}
                              </div>

                              {driverSectors.map(({ abbr, colour, ms }) => {
                                const isFastest = ms !== null && ms === fastMs
                                const barPct = ms !== null && fastMs !== null && slowMs !== null
                                  ? 55 + ((slowMs - ms) / ((slowMs - fastMs) || 1)) * 45 : 55

                                return (
                                  <div key={abbr} className="sector-bar-row">
                                    <span className={`sector-abbr-label${isFastest ? ' fastest' : ''}`}>{abbr}</span>
                                    <div className="sector-bar-track">
                                      {!hasSectors ? (
                                        <div
                                          className="sector-bar-fill"
                                          style={{
                                            width: '40%',
                                            background: `linear-gradient(90deg, ${C.border} 25%, ${C.borderMid} 50%, ${C.border} 75%)`,
                                            backgroundSize: '200% 100%',
                                            animation: 'slide 1.4s ease infinite',
                                          }}
                                        />
                                      ) : (
                                        <div
                                          className="sector-bar-fill"
                                          style={{
                                            width: `${barPct}%`,
                                            background: isFastest ? colour : `${colour}35`,
                                          }}
                                        />
                                      )}
                                    </div>
                                    <span className={`sector-time${isFastest ? ' fastest' : ''}`}>
                                      {ms !== null ? fmtMs(ms) : '—'}
                                    </span>
                                    <span className="sector-star" style={{ color: sCol }}>
                                      {isFastest ? '▲' : ''}
                                    </span>
                                  </div>
                                )
                              })}

                              {si < 2 && (
                                <div style={{ height: 1, background: C.border, marginTop: 14 }} />
                              )}
                            </div>
                          )
                        })}

                        {/* Legend */}
                        <div
                          style={{
                            display: 'flex',
                            gap: 12,
                            paddingTop: 10,
                            borderTop: `1px solid ${C.border}`,
                            alignItems: 'center',
                          }}
                        >
                          {driverData.map(d => (
                            <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 12, height: 2, borderRadius: 1, background: d.colour }} />
                              <span style={{ fontSize: 8, color: C.textDim, fontFamily: '"JetBrains Mono", monospace' }}>
                                {d.abbr}
                              </span>
                            </div>
                          ))}
                          <span style={{ fontSize: 7, color: C.textDim, marginLeft: 'auto', letterSpacing: '0.1em' }}>
                            ▲ FASTEST SECTOR
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Qualifying Leaderboards */}
                  {qualiSegments?.segments && (
                    <div className="panel" style={{ marginBottom: 10 }}>
                      <div className="panel-header">
                        <span className="panel-label">Qualifying Segments</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {(['Q1', 'Q2', 'Q3'] as const).map(seg => {
                            const count = qualiSegments.segments[seg]?.length ?? 0
                            const isActive = activeSegment === seg
                            const segCol = seg === 'Q1' ? '#3671C6' : seg === 'Q2' ? C.gold : C.red

                            return (
                              <button
                                key={seg}
                                onClick={() => setActiveSegment(seg)}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '4px 10px',
                                  borderRadius: 4,
                                  border: `1px solid ${isActive ? segCol : C.border}`,
                                  background: isActive ? `${segCol}18` : C.bg,
                                  color: isActive ? segCol : C.textMid,
                                  fontSize: 10,
                                  fontFamily: '"JetBrains Mono", monospace',
                                  fontWeight: isActive ? 700 : 500,
                                  cursor: 'pointer',
                                  transition: 'all 0.12s',
                                }}
                              >
                                {seg}
                                {count > 0 && (
                                  <span
                                    style={{
                                      fontSize: 8,
                                      padding: '1px 5px',
                                      borderRadius: 3,
                                      background: isActive ? `${segCol}25` : C.border,
                                      color: isActive ? segCol : C.textDim,
                                    }}
                                  >
                                    {count}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div style={{ padding: '14px 16px', overflowX: 'auto' }}>
                        <div style={{ minWidth: 640 }}>
                          {(() => {
                            const entries = qualiSegments.segments[activeSegment] ?? []
                            const segCol = activeSegment === 'Q1' ? '#3671C6' : activeSegment === 'Q2' ? C.gold : C.red
                            const cutoff = activeSegment === 'Q1' ? 16 : activeSegment === 'Q2' ? 10 : null

                            return (
                              <>
                                <div className="lb-header-row">
                                  {['P', 'DRV', 'TEAM', 'TIME', 'S1', 'S2', 'S3'].map(h => (
                                    <span
                                      key={h}
                                      className="lb-header-cell"
                                      style={{ textAlign: ['TIME', 'S1', 'S2', 'S3'].includes(h) ? 'right' : 'left' }}
                                    >
                                      {h}
                                    </span>
                                  ))}
                                </div>

                                {entries.map((entry, idx) => {
                                  const isFastest = idx === 0
                                  const isEliminated = entry.eliminated
                                  const showCutLine = cutoff !== null && entry.position === cutoff

                                  const fmtGap = (ms: number) =>
                                    ms === 0 ? '' : `+${(ms / 1000).toFixed(3)}`

                                  return (
                                    <div key={entry.driver_number}>
                                      <div
                                        className="lb-row"
                                        style={{
                                          background: isFastest ? `${segCol}0C` : 'transparent',
                                          opacity: isEliminated ? 0.45 : 1,
                                        }}
                                      >
                                        {/* P */}
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontFamily: '"JetBrains Mono", monospace',
                                            color: isFastest ? segCol : C.textMid,
                                            fontWeight: isFastest ? 700 : 500,
                                          }}
                                        >
                                          P{entry.position}
                                        </span>

                                        {/* Driver */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <div
                                            style={{
                                              width: 3,
                                              height: 12,
                                              borderRadius: 2,
                                              background: `#${entry.team_colour}`,
                                              flexShrink: 0,
                                            }}
                                          />
                                          <span
                                            style={{
                                              fontSize: 10,
                                              fontFamily: '"JetBrains Mono", monospace',
                                              color: isFastest ? C.textBright : C.textPrime,
                                              fontWeight: isFastest ? 700 : 500,
                                            }}
                                          >
                                            {entry.abbreviation}
                                          </span>
                                        </div>

                                        {/* Team */}
                                        <span
                                          style={{
                                            fontSize: 9,
                                            fontFamily: '"JetBrains Mono", monospace',
                                            color: C.textMid,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {entry.team_name}
                                        </span>

                                        {/* Time + gap */}
                                        <div style={{ textAlign: 'right' }}>
                                          <div
                                            style={{
                                              fontSize: 11,
                                              fontFamily: '"JetBrains Mono", monospace',
                                              color: isFastest ? C.textBright : C.textPrime,
                                              fontWeight: isFastest ? 700 : 500,
                                            }}
                                          >
                                            {fmtMs(entry.lap_time_ms)}
                                          </div>
                                          {entry.gap_ms > 0 && (
                                            <div
                                              style={{
                                                fontSize: 8,
                                                fontFamily: '"JetBrains Mono", monospace',
                                                color: C.textDim,
                                              }}
                                            >
                                              {fmtGap(entry.gap_ms)}
                                            </div>
                                          )}
                                        </div>

                                        {/* Sectors */}
                                        {(['s1_ms', 's2_ms', 's3_ms'] as const).map(sk => (
                                          <span
                                            key={sk}
                                            style={{
                                              fontSize: 9,
                                              fontFamily: '"JetBrains Mono", monospace',
                                              color: C.textMid,
                                              textAlign: 'right',
                                            }}
                                          >
                                            {entry[sk] ? (entry[sk]! / 1000).toFixed(3) : '—'}
                                          </span>
                                        ))}
                                      </div>

                                      {showCutLine && (
                                        <div className="lb-cut-line">
                                          <span className="lb-cut-label">ELIMINATION ↓</span>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </>
                            )
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Track Map */}
                  <div className="panel" style={{ marginBottom: 10 }}>
                    <div className="panel-header">
                      <span className="panel-label">Circuit Path</span>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        {[
                          { col: C.red, label: 'S1' },
                          { col: C.gold, label: 'S2' },
                          { col: C.purple, label: 'S3' },
                        ].map(({ col, label }) => (
                          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 10, height: 3, borderRadius: 2, background: col }} />
                            <span style={{ fontSize: 8, color: C.textDim, letterSpacing: '0.1em', fontFamily: '"JetBrains Mono", monospace' }}>
                              {label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <canvas
                      ref={trackRef}
                      height={320}
                      style={{ display: 'block', width: '100%' }}
                      onMouseMove={handleMouseMove}
                      onMouseLeave={handleMouseLeave}
                    />
                  </div>

                  {/* Corner Analysis */}
                  <CornerAnalysis
                    sessionKey={sessionKey}
                    drivers={selected}
                    driverMap={Object.fromEntries(
                      drivers.map(d => [d.driver_number, {
                        abbreviation: d.abbreviation,
                        team_colour: d.team_colour,
                      }]),
                    )}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}