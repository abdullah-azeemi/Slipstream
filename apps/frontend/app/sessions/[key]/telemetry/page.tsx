'use client'

import { use, useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft } from '@phosphor-icons/react'
import '@/components/landing/landing.css'
import { geist, geistMono } from '@/components/landing/font'
import { TabList, ToggleGroup } from '@/components/landing/Tabs'
import { api, telemetryApi } from '@/lib/api'
import {
  getSegmentDriverNumbers,
  getSegmentEntries,
  getSegmentLapByDriver,
  getQualifyingAdvancePosition,
  reconcileSelectedDrivers,
  type QualiSegmentsData,
} from '@/lib/telemetry-quali'
import { createHoverClearController } from '@/lib/hover-clear'
import { teamColour, formatLapTime } from '@/lib/utils'
import { authHeaders } from '@/lib/auth-token'
import type { Driver, TelemetrySample } from '@/types/f1'
import PracticeAnalysis from '@/components/analysis/PracticeAnalysis'
import BrakingAnalysis from '@/components/analysis/BrakingAnalysis'
import CornerInsights from '@/components/analysis/CornerInsights'
import QualiSpeedPanel from '@/components/telemetry/QualiSpeedPanel'
import SvgSpeedTrace from '@/components/telemetry/SvgSpeedTrace'
import LapStory, { type LapStoryDriver } from '@/components/telemetry/LapStory'
import dynamic from 'next/dynamic'
import type { InsightsData } from '@/components/analysis/BrakingAnalysis'

const LapTimeDistribution = dynamic(() => import('@/components/analysis/LapTimeDistribution'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 20, border: '1px solid #D9E3EF', borderRadius: 18, background: '#FFFFFF' }}>
      <div style={{ fontSize: 12, color: '#7D8BA2', fontFamily: 'inherit' }}>Loading lap data...</div>
    </div>
  ),
})

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Session helpers ───────────────────────────────────────────────────────────
const isRaceSession = (t: string | null) => t === 'R'
const isPracticeSession = (t: string | null) => t === 'FP1' || t === 'FP2' || t === 'FP3'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#FAFAFA',
  border: '#E5E5E5',
  borderMid: '#D4D4D4',
  textDim: '#737373',
  textMid: '#666666',
  textSub: '#333333',
  textBright: '#0A0A0A',
  red: '#E8002D',
  green: '#10B981',
  purple: '#6E56CF',
  gold: '#F59E0B',
  brake: '#E8002D',
  crosshair: 'rgba(10,10,10,0.12)',
} as const

// ── Telemetry fetch ───────────────────────────────────────────────────────────
async function fetchTelemetryCompare(
  sessionKey: number,
  drivers: number[],
  laps?: string,
  signal?: AbortSignal,
): Promise<{ samples: TelemetrySample[]; lapNumbers: Map<number, number> }> {
  const query = laps ? `&laps=${laps}` : ''
  const res = await fetch(
    `${BASE}/api/v1/sessions/${sessionKey}/telemetry/compare?drivers=${drivers.join(',')}${query}`,
    { signal, headers: authHeaders() },
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
type Interp = {
  dist: number[]; speed: number[]; throttle: number[]
  gear: number[]; rpm: number[]; brake: number[]; drs: number[]
  x: number[]; y: number[]
}

function interpolateSamples(samples: TelemetrySample[], points = 500): Interp {
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

// ── Canvas drawing ────────────────────────────────────────────────────────────
const PAD = { top: 16, right: 20, bottom: 32, left: 56 }

function chartCoords(W: number, H: number) {
  return { cW: W - PAD.left - PAD.right, cH: H - PAD.top - PAD.bottom }
}

function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, yMin: number, yMax: number, gridCount: number, isRpm: boolean, xLabel?: (progress: number) => string) {
  const { cW, cH } = chartCoords(W, H)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = C.surface
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i <= gridCount; i++) {
    const y = PAD.top + cH - (i / gridCount) * cH
    ctx.beginPath(); ctx.strokeStyle = i === 0 ? C.borderMid : C.border; ctx.lineWidth = 1
    ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
    const val = yMin + (i / gridCount) * (yMax - yMin)
    ctx.fillStyle = C.textDim; ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'right'
    ctx.fillText(isRpm ? `${(val / 1000).toFixed(0)}k` : Math.round(val).toString(), PAD.left - 10, y + 4)
  }
  ctx.beginPath(); ctx.strokeStyle = C.borderMid; ctx.lineWidth = 1
  ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + cH); ctx.stroke()
  ctx.fillStyle = C.textDim; ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'center'
  for (let i = 0; i <= 4; i++) {
    const nx = i / 4; const x = PAD.left + nx * (cW)
    ctx.fillText(xLabel ? xLabel(nx) : `${(nx * 100).toFixed(0)}%`, x, PAD.top + cH + 24)
    ctx.beginPath(); ctx.strokeStyle = C.border; ctx.lineWidth = 1.5
    ctx.moveTo(x, PAD.top + cH); ctx.lineTo(x, PAD.top + cH + 6); ctx.stroke()
  }
}

type DriverRenderData = { interp: Interp; colour: string; abbr: string }

function drawSpeedGapFill(ctx: CanvasRenderingContext2D, W: number, H: number, driverData: DriverRenderData[], yMin: number, yMax: number) {
  if (driverData.length < 2) return
  const { cW, cH } = chartCoords(W, H)
  const sA = driverData[0].interp.speed, sB = driverData[1].interp.speed
  const n = Math.min(sA.length, sB.length)
  const toX = (i: number) => PAD.left + (i / (n - 1)) * cW
  const toY = (v: number) => PAD.top + cH - ((v - yMin) / (yMax - yMin)) * cH
  let segStart = 0
  const flushSegment = (end: number, aWins: boolean) => {
    if (end <= segStart) return
    const driver = aWins ? driverData[0] : driverData[1]
    const top = aWins ? sA : sB, bottom = aWins ? sB : sA
    ctx.beginPath()
    for (let i = segStart; i <= end; i++) ctx.lineTo(toX(i), toY(top[i]))
    for (let i = end; i >= segStart; i--) ctx.lineTo(toX(i), toY(bottom[i]))
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
    grad.addColorStop(0, driver.colour + '35')
    grad.addColorStop(1, driver.colour + '08')
    ctx.fillStyle = grad; ctx.fill()
  }
  let aWinsPrev = sA[0] >= sB[0]
  for (let i = 1; i < n; i++) {
    const aWins = sA[i] >= sB[i]
    if (aWins !== aWinsPrev) { flushSegment(i - 1, aWinsPrev); segStart = i - 1; aWinsPrev = aWins }
  }
  flushSegment(n - 1, aWinsPrev)
}

function drawLine(ctx: CanvasRenderingContext2D, vals: number[], colour: string, W: number, H: number, yMin: number, yMax: number, lw = 1.8, dashed = false, smooth = true) {
  const { cW, cH } = chartCoords(W, H)
  if (vals.length < 2) return
  if (dashed) ctx.setLineDash([5, 4])
  ctx.save()
  ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  if (lw >= 2.5) { ctx.shadowColor = colour; ctx.shadowBlur = 2 }
  const points = vals.map((v, i) => {
    const nx = i / (vals.length - 1); const ny = (v - yMin) / (yMax - yMin)
    return [PAD.left + nx * cW, PAD.top + cH - ny * cH] as const
  })
  ctx.moveTo(points[0][0], points[0][1])
  if (smooth && points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const midpointX = (points[i][0] + points[i + 1][0]) / 2
      const midpointY = (points[i][1] + points[i + 1][1]) / 2
      ctx.quadraticCurveTo(points[i][0], points[i][1], midpointX, midpointY)
    }
  }
  ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1])
  ctx.stroke(); if (dashed) ctx.setLineDash([]); ctx.restore()
}

function drawCrosshair(ctx: CanvasRenderingContext2D, nx: number, W: number, H: number) {
  const { cW, cH } = chartCoords(W, H)
  const cx = PAD.left + nx * cW
  ctx.beginPath(); ctx.strokeStyle = C.crosshair; ctx.lineWidth = 1
  ctx.setLineDash([4, 4]); ctx.moveTo(cx, PAD.top); ctx.lineTo(cx, PAD.top + cH); ctx.stroke(); ctx.setLineDash([])
}

function drawDots(ctx: CanvasRenderingContext2D, nx: number, W: number, H: number, driverData: DriverRenderData[], field: string, yMin: number, yMax: number) {
  const { cW, cH } = chartCoords(W, H)
  const cx = PAD.left + nx * cW
  driverData.forEach(({ interp, colour }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vals = (interp as any)[field] as number[]
    const idx = Math.round(nx * (vals.length - 1)); const v = vals[idx] ?? 0
    const ny = (v - yMin) / (yMax - yMin); const cy = PAD.top + cH - ny * cH
    ctx.save(); ctx.shadowColor = colour; ctx.shadowBlur = 6
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill(); ctx.restore()
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.strokeStyle = C.surface; ctx.lineWidth = 1.5; ctx.stroke()
  })
}

const CHARTS = [
  { label: 'SPEED', unit: 'km/h', field: 'speed', yMin: 60, yMax: 360, height: 420, gridCount: 6, isRpm: false },
  { label: 'THROTTLE', unit: '%', field: 'throttle', yMin: 0, yMax: 100, height: 220, gridCount: 4, isRpm: false },
  { label: 'RPM', unit: 'rpm', field: 'rpm', yMin: 6000, yMax: 13000, height: 140, gridCount: 5, isRpm: true },
  { label: 'BRAKE', unit: '', field: 'brake', yMin: 0, yMax: 100, height: 120, gridCount: 2, isRpm: false },
]

type DriverSectorTimes = { s1_ms: number | null; s2_ms: number | null; s3_ms: number | null; lap_number: number }
type TooltipValue = {
  abbr: string
  colour: string
  speed: number
  throttle: number
  gear: number
  rpm: number
  brake: number
}
type TooltipSnapshot = { dist: number; progress: number; verticalProgress: number; speedDelta: number | null; values: TooltipValue[] }
type TabKey = 'pace' | 'driving' | 'inputs' | 'data'

function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'type' in error) {
    const type = String((error as { type?: unknown }).type ?? '').trim()
    return type ? `Request failed while handling ${type}` : fallback
  }
  return fallback
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

function PanelHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '16px', borderBottom: `1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: C.textBright }}>{title}</div>
        {subtitle && <div style={{ fontSize: 14, lineHeight: '20px', color: C.textMid }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

function InlineMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ padding: 24, borderRadius: 16, border: `1px solid ${C.border}`, background: C.surfaceAlt }}>
      <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: C.textBright }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 14, lineHeight: '20px', color: C.textMid }}>{detail}</div>
    </div>
  )
}


// Smooth bezier gap chart ───────────────────────────────────────────────────
function GapToLeaderChart({
  driverData,
  width,
  active,
}: {
  driverData: DriverRenderData[]
  width: number
  active: boolean
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !driverData.length || !active || width <= 0) return
    const W = width
    const H = 228
    canvas.width = W; canvas.height = H

    const ctx = canvas.getContext('2d')!
    const speeds = driverData.map(d => d.interp.speed)
    const n = Math.min(...speeds.map(s => s.length))
    if (n < 2) return

    // Build cumulative times for each driver
    const DIST_M = 5000, segLen = DIST_M / n
    const cumTimes = driverData.map(() => [0])
    for (let i = 1; i < n; i++) {
      driverData.forEach((_, dIdx) => {
        const s = speeds[dIdx][i]
        cumTimes[dIdx].push(cumTimes[dIdx][i - 1] + segLen / Math.max(s / 3.6, 0.1))
      })
    }

    const gaps = driverData.map((_, dIdx) => {
      return cumTimes[dIdx].map((t, i) => {
        const minT = Math.min(...cumTimes.map(ct => ct[i]))
        return t - minT
      })
    })
    const chartSeries = gaps.map((gap, idx) => ({
      idx,
      abbr: driverData[idx].abbr,
      colour: driverData[idx].colour,
      gap,
      finalGap: gap[gap.length - 1] ?? 0,
    })).sort((a, b) => a.finalGap - b.finalGap)

    const maxGap = Math.max(...gaps.flatMap(g => g), 0.1)

    const PL = 44, PR = 20, PT = 14, PB = 28
    const cW = W - PL - PR, cH = H - PT - PB
    const toX = (i: number) => PL + (i / (n - 1)) * cW
    const toY = (v: number) => PT + cH - (v / maxGap) * cH * 0.97

    ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, H)

    // X-axis section labels
    const xLabels = ['S1 START', 'S2', 'S3', 'FINISH']
    xLabels.forEach((lbl, i) => {
      const x = PL + (i / 3) * cW
      ctx.beginPath(); ctx.strokeStyle = C.border; ctx.lineWidth = 1
      ctx.setLineDash([4, 4]); ctx.moveTo(x, PT); ctx.lineTo(x, PT + cH); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = C.textDim; ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = i === xLabels.length - 1 ? 'right' : i === 0 ? 'left' : 'center'
      ctx.fillText(lbl, x + (i === 0 ? 2 : i === 3 ? -2 : 0), PT + cH + 24)
    })

    // Y-axis labels
    const ticks = [0, maxGap / 3, (maxGap * 2) / 3, maxGap]
    ticks.forEach(v => {
      const y = toY(v)
      ctx.fillStyle = C.textDim; ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'right'
      ctx.fillText(v === 0 ? '0.0s' : `+${v.toFixed(1)}s`, PL - 8, y + 4)
      if (v > 0) {
        ctx.beginPath(); ctx.strokeStyle = C.border; ctx.lineWidth = 1
        ctx.moveTo(PL, y); ctx.lineTo(PL + cW, y); ctx.stroke()
      }
    })

    // Fastest baseline
    ctx.beginPath(); ctx.strokeStyle = C.red; ctx.lineWidth = 1.5
    ctx.moveTo(PL, PT + cH); ctx.lineTo(PL + cW, PT + cH); ctx.stroke()

    // Helper: smooth bezier through points
    function drawSmoothLine(driverGaps: number[], colour: string, abbr: string, dIdx: number, isFastest: boolean) {
      const step = Math.max(1, Math.floor(n / 80))
      const pts: [number, number][] = []
      for (let i = 0; i < n; i += step) pts.push([toX(i), toY(driverGaps[i])])
      if (pts.length < 2) return

      // Area fill above fastest line
      ctx.beginPath()
      ctx.moveTo(pts[0][0], PT + cH)
      ctx.lineTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2
        const my = (pts[i][1] + pts[i + 1][1]) / 2
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
      ctx.lineTo(pts[pts.length - 1][0], PT + cH)
      ctx.lineTo(pts[0][0], PT + cH); ctx.closePath()
      const areaGrad = ctx.createLinearGradient(0, PT, 0, PT + cH)
      areaGrad.addColorStop(0, colour + '18'); areaGrad.addColorStop(1, colour + '02')
      ctx.fillStyle = areaGrad; ctx.fill()

      // Smooth line
      const dashed = dIdx % 2 !== 0
      if (dashed) ctx.setLineDash([6, 4])
      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = isFastest ? 4 : (dashed ? 2 : 3.5); ctx.lineJoin = 'round'
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2
        const my = (pts[i][1] + pts[i + 1][1]) / 2
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
      ctx.stroke(); ctx.setLineDash([])

      // End label
      const last = pts[pts.length - 1]
      ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'right'
      ctx.fillStyle = colour; ctx.fillText(abbr, last[0] - 4, last[1] - 6)
      if (isFastest) {
        ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.fillStyle = C.textDim
        ctx.fillText('FASTEST', last[0] - 4, last[1] + 6)
      }
    }

    chartSeries.forEach(series => {
      const isFastest = series.finalGap <= 0.001
      drawSmoothLine(series.gap, series.colour, series.abbr, series.idx, isFastest)
    })
  }, [active, driverData, width])

  return (
    <Panel>
      <PanelHeader
        title="Time Gap"
        subtitle="X = distance · Y = time lost vs fastest selected driver"
        right={
          <div style={{ display: 'flex', gap: 14 }}>
            {driverData.map((d, i) => (
              <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {i % 2 === 0
                  ? <div style={{ width: 16, height: 2.5, borderRadius: 2, background: d.colour }} />
                  : <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke={d.colour} strokeWidth="2" strokeDasharray="4 3" /></svg>
                }
                <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontWeight: 700, color: d.colour }}>{d.abbr}</span>
              </div>
            ))}
            <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', color: C.textDim, alignSelf: 'center' }}>
              0.0s = fastest line
            </span>
          </div>
        }
      />
      <canvas ref={ref} height={228} style={{ display: 'block', width: '100%' }} />
    </Panel>
  )
}

// ── Performance matrix ────────────────────────────────────────────────────────
function PerformanceMatrix({
  driverData,
  sectorTimes,
  drivers,
  telStats,
}: {
  driverData: DriverRenderData[]
  sectorTimes: Map<number, DriverSectorTimes>
  drivers: Driver[]
  telStats: import('@/types/f1').DriverTelemetryStats[]
}) {
  if (driverData.length < 2) return null

  const getDriverSectorMs = (abbr: string, key: 's1_ms' | 's2_ms' | 's3_ms') => {
    const dn = drivers.find(d => d.abbreviation === abbr)?.driver_number
    return dn !== undefined ? (sectorTimes.get(dn)?.[key] ?? null) : null
  }

  const getTopSpeed = (abbr: string) => {
    return telStats.find(s => s.abbreviation === abbr)?.max_speed_kmh ?? null
  }

  const rows = [
    {
      label: 'S1 Best',
      values: driverData.map(d => ({ abbr: d.abbr, colour: d.colour, v: getDriverSectorMs(d.abbr, 's1_ms'), fmt: (v: number) => (v / 1000).toFixed(3) })),
      higherIsBetter: false,
    },
    {
      label: 'S2 Best',
      values: driverData.map(d => ({ abbr: d.abbr, colour: d.colour, v: getDriverSectorMs(d.abbr, 's2_ms'), fmt: (v: number) => (v / 1000).toFixed(3) })),
      higherIsBetter: false,
    },
    {
      label: 'S3 Best',
      values: driverData.map(d => ({ abbr: d.abbr, colour: d.colour, v: getDriverSectorMs(d.abbr, 's3_ms'), fmt: (v: number) => (v / 1000).toFixed(3) })),
      higherIsBetter: false,
    },
    {
      label: 'Top Speed',
      values: driverData.map(d => ({ abbr: d.abbr, colour: d.colour, v: getTopSpeed(d.abbr), fmt: (v: number) => `${v.toFixed(0)} km/h` })),
      higherIsBetter: true,
    },
  ]

  // Theoretical lap
  const theoBest = driverData.map(d => {
    const s1 = getDriverSectorMs(d.abbr, 's1_ms')
    const s2 = getDriverSectorMs(d.abbr, 's2_ms')
    const s3 = getDriverSectorMs(d.abbr, 's3_ms')
    return { abbr: d.abbr, colour: d.colour, ms: (s1 && s2 && s3) ? s1 + s2 + s3 : null }
  })
  const fastestTheo = theoBest.filter(t => t.ms !== null).sort((a, b) => a.ms! - b.ms!)[0]
  const theoDelta = theoBest.length >= 2 && theoBest[0].ms && theoBest[1].ms
    ? Math.abs(theoBest[0].ms - theoBest[1].ms) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 }}>
      {/* Matrix table */}
      <Panel style={{ flex: 1, overflowX: 'auto' }}>
        <PanelHeader title="Performance Matrix" />
        <div style={{ padding: '12px 16px' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: `minmax(100px, 1.2fr) repeat(${driverData.length}, minmax(80px, 1fr))`, gap: 6, paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: C.textDim, fontFamily: 'inherit', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>METRIC</span>
            {driverData.map(d => (
              <span key={d.abbr} style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontWeight: 700, color: d.colour, textAlign: 'right' }}>{d.abbr}</span>
            ))}
          </div>

          {rows.map(row => {
            const valid = row.values.map(v => v.v).filter((v): v is number => v !== null)
            const best = valid.length ? (row.higherIsBetter ? Math.max(...valid) : Math.min(...valid)) : null
            return (
              <div key={row.label} style={{ display: 'grid', gridTemplateColumns: `minmax(100px, 1.2fr) repeat(${driverData.length}, minmax(80px, 1fr))`, gap: 6, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, color: C.textSub, fontFamily: 'inherit', fontWeight: 500 }}>{row.label}</span>
                {row.values.map(({ abbr, v, fmt }) => {
                  const isBest = v !== null && v === best
                  return (
                    <span key={abbr} style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontWeight: isBest ? 700 : 400, color: isBest ? C.textBright : C.textMid, textAlign: 'right' }}>
                      {v !== null ? fmt(v) : '—'}
                    </span>
                  )
                })}
              </div>
            )
          })}

          {/* Theoretical row */}
          <div style={{ display: 'grid', gridTemplateColumns: `minmax(100px, 1.2fr) repeat(${driverData.length}, minmax(80px, 1fr))`, gap: 6, padding: '10px 0' }}>
            <span style={{ fontSize: 12, color: C.textSub, fontFamily: 'inherit', fontWeight: 500 }}>Theoretical</span>
            {theoBest.map(({ abbr, ms }) => {
              const isBest = ms !== null && ms === Math.min(...theoBest.filter(t => t.ms !== null).map(t => t.ms!))
              return (
                <span key={abbr} style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontWeight: isBest ? 700 : 400, color: isBest ? C.textBright : C.textMid, textAlign: 'right' }}>
                  {ms !== null ? formatLapTime(ms) : '—'}
                </span>
              )
            })}
          </div>
        </div>
      </Panel>

      {/* Theoretical hero card */}
      {fastestTheo?.ms && (
        <div style={{
          background: 'linear-gradient(135deg, #1E293B 0%, #162033 55%, #24324A 100%)',
          borderRadius: 18,
          padding: '22px 24px',
          boxShadow: '0 16px 34px rgba(19,35,61,0.16)',
          position: 'relative',
          overflow: 'hidden',
          marginTop: 'auto',
        }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at top right, rgba(255,255,255,0.08), transparent 34%)' }} />
          <div style={{ fontSize: 12, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.45)', fontFamily: 'inherit', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
            THEORETICAL LAP
          </div>
          <div style={{ fontSize: 40, fontFamily: 'inherit', fontWeight: 700, color: '#fff', lineHeight: 1, letterSpacing: '-0.03em' }}>
            {formatLapTime(fastestTheo.ms)}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: fastestTheo.colour }} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}>{fastestTheo.abbr}</span>
            {theoDelta !== null && (
              <span style={{
                marginLeft: 6, padding: '3px 10px',
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 20,
                fontSize: 12, color: 'rgba(255,255,255,0.75)',
                fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              }}>
                Δ −{(theoDelta / 1000).toFixed(3)}s
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Sector hero cards ─────────────────────────────────────────────────────────
function SectorHeroCards({
  driverData,
  sectorTimes,
  drivers,
}: {
  driverData: DriverRenderData[]
  sectorTimes: Map<number, DriverSectorTimes>
  drivers: Driver[]
}) {
  if (!sectorTimes.size || driverData.length < 2) return null

  const SECTORS = [
    { key: 's1_ms' as const, label: 'SECTOR 1', colour: C.red },
    { key: 's2_ms' as const, label: 'SECTOR 2', colour: C.gold },
    { key: 's3_ms' as const, label: 'SECTOR 3', colour: C.purple },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
      {SECTORS.map(({ key, label, colour }) => {
        const values = driverData.map(d => {
          const dn = drivers.find(x => x.abbreviation === d.abbr)?.driver_number
          const ms = dn !== undefined ? (sectorTimes.get(dn)?.[key] ?? null) : null
          return { abbr: d.abbr, colour: d.colour, ms }
        })
        const valid = values.map(v => v.ms).filter((v): v is number => v !== null)
        const fastestMs = valid.length ? Math.min(...valid) : null
        const slowestMs = valid.length ? Math.max(...valid) : null
        const delta = (fastestMs !== null && slowestMs !== null && fastestMs !== slowestMs)
          ? slowestMs - fastestMs : null

        const leader = values.find(v => v.ms === fastestMs)

        return (
          <Panel key={key} style={{ minHeight: 208 }}>
            <div style={{ padding: '18px 18px 16px', height: '100%', display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 8 }}>
                <span style={{ fontSize: 12, fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: colour }}>{label}</span>
                {delta !== null && (
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', color: C.textDim, whiteSpace: 'nowrap' }}>Δ {(delta / 1000).toFixed(3)}s</span>
                )}
              </div>

              {/* Leader big number */}
              {leader && fastestMs !== null && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 30, fontFamily: 'inherit', fontWeight: 700, color: C.textBright, letterSpacing: '-0.03em', lineHeight: 1 }}>
                    {(fastestMs / 1000).toFixed(3)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: leader.colour }} />
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', color: leader.colour, fontWeight: 700 }}>{leader.abbr}</span>
                    <span style={{ fontSize: 12, color: C.textDim, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}>fastest</span>
                  </div>
                </div>
              )}

              {/* Two-sided comparison bars */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
                {values.map(({ abbr, colour: dColour, ms }) => {
                  const isLeader = ms === fastestMs
                  const deltaMs = ms !== null && fastestMs !== null ? ms - fastestMs : null
                  const totalRange = (slowestMs ?? 0) - (fastestMs ?? 0) || 1
                  // Leader bar fills full left; slower fills proportionally
                  const barPct = isLeader ? 100 : ms !== null && fastestMs !== null
                    ? Math.max(10, 100 - ((ms - fastestMs) / totalRange) * 80) : 0

                  return (
                    <div key={abbr}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontWeight: 700, color: dColour }}>{abbr}</span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', color: isLeader ? C.green : C.red, fontWeight: isLeader ? 700 : 400 }}>
                          {isLeader ? '+0.000' : deltaMs !== null ? `+${(deltaMs / 1000).toFixed(3)}` : '—'}
                        </span>
                      </div>
                      <div style={{ height: 8, background: C.border, borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${barPct}%`,
                          background: isLeader ? C.green : dColour,
                          opacity: isLeader ? 1 : 0.5,
                          borderRadius: 999,
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Panel>
        )
      })}
    </div>
  )
}

// ── Decision summary ─────────────────────────────────────────────────────────
// The first viewport should answer the useful question before asking the user
// to interpret a chart: who is ahead, by how much, and where was it won?
function TelemetryDecisionHero({
  sessionName,
  selectedSegment,
  driverData,
  drivers,
  sectorTimes,
  telLapNumbers,
  isMobile,
  sessionType,
}: {
  sessionName: string
  selectedSegment: 'Q1' | 'Q2' | 'Q3'
  driverData: DriverRenderData[]
  drivers: Driver[]
  sectorTimes: Map<number, DriverSectorTimes>
  telLapNumbers: Map<number, number>
  isMobile: boolean
  sessionType: string | null
}) {
  const rows = driverData.map(d => {
    const driver = drivers.find(item => item.abbreviation === d.abbr)
    const sector = driver ? sectorTimes.get(driver.driver_number) : undefined
    const total = sector?.s1_ms != null && sector.s2_ms != null && sector.s3_ms != null
      ? sector.s1_ms + sector.s2_ms + sector.s3_ms
      : null
    return { ...d, driver, sector, total }
  })

  const ranked = [...rows].sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity))
  const leader = ranked[0]
  const challenger = ranked[1]
  const gap = leader?.total != null && challenger?.total != null ? challenger.total - leader.total : null
  const rivalGaps = ranked.slice(1).map(row => ({
    ...row,
    gap: leader?.total != null && row.total != null ? row.total - leader.total : null,
  }))
  const sectors = [
    { key: 's1_ms' as const, label: 'S1', colour: C.red },
    { key: 's2_ms' as const, label: 'S2', colour: C.gold },
    { key: 's3_ms' as const, label: 'S3', colour: C.purple },
  ]
  const sectorDeltas = sectors.map(sector => {
    const values = rows.map(row => ({ abbr: row.abbr, colour: row.colour, ms: row.sector?.[sector.key] ?? null }))
    const valid = values.filter(value => value.ms != null)
    const fastest = valid.length ? Math.min(...valid.map(value => value.ms!)) : null
    const winner = valid.find(value => value.ms === fastest)
    return { ...sector, values, fastest, winner, delta: valid.length > 1 ? Math.max(...valid.map(value => value.ms!)) - fastest! : null }
  })
  const decisive = [...sectorDeltas].sort((a, b) => (b.delta ?? -1) - (a.delta ?? -1))[0]
  const fmtGap = (ms: number | null) => ms == null ? '—' : `+${(ms / 1000).toFixed(3)}s`

  const names = ranked.length > 2
    ? rivalGaps.map((row, index) => <span key={row.abbr}>{index > 0 ? ', ' : ''}{row.abbr} by <strong style={{ color: C.red, whiteSpace: 'nowrap' }}>{fmtGap(row.gap)}</strong></span>)
    : null

  return (
    <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 24, padding: isMobile ? 24 : 32, marginBottom: 24 }}>
      <div style={{ fontSize: 14, lineHeight: '20px', color: C.textMid, fontWeight: 500, marginBottom: 12 }}>
        {sessionName}{isRaceSession(sessionType) ? '' : ` · ${selectedSegment}`}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(260px, 0.72fr)', gap: isMobile ? 24 : 40, alignItems: 'end' }}>
        <div>
          <h2 style={{ fontSize: isMobile ? 30 : 36, lineHeight: isMobile ? '36px' : '40px', fontWeight: 600, color: C.textBright, margin: 0, textWrap: 'balance' }}>
            {ranked.length > 2 ? (
              <>{leader?.abbr ?? '—'} beats {names}</>
            ) : (
              <>{leader?.abbr ?? '—'} beats {challenger?.abbr ?? '—'} by <strong style={{ color: C.red, fontWeight: 600 }}>{fmtGap(gap)}</strong></>
            )}
          </h2>
          <p style={{ maxWidth: 540, margin: '16px 0 0', color: C.textMid, fontSize: 16, lineHeight: '24px' }}>
            {decisive?.winner && decisive.delta != null ? `${decisive.winner.abbr} makes the biggest difference in ${decisive.label}, worth ${(decisive.delta / 1000).toFixed(3)}s. ` : ''}
            Use the speed trace below to see where on track the time appears.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {rows.map(row => (
            <div key={row.abbr} style={{ padding: 12, border: `1px solid ${C.border}`, borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: C.textBright }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: row.colour }} />{row.abbr}
                <span style={{ marginLeft: 'auto', fontSize: 12, lineHeight: '16px', color: C.textDim, fontWeight: 500 }}>Lap {telLapNumbers.get(row.driver?.driver_number ?? -1) ?? '—'}</span>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, lineHeight: '16px', color: C.textMid }}>Sector sum</div>
              <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.textBright }}>{row.total != null ? `${(row.total / 1000).toFixed(3)}s` : '—'}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 16, marginTop: 32 }}>
        {sectorDeltas.map(sector => (
          <div key={sector.label} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, lineHeight: '16px' }}>
            <span style={{ color: sector.colour, fontWeight: 600 }}>{sector.label}</span>
            <div style={{ flex: 1, height: 8, display: 'flex', gap: 2, background: C.surfaceAlt, borderRadius: 4, overflow: 'hidden' }}>
              {sector.values.map(value => <span key={value.abbr} style={{ flex: 1, background: value.ms === sector.fastest ? value.colour : C.border }} />)}
            </div>
            <span style={{ minWidth: 40, textAlign: 'right', color: C.textMid }}>{sector.winner?.abbr ?? '—'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TelemetryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const sessionKey = parseInt(key)

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [isMobile, setIsMobile] = useState(false)
  const [telData, setTelData] = useState<Map<number, Interp>>(new Map())
  const [tooltipNx, setTooltipNx] = useState<number | null>(null)
  const [tooltipData, setTooltipData] = useState<TooltipSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [telemetryError, setTelemetryError] = useState<string | null>(null)
  const [sessionType, setSessionType] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState<string>('')
  const [session, setSession] = useState<import('@/types/f1').Session | null>(null)
  const [sectorTimes, setSectorTimes] = useState<Map<number, DriverSectorTimes>>(new Map())
  const [telLapNumbers, setTelLapNumbers] = useState<Map<number, number>>(new Map())
  const [qualiSegments, setQualiSegments] = useState<QualiSegmentsData | null>(null)
  const [telStats, setTelStats] = useState<import('@/types/f1').DriverTelemetryStats[]>([])
  const [activeSegment, setActiveSegment] = useState<'Q1' | 'Q2' | 'Q3'>('Q1')
  const [selectedSegment, setSelectedSegment] = useState<'Q1' | 'Q2' | 'Q3'>('Q3')
  const [cornerInsights, setCornerInsights] = useState<InsightsData | null>(null)
  const [insightDriverColours, setInsightDriverColours] = useState<Record<string, string>>({})
  const [chartWidth, setChartWidth] = useState(0)
  const [tab, setTab] = useState<TabKey>('pace')

  const chartRefs = useRef<(HTMLCanvasElement | null)[]>([null, null, null, null])
  const deltaRef = useRef<HTMLCanvasElement | null>(null)
  const trackRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartMeasureRef = useRef<HTMLDivElement | null>(null)
  const hoverClearControllerRef = useRef<ReturnType<typeof createHoverClearController> | null>(null)

  const segmentEntries = getSegmentEntries(qualiSegments, selectedSegment)
  const segmentDriverNumbers = getSegmentDriverNumbers(segmentEntries)
  const segmentLapByDriver = getSegmentLapByDriver(segmentEntries)
  const isQualifying = !isRaceSession(sessionType) && !isPracticeSession(sessionType)
  const showTelemetry = isQualifying || isRaceSession(sessionType)
  const selectedKey = selected.join(',')

  // Session + drivers
  useEffect(() => {
    let active = true
    api.sessions.get(sessionKey).then(s => {
      if (!active) return
      setSession(s)
      setSessionType(s.session_type ?? null)
      setSessionName(s.session_name || s.gp_name || 'Session')
    }).catch(() => { })
    api.drivers.list(sessionKey).then(d => {
      if (!active) return
      setDrivers(d)
      if (d.length >= 2) setSelected([d[0].driver_number, d[1].driver_number])
    }).catch(() => { })

    const handleResize = () => setIsMobile(window.innerWidth < 1024)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => {
      active = false
      window.removeEventListener('resize', handleResize)
    }
  }, [sessionKey])

  useEffect(() => {
    const node = chartMeasureRef.current ?? containerRef.current
    if (!node) return

    const updateWidth = () => {
      const measured = Math.max(320, Math.floor(node.clientWidth))
      setChartWidth(prev => prev === measured ? prev : measured)
    }

    updateWidth()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateWidth())
      observer.observe(node)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  // Reconcile selection for qualifying
  useEffect(() => {
    if (!sessionType || !isQualifying || !qualiSegments?.segments) return
    setSelected(prev => {
      const next = reconcileSelectedDrivers(prev, drivers, segmentDriverNumbers)
      return next.length === prev.length && next.every((dn, i) => dn === prev[i]) ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers, qualiSegments, selectedSegment, sessionType])

  // Telemetry fetch
  useEffect(() => {
    if (!selected.length || !sessionType || !showTelemetry) {
      setLoading(false)
      setTelemetryError(null)
      setTelData(new Map())
      setTelLapNumbers(new Map())
      return
    }

    const abort = new AbortController()
    let active = true

    const buildLapsParam = () => {
      if (!qualiSegments?.segments) return undefined
      const entries = qualiSegments.segments[selectedSegment]
      if (!entries?.length) return undefined
      const pairs = selected.map(dn => {
        const e = entries.find(x => x.driver_number === dn)
        return e ? `${dn}:${e.lap_number}` : null
      }).filter(Boolean)
      return pairs.length ? pairs.join(',') : undefined
    }
    setLoading(true)
    setTelemetryError(null)
    setTelData(new Map())
    setTelLapNumbers(new Map())
    setSectorTimes(new Map())
    fetchTelemetryCompare(sessionKey, selected, buildLapsParam(), abort.signal)
      .then(({ samples, lapNumbers }) => {
        if (!active) return
        setTelLapNumbers(lapNumbers)
        const byDriver = new Map<number, TelemetrySample[]>()
        samples.forEach(s => {
          if (s.driver_number != null) {
            if (!byDriver.has(s.driver_number)) byDriver.set(s.driver_number, [])
            byDriver.get(s.driver_number)!.push(s)
          }
        })
        const interped = new Map<number, Interp>()
        byDriver.forEach((rows, dn) => interped.set(dn, interpolateSamples(rows)))
        setTelData(interped)
        if (!interped.size) setTelemetryError('No telemetry samples were returned for the selected comparison.')
      })
      .catch(err => {
        if (!active || abort.signal.aborted) return
        setTelemetryError(getErrorMessage(err, 'Failed to load telemetry comparison'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      abort.abort()
    }
  }, [sessionKey, selected, selectedKey, sessionType, selectedSegment, qualiSegments, showTelemetry])

  // Sector times
  useEffect(() => {
    if (!selected.length || !telLapNumbers.size) {
      setSectorTimes(new Map())
      return
    }
    let active = true
    Promise.all(selected.map(async dn => {
      try {
        const laps = await api.laps.list(sessionKey, dn)
        const telLap = telLapNumbers.get(dn)
        const matched = laps.find(l => l.lap_number === telLap)
          ?? laps.reduce((best, l) => (l.lap_time_ms ?? Infinity) < (best.lap_time_ms ?? Infinity) ? l : best, laps[0])
        if (!matched) return null
        return { driverNum: dn, times: { s1_ms: matched.s1_ms ?? null, s2_ms: matched.s2_ms ?? null, s3_ms: matched.s3_ms ?? null, lap_number: matched.lap_number } as DriverSectorTimes }
      } catch { return null }
    })).then(results => {
      if (!active) return
      const map = new Map<number, DriverSectorTimes>()
      results.forEach(r => { if (r) map.set(r.driverNum, r.times) })
      setSectorTimes(map)
    })
    return () => {
      active = false
    }
  }, [sessionKey, selected, selectedKey, telLapNumbers])

  // Quali segments
  useEffect(() => {
    if (!sessionType || !showTelemetry) {
      setQualiSegments(null)
      return
    }
    const abort = new AbortController()
    let active = true
    fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/quali-segments`, { signal: abort.signal })
      .then(r => {
        if (!r.ok) throw new Error('Failed to load qualifying segments')
        return r.json()
      })
      .then((data: QualiSegmentsData) => {
        if (!active) return
        setQualiSegments(data)
      })
      .catch(() => { })
    return () => {
      active = false
      abort.abort()
    }
  }, [sessionKey, sessionType, showTelemetry])

  // Tel stats
  useEffect(() => {
    if (!selected.length) {
      setTelStats([])
      return
    }
    let active = true
    telemetryApi.stats(sessionKey, selected).then(stats => {
      if (!active) return
      setTelStats(stats)
    }).catch(() => { })
    return () => {
      active = false
    }
  }, [sessionKey, selected, selectedKey])

  useEffect(() => {
    hoverClearControllerRef.current = createHoverClearController(() => {
      setTooltipNx(null)
      setTooltipData(null)
    })

    return () => {
      hoverClearControllerRef.current?.dispose()
    }
  }, [])

  const driverData: DriverRenderData[] = selected.map(dn => {
    const interp = telData.get(dn)
    const d = drivers.find(x => x.driver_number === dn)
    if (!interp || !d) return null
    return { interp, colour: teamColour(d.team_colour, d.team_name), abbr: d.abbreviation }
  }).filter(Boolean) as DriverRenderData[]
  const usedTraceColours = new Set<string>()
  const comparisonTraceColours = [C.red, '#2563EB', C.green]
  driverData.forEach((driver, index) => {
    const colourKey = driver.colour.toLowerCase()
    if (usedTraceColours.has(colourKey)) {
      const fallback = comparisonTraceColours.find(candidate => !usedTraceColours.has(candidate.toLowerCase()))
      if (fallback) driverData[index] = { ...driver, colour: fallback }
    }
    usedTraceColours.add(driverData[index].colour.toLowerCase())
  })
  const telemetryReady = !loading
    && selected.length > 0
    && selected.every(dn => {
      const interp = telData.get(dn)
      return Boolean(interp && interp.dist.length > 1 && interp.speed.length > 1)
    })
  const hoverActive = Boolean(tooltipData?.values.length)

  const lapStoryDrivers: LapStoryDriver[] = driverData.map(d => {
    const dn = drivers.find(x => x.abbreviation === d.abbr)?.driver_number
    const st = dn !== undefined ? sectorTimes.get(dn) : undefined
    return {
      abbr: d.abbr,
      colour: d.colour,
      speed: d.interp.speed,
      dist: d.interp.dist,
      throttle: d.interp.throttle,
      s1_ms: st?.s1_ms ?? null,
      s2_ms: st?.s2_ms ?? null,
      s3_ms: st?.s3_ms ?? null,
      lapNumber: dn !== undefined ? (telLapNumbers.get(dn) ?? null) : null,
    }
  })

  const comparisonRows = driverData.map(d => {
    const driver = drivers.find(item => item.abbreviation === d.abbr)
    const sectors = driver ? sectorTimes.get(driver.driver_number) : undefined
    const lapMs = sectors?.s1_ms != null && sectors.s2_ms != null && sectors.s3_ms != null
      ? sectors.s1_ms + sectors.s2_ms + sectors.s3_ms
      : null
    const fullThrottle = d.interp.throttle.length
      ? (d.interp.throttle.filter(value => value >= 98).length / d.interp.throttle.length) * 100
      : null
    return {
      ...d,
      driver,
      lapMs,
      minSpeed: d.interp.speed.length ? Math.round(Math.min(...d.interp.speed)) : null,
      maxSpeed: d.interp.speed.length ? Math.round(Math.max(...d.interp.speed)) : null,
      fullThrottle,
    }
  })
  const theoreticalBest = ['s1_ms', 's2_ms', 's3_ms'].reduce((total, key) => {
    const values = comparisonRows.map(row => row.driver ? sectorTimes.get(row.driver.driver_number)?.[key as 's1_ms' | 's2_ms' | 's3_ms'] ?? null : null).filter((value): value is number => value !== null)
    return (total !== null && values.length) ? total + Math.min(...values) : null
  }, 0 as number | null)

  // Canvas render
  useEffect(() => {
    if (!driverData.length || !isQualifying || !chartWidth || !telemetryReady) return
    const raf = window.requestAnimationFrame(() => {
      const W = chartWidth
      const sectorTrackColours = [C.red + '50', C.gold + '50', C.purple + '50']

      CHARTS.forEach((cfg, i) => {
        const canvas = chartRefs.current[i]
        if (!canvas) return
        canvas.width = W
        canvas.height = cfg.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const lapKm = (driverData[0]?.interp.dist.at(-1) ?? 0) / 1000
        drawGrid(ctx, W, cfg.height, cfg.yMin, cfg.yMax, cfg.gridCount, cfg.isRpm, cfg.field === 'speed' ? progress => `${(progress * lapKm).toFixed(1)} km` : undefined)
        if (cfg.field === 'speed') {
          drawSpeedGapFill(ctx, W, cfg.height, driverData, cfg.yMin, cfg.yMax)
          driverData.forEach((d, idx) => drawLine(ctx, d.interp.speed, d.colour, W, cfg.height, cfg.yMin, cfg.yMax, idx === 0 ? 3.8 : 3.2, driverData.length > 2 && idx % 2 !== 0))
        } else if (cfg.field === 'brake') {
          driverData.forEach((d, idx) => {
            drawLine(ctx, d.interp.brake, d.colour, W, cfg.height, 0, 100, 1.8, idx % 2 !== 0, false)
          })
        } else if (cfg.field === 'throttle') {
          driverData.forEach((d, idx) => {
            drawLine(ctx, d.interp.throttle, d.colour, W, cfg.height, 0, 100, 1.8, idx % 2 !== 0)
          })
        } else {
          driverData.forEach((d, idx) => {
            drawLine(ctx, d.interp.rpm, d.colour, W, cfg.height, cfg.yMin, cfg.yMax, 1.8, idx % 2 !== 0)
          })
        }
        if (tooltipNx !== null) {
          drawCrosshair(ctx, tooltipNx, W, cfg.height)
          drawDots(ctx, tooltipNx, W, cfg.height, driverData, cfg.field, cfg.yMin, cfg.yMax)
        }
      })

      if (deltaRef.current && driverData.length >= 2) {
        const H_DELTA = 160
        const canvas = deltaRef.current
        canvas.width = W
        canvas.height = H_DELTA
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const a = driverData[0].interp.speed
        const b = driverData[1].interp.speed
        const n = Math.min(a.length, b.length)
        const deltas = Array.from({ length: n }, (_, i) => a[i] - b[i])
        const maxD = Math.max(...deltas.map(Math.abs), 15)
        const { cW, cH } = chartCoords(W, H_DELTA)
        const midY = PAD.top + cH / 2
        ctx.fillStyle = C.surface
        ctx.fillRect(0, 0, W, H_DELTA)
        ctx.beginPath()
        ctx.strokeStyle = C.borderMid
        ctx.lineWidth = 1
        ctx.moveTo(PAD.left, midY)
        ctx.lineTo(PAD.left + cW, midY)
        ctx.stroke()
        for (const m of [-1, -0.5, 0.5, 1]) {
          const y = midY - m * cH / 2
          ctx.fillStyle = C.textDim
          ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.textAlign = 'right'
          ctx.fillText((m * maxD).toFixed(0), PAD.left - 8, y + 4)
          if (m !== 0) {
            ctx.beginPath()
            ctx.strokeStyle = C.border
            ctx.lineWidth = 1
            ctx.moveTo(PAD.left, y)
            ctx.lineTo(PAD.left + cW, y)
            ctx.stroke()
          }
        }
        ctx.beginPath()
        ctx.moveTo(PAD.left, midY)
        deltas.forEach((d, i) => ctx.lineTo(PAD.left + (i / (n - 1)) * cW, midY - (d / maxD) * (cH / 2)))
        ctx.lineTo(PAD.left + cW, midY)
        ctx.closePath()
        const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
        grad.addColorStop(0, driverData[0].colour + '22')
        grad.addColorStop(0.5, 'rgba(0,0,0,0)')
        grad.addColorStop(1, driverData[1].colour + '22')
        ctx.fillStyle = grad
        ctx.fill()
        drawLine(ctx, deltas, C.borderMid, W, H_DELTA, -maxD, maxD, 1.5)
        if (tooltipNx !== null) {
          const cx = PAD.left + tooltipNx * cW
          const idx = Math.round(tooltipNx * (n - 1))
          const d = deltas[idx] ?? 0
          const cy = midY - (d / maxD) * (cH / 2)
          drawCrosshair(ctx, tooltipNx, W, 96)
          ctx.save()
          ctx.shadowColor = d >= 0 ? driverData[0].colour : driverData[1].colour
          ctx.shadowBlur = 6
          ctx.beginPath()
          ctx.arc(cx, cy, 4, 0, Math.PI * 2)
          ctx.fillStyle = d >= 0 ? driverData[0].colour : driverData[1].colour
          ctx.fill()
          ctx.restore()
          ctx.fillStyle = C.textBright
          ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.textAlign = cx > PAD.left + cW / 2 ? 'right' : 'left'
          ctx.fillText(`${d >= 0 ? '+' : ''}${d.toFixed(1)}`, cx + (cx > PAD.left + cW / 2 ? -10 : 10), PAD.top + 20)
        }
      }

      const trackX = driverData[0]?.interp.x ?? []
      const trackY = driverData[0]?.interp.y ?? []
      const hasTrackShape =
        trackX.length > 1
        && trackY.length === trackX.length
        && trackX.every(Number.isFinite)
        && trackY.every(Number.isFinite)

      if (trackRef.current && hasTrackShape && tab === 'inputs') {
        const canvas = trackRef.current
        canvas.width = W
        canvas.height = 300
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = C.surface
        ctx.fillRect(0, 0, W, 300)
        const xs = trackX
        const ys = trackY
        const n = xs.length
        const xMin = Math.min(...xs)
        const xMax = Math.max(...xs)
        const yMin = Math.min(...ys)
        const yMax = Math.max(...ys)
        const mp = 48
        const scale = Math.min((W - mp * 2) / (xMax - xMin || 1), (300 - mp * 2) / (yMax - yMin || 1)) * 0.92
        const offX = (W - (xMax - xMin) * scale) / 2 - xMin * scale
        const offY = (300 - (yMax - yMin) * scale) / 2 - yMin * scale
        const tx = (x: number) => x * scale + offX
        const ty = (y: number) => y * scale + offY
        ctx.beginPath()
        xs.forEach((x, i) => i === 0 ? ctx.moveTo(tx(x), ty(ys[i])) : ctx.lineTo(tx(x), ty(ys[i])))
        ctx.closePath()
        ctx.strokeStyle = C.borderMid
        ctx.lineWidth = 20
        ctx.lineJoin = 'round'
        ctx.stroke()
        sectorTrackColours.forEach((col, si) => {
          const s = Math.floor(si * n / 3)
          const e = Math.floor((si + 1) * n / 3)
          ctx.beginPath()
          for (let i = s; i <= e; i++) {
            if (i === s) ctx.moveTo(tx(xs[i]), ty(ys[i]))
            else ctx.lineTo(tx(xs[i]), ty(ys[i]))
          }
          ctx.strokeStyle = col
          ctx.lineWidth = 14
          ctx.lineJoin = 'round'
          ctx.stroke()
        })
        ctx.beginPath()
        xs.forEach((x, i) => i === 0 ? ctx.moveTo(tx(x), ty(ys[i])) : ctx.lineTo(tx(x), ty(ys[i])))
        ctx.closePath()
        ctx.strokeStyle = 'rgba(148,163,184,0.15)'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(tx(xs[0]), ty(ys[0]), 7, 0, Math.PI * 2)
        ctx.fillStyle = C.textBright
        ctx.fill()
        ctx.strokeStyle = C.surface
        ctx.lineWidth = 2
        ctx.stroke()
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
    })

    return () => window.cancelAnimationFrame(raf)
  }, [chartWidth, driverData, isQualifying, tab, telemetryReady, tooltipNx])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!telemetryReady || !driverData.length) return
    hoverClearControllerRef.current?.cancel()
    const rect = e.currentTarget.getBoundingClientRect()
    const cW = rect.width - PAD.left - PAD.right
    if (cW <= 0) return
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / cW))
    setTooltipNx(nx)
    const n = driverData[0].interp.dist.length
    const idx = Math.round(nx * (n - 1))
    const firstSpeed = driverData[0]?.interp.speed[idx]
    const secondSpeed = driverData[1]?.interp.speed[idx]
    const overDelta = e.currentTarget === deltaRef.current
    setTooltipData({
      dist: driverData[0].interp.dist[idx],
      progress: nx,
      verticalProgress: overDelta ? 0.5 : Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      speedDelta: firstSpeed != null && secondSpeed != null ? firstSpeed - secondSpeed : null,
      values: driverData.map(d => ({
        abbr: d.abbr, colour: d.colour,
        speed: d.interp.speed[idx] ?? 0, throttle: d.interp.throttle[idx] ?? 0,
        gear: d.interp.gear[idx] ?? 0, rpm: d.interp.rpm[idx] ?? 0,
        brake: d.interp.brake[idx] ?? false,
      })),
    })
  }, [driverData, telemetryReady])

  const handleMouseLeave = useCallback(() => {
    hoverClearControllerRef.current?.schedule()
  }, [])

  const toggleDriver = (dn: number) => {
    if (showTelemetry && qualiSegments?.segments && !segmentDriverNumbers.has(dn)) return
    setSelected(prev => prev.includes(dn) ? prev.filter(d => d !== dn) : prev.length < 4 ? [...prev, dn] : prev)
  }

  const driverList = drivers.map(d => ({ driver_number: d.driver_number, abbreviation: d.abbreviation, team_name: d.team_name ?? '', team_colour: d.team_colour ?? '666666' }))
  const fmtMs = (ms: number | null) => { if (ms === null) return '—'; const s = ms / 1000; const m = Math.floor(s / 60); const secs = (s % 60).toFixed(3).padStart(6, '0'); return m > 0 ? `${m}:${secs}` : secs }
  const tooltipCardWidth = Math.min(driverData.length > 2 ? 400 : 380, Math.max(260, chartWidth - 24))
  const tooltipCardHeight = driverData.length > 2 ? 350 : 220
  const qualifyingAdvancePosition = getQualifyingAdvancePosition(session?.year ?? null, activeSegment)

  // ── Render ────────────────────────────────────────────────────────────────
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'pace', label: 'Pace' },
    { key: 'driving', label: 'Driving' },
    { key: 'inputs', label: 'Inputs' },
    { key: 'data', label: 'Data' },
  ]
  const sessionLabel = isRaceSession(sessionType)
    ? 'Race'
    : isPracticeSession(sessionType)
      ? sessionName || 'Practice'
      : `${sessionName || 'Qualifying'} · ${selectedSegment}`
  const comparisonReady = driverData.length >= 2 && telemetryReady
  const headerTitle = `${session?.year ? `${session.year} ` : ''}${session?.gp_name ?? (sessionName || 'Telemetry analysis')}`

  const hoverCard = hoverActive && tooltipData ? (
    <div style={{
      position: 'absolute',
      zIndex: 3,
      top: 10 + Math.max(8, Math.min(420 - tooltipCardHeight - 8, tooltipData.verticalProgress < 0.5 ? tooltipData.verticalProgress * 420 + 12 : tooltipData.verticalProgress * 420 - tooltipCardHeight - 12)),
      left: Math.max(8, Math.min(chartWidth - tooltipCardWidth - 8, PAD.left + tooltipData.progress * (chartWidth - PAD.left - PAD.right) + 14)),
      width: tooltipCardWidth,
      border: `1px solid ${C.borderMid}`,
      borderRadius: 12,
      background: 'rgba(255,255,255,0.98)',
      pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12, lineHeight: '16px' }}>
        <span style={{ color: C.textBright, fontWeight: 600 }}>{Math.round(tooltipData.dist).toLocaleString()} m</span>
        <span style={{ color: C.textMid, whiteSpace: 'nowrap' }}>
          {driverData[0]?.abbr} vs {driverData[1]?.abbr}: {tooltipData.speedDelta == null ? '—' : `${tooltipData.speedDelta >= 0 ? '+' : ''}${tooltipData.speedDelta.toFixed(0)} km/h`}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {tooltipData.values.map((value, index) => (
          <div key={value.abbr} style={{ minWidth: 0, padding: '8px 12px', borderRight: index % 2 === 0 ? `1px solid ${C.border}` : undefined, borderBottom: index < 2 && tooltipData.values.length > 2 ? `1px solid ${C.border}` : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12, lineHeight: '16px', fontWeight: 600, color: C.textBright }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: value.colour }} />{value.abbr}
            </div>
            <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Math.round(value.speed)}<span style={{ marginLeft: 4, color: C.textMid, fontSize: 12, fontWeight: 500 }}>km/h</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 8px', marginTop: 8, color: C.textSub, fontSize: 12, lineHeight: '16px', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: C.textDim }}>RPM</span><span>{Math.round(value.rpm).toLocaleString()}</span>
              <span style={{ color: C.textDim }}>Throttle</span><span>{Math.round(value.throttle)}%</span>
              <span style={{ color: C.textDim }}>Brake</span><span>{value.brake > 0 ? 'On' : 'Off'}</span>
              <span style={{ color: C.textDim }}>Gear</span><span>{value.gear}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null

  const waiting = (
    <InlineMessage
      title={loading ? 'Loading telemetry' : telemetryError ? 'Telemetry unavailable' : 'Select two drivers to compare'}
      detail={loading
        ? 'Syncing the selected laps. Charts appear as soon as every driver has data.'
        : telemetryError ?? 'Pick at least two drivers in the bar above to build the comparison.'}
    />
  )

  return (
    <div className={`lp ${geist.className} ${geistMono.variable}`} style={{ paddingBottom: 80 }}>
      <div ref={containerRef} style={{ maxWidth: 1120, margin: '0 auto', padding: isMobile ? '0 16px' : '0 24px' }}>

        {/* Header */}
        <header style={{ padding: '32px 0 24px' }}>
          <Link href="/telemetry" className="back body-5">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" /> All sessions
          </Link>
          <h1 className="heading-4" style={{ marginTop: 16 }}>{headerTitle}</h1>
          <p className="body-3 muted" style={{ marginTop: 4 }}>{sessionLabel}</p>
        </header>

        {/* Practice mode */}
        {isPracticeSession(sessionType) && <PracticeAnalysis sessionKey={sessionKey} session={session} drivers={driverList} />}

        {/* Qualifying and race */}
        {showTelemetry && (
          <div ref={chartMeasureRef}>
            {/* Sticky controls: segment and drivers */}
            <div className="tel-bar">
              {!isRaceSession(sessionType) && (
                <ToggleGroup
                  label="Qualifying segment"
                  value={selectedSegment}
                  onChange={setSelectedSegment}
                  items={(['Q1', 'Q2', 'Q3'] as const).map(seg => ({ key: seg, label: seg, disabled: (qualiSegments?.segments?.[seg]?.length ?? 0) === 0 }))}
                />
              )}
              <div className="tel-drivers" role="group" aria-label="Drivers to compare">
                {drivers.map(driver => {
                  const isSelected = selected.includes(driver.driver_number)
                  const unavailable = Boolean(qualiSegments?.segments && !segmentDriverNumbers.has(driver.driver_number))
                  const atLimit = selected.length >= 4 && !isSelected
                  const colour = teamColour(driver.team_colour, driver.team_name)
                  const lap = segmentLapByDriver.get(driver.driver_number)
                  return (
                    <button
                      key={driver.driver_number}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={unavailable || atLimit}
                      onClick={() => toggleDriver(driver.driver_number)}
                      title={unavailable ? `${driver.abbreviation} did not set a lap in ${selectedSegment}` : atLimit ? 'Select up to four drivers' : `${isSelected ? 'Remove' : 'Add'} ${driver.abbreviation}${lap ? `, lap ${lap}` : ''}`}
                      className={`chip ${isSelected ? 'on' : ''}`}
                      style={isSelected ? { borderColor: colour } : undefined}
                    >
                      <span className="dot" style={{ background: unavailable ? C.borderMid : colour }} />
                      {driver.abbreviation}
                    </button>
                  )
                })}
                <span className="caption-4 muted" style={{ marginLeft: 'auto' }}>{selected.length} of 4 selected</span>
              </div>
            </div>

            {comparisonReady ? (
              <TelemetryDecisionHero
                sessionName={sessionName}
                selectedSegment={selectedSegment}
                driverData={driverData}
                drivers={drivers}
                sectorTimes={sectorTimes}
                telLapNumbers={telLapNumbers}
                isMobile={isMobile}
                sessionType={sessionType}
              />
            ) : (
              <div style={{ marginBottom: 24 }}>{waiting}</div>
            )}

            {/* Tabs */}
            <TabList
              id="analysis"
              label="Analysis view"
              value={tab}
              onChange={setTab}
              items={tabs.map(t => ({ key: t.key, label: t.label }))}
              style={{ marginBottom: 24 }}
            />

            <div role="tabpanel" id="analysis-panel" aria-labelledby={`analysis-tab-${tab}`}>
            {/* Pace */}
            {tab === 'pace' && (
              comparisonReady ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Apex minimum speed', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.minSpeed != null ? `${row.minSpeed} km/h` : '—' })) },
                      { label: 'Top speed', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.maxSpeed != null ? `${row.maxSpeed} km/h` : '—' })) },
                      { label: 'Full throttle', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.fullThrottle != null ? `${row.fullThrottle.toFixed(1)}%` : '—' })) },
                      { label: 'Sector sum', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.lapMs != null ? `${(row.lapMs / 1000).toFixed(3)}s` : '—' })) },
                    ].map(metric => (
                      <div key={metric.label} style={{ padding: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16 }}>
                        <div style={{ fontSize: 12, lineHeight: '16px', color: C.textMid, fontWeight: 500 }}>{metric.label}</div>
                        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                          {metric.values.map(value => (
                            <div key={value.abbr} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 14, lineHeight: '20px', fontVariantNumeric: 'tabular-nums' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: C.textMid }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: value.colour }} />{value.abbr}</span>
                              <span style={{ color: C.textBright, fontWeight: 600, whiteSpace: 'nowrap' }}>{value.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div style={{ padding: 16, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 16 }}>
                      <div style={{ fontSize: 12, lineHeight: '16px', color: C.textMid, fontWeight: 500 }}>Theoretical best</div>
                      <div style={{ marginTop: 12, fontSize: 20, lineHeight: '28px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{theoreticalBest != null ? formatLapTime(theoreticalBest) : '—'}</div>
                      <div style={{ marginTop: 4, fontSize: 12, lineHeight: '16px', color: C.textMid }}>Best sectors of the selected drivers</div>
                    </div>
                  </div>

                  <Panel>
                    <PanelHeader
                      title="Speed against distance"
                      subtitle={`${Math.round(driverData[0]?.interp.dist.at(-1) ?? 0).toLocaleString()} m lap. Hover to inspect a point.`}
                      right={
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          {driverData.map((driver, index) => (
                            <span key={driver.abbr} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '16px', color: C.textMid }}>
                              <span style={{ width: 16, height: 0, borderTop: `${index ? 2 : 3}px ${index ? 'dashed' : 'solid'} ${driver.colour}` }} />{driver.abbr}
                            </span>
                          ))}
                        </div>
                      }
                    />
                    <div style={{ position: 'relative', paddingTop: 8 }}>
                      <SvgSpeedTrace driverData={driverData} tooltipNx={tooltipNx} onMouseMove={handleMouseMove as unknown as React.MouseEventHandler<SVGSVGElement>} onMouseLeave={handleMouseLeave} />
                      <canvas ref={deltaRef} height={isMobile ? 110 : 135} style={{ display: 'block', width: '100%', cursor: 'crosshair', borderTop: `1px solid ${C.border}` }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                      {hoverCard}
                    </div>
                  </Panel>

                  <LapStory drivers={lapStoryDrivers} isMobile={isMobile} />
                  <GapToLeaderChart driverData={driverData} width={chartWidth} active />

                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.35fr) minmax(320px, 0.95fr)', gap: 16, alignItems: 'start' }}>
                    {sectorTimes.size > 0 ? <SectorHeroCards driverData={driverData} sectorTimes={sectorTimes} drivers={drivers} /> : <InlineMessage title="Sector times not available" detail="Sector cards appear once lap matched sector times exist for the selected laps." />}
                    <PerformanceMatrix driverData={driverData} sectorTimes={sectorTimes} drivers={drivers} telStats={telStats} />
                  </div>
                </div>
              ) : waiting
            )}

            {/* Driving */}
            {tab === 'driving' && (
              driverData.length >= 2 ? (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.3fr) minmax(320px, 0.9fr)', gap: 16, alignItems: 'start' }}>
                  <div>
                    {cornerInsights ? (
                      <CornerInsights data={cornerInsights} driverColours={insightDriverColours} />
                    ) : (
                      <InlineMessage title="Corner insights loading" detail="The corner by corner story appears when the braking comparison finishes processing." />
                    )}
                  </div>
                  <BrakingAnalysis
                    sessionKey={sessionKey}
                    drivers={selected}
                    trackPath={driverData.length > 0 ? { x: driverData[0].interp.x, y: driverData[0].interp.y } : undefined}
                    onInsightsLoad={(insights, colours) => {
                      setCornerInsights(insights)
                      setInsightDriverColours(colours)
                    }}
                  />
                </div>
              ) : (
                <InlineMessage title="Driving analysis needs two drivers" detail="Pick two comparable drivers in the bar above to unlock braking zones and corner insights." />
              )
            )}

            {/* Inputs */}
            {tab === 'inputs' && (
              comparisonReady ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Panel>
                    <PanelHeader title="Braking" subtitle="Brake on or off across the lap" />
                    <canvas ref={el => { chartRefs.current[3] = el }} height={CHARTS[3].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                  <Panel>
                    <PanelHeader title="Throttle" subtitle="0 to 100 percent" />
                    <canvas ref={el => { chartRefs.current[1] = el }} height={isMobile ? 160 : Math.min(CHARTS[1].height, 220)} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                  <Panel>
                    <PanelHeader title="Engine speed" subtitle="6,000 to 13,000 rpm" />
                    <canvas ref={el => { chartRefs.current[2] = el }} height={CHARTS[2].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                  <Panel>
                    <PanelHeader title="Circuit path" subtitle="Sector placement across the lap" right={
                      <div style={{ display: 'flex', gap: 12 }}>
                        {[{ c: C.red, l: 'S1' }, { c: C.gold, l: 'S2' }, { c: C.purple, l: 'S3' }].map(({ c, l }) => (
                          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, lineHeight: '16px', color: C.textMid }}>
                            <span style={{ width: 12, height: 4, borderRadius: 2, background: c }} />{l}
                          </span>
                        ))}
                      </div>
                    } />
                    <canvas ref={trackRef} height={300} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                </div>
              ) : waiting
            )}

            {/* Data */}
            {tab === 'data' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {qualiSegments?.segments && !isRaceSession(sessionType) && (
                  <Panel>
                    <PanelHeader
                      title="Qualifying segments"
                      subtitle="Order and elimination line"
                      right={
                        <ToggleGroup
                          label="Table segment"
                          value={activeSegment}
                          onChange={setActiveSegment}
                          items={(['Q1', 'Q2', 'Q3'] as const).map(seg => ({ key: seg, label: seg }))}
                        />
                      }
                    />
                    <div style={{ padding: '12px 16px', overflowX: 'auto' }}>
                      {(() => {
                        const entries = qualiSegments?.segments?.[activeSegment] ?? []
                        const cutoff = qualifyingAdvancePosition
                        return (
                          <div style={{ minWidth: 600 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '40px 56px 1fr 96px 72px 72px 72px', gap: 4, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
                              {['Pos', 'Driver', 'Team', 'Time', 'S1', 'S2', 'S3'].map(h => (
                                <span key={h} style={{ fontSize: 12, lineHeight: '16px', color: C.textMid, fontWeight: 500, textAlign: ['Time', 'S1', 'S2', 'S3'].includes(h) ? 'right' : 'left' }}>{h}</span>
                              ))}
                            </div>
                            {entries.map((entry, idx) => {
                              const showCut = cutoff !== null && entry.position === cutoff
                              return (
                                <div key={entry.driver_number}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '40px 56px 1fr 96px 72px 72px 72px', gap: 4, alignItems: 'center', padding: '8px 0', opacity: entry.eliminated ? 0.5 : 1, fontSize: 14, lineHeight: '20px', fontVariantNumeric: 'tabular-nums' }}>
                                    <span style={{ color: C.textMid, fontWeight: idx === 0 ? 600 : 400 }}>{entry.position}</span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: idx === 0 ? 600 : 500 }}>
                                      <span style={{ width: 4, height: 16, borderRadius: 2, background: `#${entry.team_colour}` }} />{entry.abbreviation}
                                    </span>
                                    <span style={{ color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.team_name}</span>
                                    <span style={{ textAlign: 'right', fontWeight: idx === 0 ? 600 : 500 }}>
                                      {fmtMs(entry.lap_time_ms)}
                                      {entry.gap_ms > 0 && <span style={{ display: 'block', fontSize: 12, lineHeight: '16px', color: C.textDim, fontWeight: 400 }}>+{(entry.gap_ms / 1000).toFixed(3)}</span>}
                                    </span>
                                    {(['s1_ms', 's2_ms', 's3_ms'] as const).map(sk => (
                                      <span key={sk} style={{ color: C.textMid, textAlign: 'right' }}>{entry[sk] ? (entry[sk]! / 1000).toFixed(3) : '—'}</span>
                                    ))}
                                  </div>
                                  {showCut && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '16px', color: C.red, margin: '4px 0' }}>
                                      <span style={{ flex: 1, height: 1, background: C.red, opacity: 0.3 }} />Elimination line
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  </Panel>
                )}
                {!isRaceSession(sessionType) && <QualiSpeedPanel sessionKey={sessionKey} />}
                <LapTimeDistribution sessionKey={sessionKey} />
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
