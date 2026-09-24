'use client'

import { use, useEffect, useRef, useState, useCallback } from 'react'
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
import type { Driver, TelemetrySample } from '@/types/f1'
import RaceAnalysis from '@/components/analysis/RaceAnalysis'
import PracticeAnalysis from '@/components/analysis/PracticeAnalysis'
import BrakingAnalysis from '@/components/analysis/BrakingAnalysis'
import CornerInsights from '@/components/analysis/CornerInsights'
import QualiSpeedPanel from '@/components/telemetry/QualiSpeedPanel'
import LapStory, { type LapStoryDriver } from '@/components/telemetry/LapStory'
import dynamic from 'next/dynamic'
import type { InsightsData } from '@/components/analysis/BrakingAnalysis'

const LapTimeDistribution = dynamic(() => import('@/components/analysis/LapTimeDistribution'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 20, border: '1px solid #D9E3EF', borderRadius: 18, background: '#FFFFFF' }}>
      <div style={{ fontSize: 11, color: '#7D8BA2', fontFamily: 'Inter, sans-serif' }}>Loading lap data...</div>
    </div>
  ),
})

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Session helpers ───────────────────────────────────────────────────────────
const isRaceSession = (t: string | null) => t === 'R'
const isPracticeSession = (t: string | null) => t === 'FP1' || t === 'FP2' || t === 'FP3'

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: '#F8F9FC',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F7FB',
  border: '#D9E3EF',
  borderMid: '#C5D2E3',
  textDim: '#7D8BA2',
  textMid: '#56657C',
  textSub: '#293A52',
  textBright: '#13233D',
  red: '#E8002D',
  green: '#10B981',
  purple: '#6E56CF',
  gold: '#F59E0B',
  brake: '#E8002D',
  crosshair: 'rgba(19,35,61,0.08)',
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
    ctx.fillStyle = C.textDim; ctx.font = '600 11px "JetBrains Mono", monospace'; ctx.textAlign = 'right'
    ctx.fillText(isRpm ? `${(val / 1000).toFixed(0)}k` : Math.round(val).toString(), PAD.left - 10, y + 4)
  }
  ctx.beginPath(); ctx.strokeStyle = C.borderMid; ctx.lineWidth = 1
  ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + cH); ctx.stroke()
  ctx.fillStyle = C.textDim; ctx.font = '600 11px "JetBrains Mono", monospace'; ctx.textAlign = 'center'
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
  { label: 'BRAKING', unit: '%', field: 'brake', yMin: 0, yMax: 100, height: 160, gridCount: 4, isRpm: false },
  { label: 'THROTTLE', unit: '%', field: 'throttle', yMin: 0, yMax: 100, height: 220, gridCount: 4, isRpm: false },
  { label: 'RPM', unit: 'rpm', field: 'rpm', yMin: 6000, yMax: 13000, height: 140, gridCount: 5, isRpm: true },
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
type SectionKey = 'overview' | 'drivingAnalysis' | 'speedTrace' | 'inputsPower' | 'qualifyingTables'

const DEFAULT_SECTION_OPEN: Record<SectionKey, boolean> = {
  overview: false,
  drivingAnalysis: false,
  speedTrace: false,
  inputsPower: false,
  qualifyingTables: false,
}

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
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 24,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(19,35,61,0.03)',
      ...style,
    }}>
      {children}
    </div>
  )
}

function PanelHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px 14px', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.08em', color: C.textBright, textTransform: 'uppercase' }}>{title}</span>
        {subtitle && <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: C.textDim }}>{subtitle}</span>}
      </div>
      {right}
    </div>
  )
}

function SectionToggle({
  title,
  subtitle,
  open,
  onToggle,
  badge,
}: {
  title: string
  subtitle: string
  open: boolean
  onToggle: () => void
  badge?: string
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: 0,
        border: 'none',
        background: 'none',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 3, height: 30, borderRadius: 999, background: C.red, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, letterSpacing: '0.08em', color: C.textBright, textTransform: 'uppercase' }}>
              {title}
            </span>
            {badge && (
              <span style={{
                padding: '3px 8px',
                borderRadius: 999,
                border: `1px solid ${C.border}`,
                background: C.surfaceAlt,
                color: C.textMid,
                fontSize: 9,
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 700,
              }}>
                {badge}
              </span>
            )}
          </div>
          <span style={{ fontSize: 10, fontFamily: 'Inter, sans-serif', color: C.textDim }}>
            {subtitle}
          </span>
        </div>
      </div>

      <div style={{
        width: 30,
        height: 30,
        borderRadius: 10,
        border: `1px solid ${C.border}`,
        background: C.surfaceAlt,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease',
        flexShrink: 0,
      }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 4L6 8L10 4" stroke={C.textMid} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  )
}

function CollapsibleSection({
  title,
  subtitle,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string
  subtitle: string
  open: boolean
  onToggle: () => void
  badge?: string
  children: React.ReactNode
}) {
  return (
    <Panel style={{ marginBottom: 18 }}>
      <div style={{ padding: '18px 20px', borderBottom: open ? `1px solid ${C.border}` : 'none' }}>
        <SectionToggle title={title} subtitle={subtitle} open={open} onToggle={onToggle} badge={badge} />
      </div>
      {open && (
        <div style={{ padding: '18px 20px' }}>
          {children}
        </div>
      )}
    </Panel>
  )
}

function InlineMessage({
  title,
  detail,
}: {
  title: string
  detail: string
}) {
  return (
    <div style={{
      padding: '18px 20px',
      borderRadius: 18,
      border: `1px dashed ${C.borderMid}`,
      background: 'linear-gradient(180deg, rgba(255,255,255,0.88), rgba(245,247,251,0.92))',
    }}>
      <div style={{ fontSize: 12, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.textBright }}>
        {title}
      </div>
      <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: C.textMid, fontFamily: 'Inter, sans-serif' }}>
        {detail}
      </div>
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
      ctx.fillStyle = C.textDim; ctx.font = '600 11px "JetBrains Mono", monospace'
      ctx.textAlign = i === xLabels.length - 1 ? 'right' : i === 0 ? 'left' : 'center'
      ctx.fillText(lbl, x + (i === 0 ? 2 : i === 3 ? -2 : 0), PT + cH + 24)
    })

    // Y-axis labels
    const ticks = [0, maxGap / 3, (maxGap * 2) / 3, maxGap]
    ticks.forEach(v => {
      const y = toY(v)
      ctx.fillStyle = C.textDim; ctx.font = '600 11px "JetBrains Mono", monospace'; ctx.textAlign = 'right'
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
      ctx.font = 'bold 9px "JetBrains Mono", monospace'; ctx.textAlign = 'right'
      ctx.fillStyle = colour; ctx.fillText(abbr, last[0] - 4, last[1] - 6)
      if (isFastest) {
        ctx.font = '700 8px "Space Grotesk", sans-serif'
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
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: d.colour }}>{d.abbr}</span>
              </div>
            ))}
            <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: C.textDim, alignSelf: 'center' }}>
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
            <span style={{ fontSize: 9, color: C.textDim, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>METRIC</span>
            {driverData.map(d => (
              <span key={d.abbr} style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: d.colour, textAlign: 'right' }}>{d.abbr}</span>
            ))}
          </div>

          {rows.map(row => {
            const valid = row.values.map(v => v.v).filter((v): v is number => v !== null)
            const best = valid.length ? (row.higherIsBetter ? Math.max(...valid) : Math.min(...valid)) : null
            return (
              <div key={row.label} style={{ display: 'grid', gridTemplateColumns: `minmax(100px, 1.2fr) repeat(${driverData.length}, minmax(80px, 1fr))`, gap: 6, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13, color: C.textSub, fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>{row.label}</span>
                {row.values.map(({ abbr, v, fmt }) => {
                  const isBest = v !== null && v === best
                  return (
                    <span key={abbr} style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: isBest ? 700 : 400, color: isBest ? C.textBright : C.textMid, textAlign: 'right' }}>
                      {v !== null ? fmt(v) : '—'}
                    </span>
                  )
                })}
              </div>
            )
          })}

          {/* Theoretical row */}
          <div style={{ display: 'grid', gridTemplateColumns: `minmax(100px, 1.2fr) repeat(${driverData.length}, minmax(80px, 1fr))`, gap: 6, padding: '10px 0' }}>
            <span style={{ fontSize: 13, color: C.textSub, fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>Theoretical</span>
            {theoBest.map(({ abbr, ms }) => {
              const isBest = ms !== null && ms === Math.min(...theoBest.filter(t => t.ms !== null).map(t => t.ms!))
              return (
                <span key={abbr} style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: isBest ? 700 : 400, color: isBest ? C.textBright : C.textMid, textAlign: 'right' }}>
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
          <div style={{ fontSize: 9, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.45)', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
            THEORETICAL LAP
          </div>
          <div style={{ fontSize: 44, fontFamily: 'Inter, sans-serif', fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-0.03em' }}>
            {formatLapTime(fastestTheo.ms)}
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: fastestTheo.colour }} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', fontFamily: 'JetBrains Mono, monospace' }}>{fastestTheo.abbr}</span>
            {theoDelta !== null && (
              <span style={{
                marginLeft: 6, padding: '3px 10px',
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 20,
                fontSize: 11, color: 'rgba(255,255,255,0.75)',
                fontFamily: 'JetBrains Mono, monospace',
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
                <span style={{ fontSize: 10, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: colour }}>{label}</span>
                {delta !== null && (
                  <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: C.textDim, whiteSpace: 'nowrap' }}>Δ {(delta / 1000).toFixed(3)}s</span>
                )}
              </div>

              {/* Leader big number */}
              {leader && fastestMs !== null && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 34, fontFamily: 'Inter, sans-serif', fontWeight: 900, color: C.textBright, letterSpacing: '-0.03em', lineHeight: 1 }}>
                    {(fastestMs / 1000).toFixed(3)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: leader.colour }} />
                    <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: leader.colour, fontWeight: 700 }}>{leader.abbr}</span>
                    <span style={{ fontSize: 9, color: C.textDim, fontFamily: 'JetBrains Mono, monospace' }}>fastest</span>
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
                        <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: dColour }}>{abbr}</span>
                        <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: isLeader ? C.green : C.red, fontWeight: isLeader ? 700 : 400 }}>
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
  onSegmentChange,
  segmentCounts,
  driverData,
  drivers,
  sectorTimes,
  telLapNumbers,
  isMobile,
}: {
  sessionName: string
  selectedSegment: 'Q1' | 'Q2' | 'Q3'
  onSegmentChange: (segment: 'Q1' | 'Q2' | 'Q3') => void
  segmentCounts: Record<'Q1' | 'Q2' | 'Q3', number>
  driverData: DriverRenderData[]
  drivers: Driver[]
  sectorTimes: Map<number, DriverSectorTimes>
  telLapNumbers: Map<number, number>
  isMobile: boolean
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

  return (
    <section style={{ background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6, padding: isMobile ? 18 : 28, marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.red }} />
          <span style={{ fontSize: 10, color: C.textDim, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>{sessionName} · {selectedSegment}</span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {(['Q1', 'Q2', 'Q3'] as const).map(segment => (
            <button key={segment} onClick={() => onSegmentChange(segment)} disabled={!segmentCounts[segment]} style={{ border: 0, borderBottom: selectedSegment === segment ? `1px solid ${C.textBright}` : '1px solid transparent', padding: '0 0 4px', background: 'transparent', color: selectedSegment === segment ? C.textBright : C.textDim, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: segmentCounts[segment] ? 'pointer' : 'not-allowed' }}>{segment}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(260px, 0.72fr)', gap: isMobile ? 24 : 40, alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: 10, color: C.textDim, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Lap comparison</div>
          <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: isMobile ? (ranked.length > 2 ? 24 : 30) : (ranked.length > 2 ? 29 : 40), lineHeight: 1.12, fontWeight: 400, letterSpacing: '-0.025em', color: C.textBright, margin: 0 }}>
            {ranked.length > 2 ? (
              <>{leader?.abbr ?? '—'} beats {rivalGaps.map((row, index) => <span key={row.abbr}>{index > 0 ? ', ' : ''}{row.abbr} by <em style={{ color: C.red, fontStyle: 'italic', whiteSpace: 'nowrap' }}>{fmtGap(row.gap)}</em></span>)}</>
            ) : (
              <>{leader?.abbr ?? '—'} beats {challenger?.abbr ?? '—'} by <em style={{ color: C.red, fontStyle: 'italic' }}>{fmtGap(gap)}</em></>
            )}
          </h2>
          <p style={{ maxWidth: 540, margin: '14px 0 0', color: C.textMid, fontSize: 12, lineHeight: 1.65 }}>
            {decisive?.winner && decisive.delta != null ? `${decisive.winner.abbr} creates the biggest separation in ${decisive.label}, worth ${(decisive.delta / 1000).toFixed(3)}s. ` : 'Select two comparable laps to compare their pace. '}
            Use the trace below to see where the time appears on track.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
          {rows.map((row, index) => (
            <div key={row.abbr} style={{ padding: '10px 12px', borderLeft: index % 2 === 1 ? `1px solid ${C.border}` : 'none', borderTop: index > 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: row.colour }} /><span style={{ fontSize: 12, fontWeight: 700, color: C.textBright }}>{row.abbr}</span><span style={{ marginLeft: 'auto', fontSize: 9, color: C.textDim, fontFamily: 'JetBrains Mono, monospace' }}>L{telLapNumbers.get(row.driver?.driver_number ?? -1) ?? '—'}</span></div>
              <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sector sum</div>
              <div style={{ marginTop: 4, fontSize: 15, fontFamily: 'JetBrains Mono, monospace', color: C.textBright }}>{row.total != null ? `${(row.total / 1000).toFixed(3)}s` : '—'}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 16, marginTop: 28, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        {sectorDeltas.map(sector => (
          <div key={sector.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ color: sector.colour, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{sector.label}</span>
            <div style={{ flex: 1, height: 5, display: 'flex', gap: 2, background: C.surfaceAlt }}>
              {sector.values.map(value => <span key={value.abbr} style={{ flex: 1, background: value.ms === sector.fastest ? value.colour : C.border }} />)}
            </div>
            <span style={{ minWidth: 38, textAlign: 'right', fontSize: 9, color: C.textDim, fontFamily: 'JetBrains Mono, monospace' }}>{sector.winner?.abbr ?? '—'}</span>
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
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTION_OPEN)
  const [activeChannel, setActiveChannel] = useState<'speed' | 'brake' | 'throttle' | 'rpm'>('speed')

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
  const selectedKey = selected.join(',')

  const toggleSection = useCallback((key: SectionKey) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

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
    if (!selected.length || !sessionType || !isQualifying) {
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
  }, [sessionKey, selected, selectedKey, sessionType, selectedSegment, qualiSegments, isQualifying])

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
    if (!sessionType || !isQualifying) {
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
  }, [sessionKey, sessionType, isQualifying])

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
  const comparisonCountLabel = driverData.length > 0 ? `${driverData.length} drivers` : undefined

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

  const sectorWinners = (() => {
    if (driverData.length < 2) return []
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
    return [[0, 166], [166, 333], [333, 500]].map(([s, e]) => {
      const a = avg(driverData[0].interp.speed.slice(s, e))
      const b = avg(driverData[1].interp.speed.slice(s, e))
      return a > b ? 0 : 1
    })
  })()

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
  const rankedComparison = [...comparisonRows].sort((a, b) => (a.lapMs ?? Infinity) - (b.lapMs ?? Infinity))
  const comparisonLead = rankedComparison[0]
  const comparisonChaser = rankedComparison[1]
  const comparisonGap = comparisonLead?.lapMs != null && comparisonChaser?.lapMs != null
    ? comparisonChaser.lapMs - comparisonLead.lapMs
    : null
  const comparisonRivalGaps = rankedComparison.slice(1).map(row => ({
    ...row,
    gap: comparisonLead?.lapMs != null && row.lapMs != null ? row.lapMs - comparisonLead.lapMs : null,
  }))
  const sectorMargin = (key: 's1_ms' | 's2_ms' | 's3_ms') => {
    const values = comparisonRows.map(row => row.driver ? sectorTimes.get(row.driver.driver_number)?.[key] ?? null : null).filter((value): value is number => value !== null)
    return values.length > 1 ? Math.max(...values) - Math.min(...values) : null
  }
  const theoreticalBest = ['s1_ms', 's2_ms', 's3_ms'].reduce((total, key) => {
    const values = comparisonRows.map(row => row.driver ? sectorTimes.get(row.driver.driver_number)?.[key as 's1_ms' | 's2_ms' | 's3_ms'] ?? null : null).filter((value): value is number => value !== null)
    return values.length ? total + Math.min(...values) : null
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
            drawLine(ctx, d.interp.brake.map(b => b ? 1 : 0), d.colour, W, cfg.height, 0, 1, 1.8, idx % 2 !== 0, false)
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
          ctx.font = '600 11px "JetBrains Mono", monospace'
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
          ctx.font = 'bold 10px "JetBrains Mono", monospace'
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

      if (trackRef.current && hasTrackShape && openSections.inputsPower) {
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
  }, [chartWidth, driverData, isQualifying, openSections.inputsPower, openSections.speedTrace, telemetryReady, tooltipNx])

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
    if (isQualifying && qualiSegments?.segments && !segmentDriverNumbers.has(dn)) return
    setSelected(prev => prev.includes(dn) ? prev.filter(d => d !== dn) : prev.length < 4 ? [...prev, dn] : prev)
  }

  const driverList = drivers.map(d => ({ driver_number: d.driver_number, abbreviation: d.abbreviation, team_name: d.team_name ?? '', team_colour: d.team_colour ?? '666666' }))
  const fmtMs = (ms: number | null) => { if (ms === null) return '—'; const s = ms / 1000; const m = Math.floor(s / 60); const secs = (s % 60).toFixed(3).padStart(6, '0'); return m > 0 ? `${m}:${secs}` : secs }
  const tooltipCardWidth = Math.min(driverData.length > 2 ? 400 : 380, Math.max(260, chartWidth - 24))
  const tooltipCardHeight = driverData.length > 2 ? 350 : 220
  const qualifyingAdvancePosition = getQualifyingAdvancePosition(session?.year ?? null, activeSegment)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: 'linear-gradient(180deg, #F5F7FB 0%, #EEF3FA 22%, #EAF0F8 100%)', minHeight: '100vh', paddingBottom: 80 }}>
      <div ref={containerRef} style={{ maxWidth: 1440, margin: '0 auto', padding: isMobile ? '0 12px' : '0 24px' }}>

        {/* Header */}
        <div style={{ padding: '22px 8px 20px', borderBottom: `1px solid ${C.border}`, marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ padding: '3px 6px', borderRadius: 3, background: '#FCE7EB', color: C.red, fontSize: 8, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}>ROUND</span>
                <span style={{ fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textDim }}>FIA Formula 1 World Championship</span>
              </div>
              <h1 style={{ fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: isMobile ? 22 : 27, color: C.textBright, letterSpacing: '-0.025em', margin: 0 }}>
                {session?.year ? `${session.year} ` : ''}{session?.gp_name ?? sessionName ?? 'Telemetry Analysis'}
              </h1>
              <div style={{ marginTop: 7, fontSize: 11, color: C.textMid, fontFamily: 'JetBrains Mono, monospace' }}>Qualifying · {selectedSegment} shootout · pole position battle</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
              <span style={{ padding: '6px 8px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 9, color: C.textMid, fontFamily: 'JetBrains Mono, monospace' }}>{session?.gp_name ?? 'Circuit'}</span>
              <span style={{ padding: '6px 8px', background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 9, color: C.green, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>LIVE SYNC</span>
            </div>
          </div>
          {driverData.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
              {driverData.map((d, i) => (
                <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 18, height: i === 0 ? 2.5 : 0, borderTop: i > 0 ? `2px dashed ${d.colour}` : undefined, borderBottom: i === 0 ? `2.5px solid ${d.colour}` : undefined, display: 'inline-block' }} />
                  <span style={{ fontSize: 13, fontFamily: 'Inter, sans-serif', fontWeight: 700, color: C.textBright }}>CAR {d.abbr}</span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[0, 1, 2].map(si => (
                      <div key={si} style={{ width: 5, height: 5, borderRadius: '50%', background: sectorWinners[si] === i ? d.colour : C.border }} />
                    ))}
                  </div>
                  {i < driverData.length - 1 && <span style={{ color: C.textDim, fontSize: 11, marginLeft: 4 }}>vs</span>}
                </div>
              ))}
              {telLapNumbers.size > 0 && (
                <span style={{ fontSize: 11, color: C.textMid, fontFamily: 'JetBrains Mono, monospace', marginLeft: 4 }}>
                  LAP {[...telLapNumbers.values()].join(' VS LAP ')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Race mode */}
        {isRaceSession(sessionType) && (
          <>
            <RaceAnalysis sessionKey={sessionKey} sessionName={sessionName} drivers={driverList} />
            <div style={{ marginTop: 24 }}>
              <LapTimeDistribution sessionKey={sessionKey} />
            </div>
          </>
        )}

        {/* Practice mode */}
        {isPracticeSession(sessionType) && <PracticeAnalysis sessionKey={sessionKey} session={session} drivers={driverList} />}

        {/* Qualifying mode */}
        {isQualifying && (
          <div ref={chartMeasureRef}>
            <TelemetryDecisionHero
              sessionName={sessionName}
              selectedSegment={selectedSegment}
              onSegmentChange={setSelectedSegment}
              segmentCounts={{
                Q1: qualiSegments?.segments.Q1?.length ?? 0,
                Q2: qualiSegments?.segments.Q2?.length ?? 0,
                Q3: qualiSegments?.segments.Q3?.length ?? 0,
              }}
              driverData={driverData}
              drivers={drivers}
              sectorTimes={sectorTimes}
              telLapNumbers={telLapNumbers}
              isMobile={isMobile}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14, padding: '12px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 9, color: C.textDim, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Compare drivers</span>
                <span style={{ fontSize: 9, color: C.textMid, fontFamily: 'JetBrains Mono, monospace' }}>{selected.length}/4 selected</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
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
                      title={unavailable ? `${driver.abbreviation} did not set a lap in ${selectedSegment}` : atLimit ? 'Select up to four drivers' : `${isSelected ? 'Remove' : 'Add'} ${driver.abbreviation}${lap ? ` · lap ${lap}` : ''}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        minHeight: 28, padding: '4px 7px', border: `1px solid ${isSelected ? `${colour}70` : C.border}`,
                        borderRadius: 4, background: isSelected ? `${colour}12` : C.surfaceAlt,
                        color: isSelected ? C.textBright : C.textMid,
                        fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: isSelected ? 800 : 500,
                        cursor: unavailable || atLimit ? 'not-allowed' : 'pointer', opacity: unavailable || atLimit ? 0.38 : 1,
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: unavailable ? C.borderMid : colour }} />
                      {driver.abbreviation}
                    </button>
                  )
                })}
              </div>
            </div>

            {driverData.length >= 2 && telemetryReady ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 14px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                  <span style={{ marginRight: 4, fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textDim }}>Channels</span>
                  {[
                    { key: 'speed' as const, label: 'Velocity (km/h)' },
                    { key: 'brake' as const, label: 'Brake pressure' },
                    { key: 'throttle' as const, label: 'Throttle %' },
                    { key: 'rpm' as const, label: 'Engine RPM' },
                  ].map(channel => {
                    const active = activeChannel === channel.key
                    return <button key={channel.key} onClick={() => setActiveChannel(channel.key)} style={{ border: `1px solid ${active ? C.red : C.border}`, borderRadius: 4, padding: '6px 9px', background: active ? C.red : C.surfaceAlt, color: active ? '#FFFFFF' : C.textMid, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, cursor: 'pointer' }}>{channel.label}</button>
                  })}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 240px', gap: 14, padding: '16px 18px', background: '#FFF9FA', border: '1px solid #F7D7DE', borderLeft: `3px solid ${C.red}`, borderRadius: 6 }}>
                  <div>
                    <div style={{ fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, letterSpacing: '0.12em', color: C.red, textTransform: 'uppercase', marginBottom: 7 }}>Where the lap was won</div>
                    <div style={{ fontSize: 12, lineHeight: 1.65, color: C.textSub }}>
                      {comparisonLead?.abbr} leads{comparisonRivalGaps.length ? ' ' : ' the comparison'}{comparisonRivalGaps.map((row, index) => <span key={row.abbr}>{index > 0 ? ', ' : ''}{row.abbr} by <strong>{row.gap != null ? `+${(row.gap / 1000).toFixed(3)}s` : '—'}</strong></span>)}. The largest sector separation is {sectorMargin('s1_ms') != null && sectorMargin('s2_ms') != null && sectorMargin('s3_ms') != null ? `S${(['s1_ms', 's2_ms', 's3_ms'] as const).reduce((best, key, index) => (sectorMargin(key) ?? 0) > (sectorMargin((['s1_ms', 's2_ms', 's3_ms'] as const)[best]) ?? 0) ? index : best, 0) + 1}` : 'available in the trace'}; inspect the overlay to trace the braking and exit-speed trade-off.
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignContent: 'center' }}>
                    <div style={{ borderLeft: `1px solid ${C.border}`, paddingLeft: 12 }}><div style={{ fontSize: 8, color: C.textDim, letterSpacing: '0.09em' }}>{comparisonRows.length > 2 ? 'NEXT CAR GAP' : 'NET ADVANTAGE'}</div><div style={{ marginTop: 4, color: C.red, fontSize: 17, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}>{comparisonGap != null ? `-${(comparisonGap / 1000).toFixed(3)}s` : '—'}</div></div>
                    <div style={{ borderLeft: `1px solid ${C.border}`, paddingLeft: 12 }}><div style={{ fontSize: 8, color: C.textDim, letterSpacing: '0.09em' }}>LAP SAMPLE</div><div style={{ marginTop: 4, color: C.green, fontSize: 17, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}>100 Hz</div></div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
                  {[
                    { label: 'Apex min speed', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.minSpeed != null ? `${row.minSpeed}` : '—' })), accent: C.red },
                    { label: 'Tunnel top speed', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.maxSpeed != null ? `${row.maxSpeed}` : '—' })), accent: '#F97316' },
                    { label: 'Full throttle', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.fullThrottle != null ? `${row.fullThrottle.toFixed(1)}%` : '—' })), accent: C.green },
                    { label: 'Lap sector sum', values: comparisonRows.map(row => ({ abbr: row.abbr, colour: row.colour, value: row.lapMs != null ? `${(row.lapMs / 1000).toFixed(3)}s` : '—' })), accent: C.gold },
                  ].map(metric => (
                    <div key={metric.label} style={{ minHeight: 104, padding: '11px 10px 9px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 8, color: C.textDim, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{metric.label}</div>
                      <div style={{ display: 'grid', gap: 5, marginTop: 9 }}>
                        {metric.values.map(value => <div key={value.abbr} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, fontFamily: 'JetBrains Mono, monospace' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.textMid, fontSize: 8 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: value.colour }} />{value.abbr}</span><span style={{ color: C.textBright, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>{value.value}{metric.label.includes('speed') ? ' km/h' : ''}</span></div>)}
                      </div>
                      <div style={{ height: 3, marginTop: 8, background: metric.accent, opacity: 0.9 }} />
                    </div>
                  ))}
                  <div style={{ minHeight: 104, padding: '11px 10px 9px', background: '#FFF0F2', border: '1px solid #F8D4DA', borderRadius: 6 }}>
                    <div style={{ fontSize: 8, color: C.textDim, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Theoretical best</div>
                    <div style={{ marginTop: 13, color: C.textBright, fontSize: 16, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}>{theoreticalBest != null ? formatLapTime(theoreticalBest) : '—'}</div>
                    <div style={{ marginTop: 4, color: C.red, fontSize: 8, fontFamily: 'JetBrains Mono, monospace' }}>BEST OF SELECTED</div>
                    <div style={{ height: 3, marginTop: 8, background: C.red }} />
                  </div>
                </div>

                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                    <div><div style={{ fontSize: 12, fontFamily: 'Space Grotesk, sans-serif', color: C.textBright, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{activeChannel === 'speed' ? 'Speed vs distance trace' : `${activeChannel} trace`}</div><div style={{ marginTop: 3, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: C.textDim }}>Continuous multi-channel overlay · {Math.round(driverData[0]?.interp.dist.at(-1) ?? 0).toLocaleString()} m lap</div></div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{driverData.map((driver, index) => <span key={driver.abbr} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: C.textMid }}><span style={{ width: 12, height: index ? 2 : 3, background: driver.colour, borderTop: index ? `1px dashed ${driver.colour}` : undefined }} />{driver.abbr}</span>)}</div>
                  </div>
                  <div style={{ padding: '10px 0 0', position: 'relative' }}>
                    {CHARTS.map((chart, index) => <canvas key={chart.field} ref={element => { chartRefs.current[index] = element }} height={isMobile ? (chart.field === 'speed' ? 270 : 160) : chart.field === 'speed' ? 360 : Math.min(chart.height, 220)} style={{ display: activeChannel === chart.field ? 'block' : 'none', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />)}
                    {activeChannel === 'speed' && <canvas ref={deltaRef} height={isMobile ? 110 : 135} style={{ display: 'block', width: '100%', cursor: 'crosshair', borderTop: `1px solid ${C.border}` }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />}
                    {hoverActive && tooltipData && (
                      <div style={{
                        position: 'absolute',
                        zIndex: 3,
                        top: 10 + Math.max(8, Math.min(420 - tooltipCardHeight - 8, tooltipData.verticalProgress < 0.5 ? tooltipData.verticalProgress * 420 + 12 : tooltipData.verticalProgress * 420 - tooltipCardHeight - 12)),
                        left: Math.max(8, Math.min(chartWidth - tooltipCardWidth - 8, PAD.left + tooltipData.progress * (chartWidth - PAD.left - PAD.right) + 14)),
                        width: tooltipCardWidth,
                        border: `1px solid ${C.borderMid}`,
                        borderRadius: 7,
                        background: 'rgba(255,255,255,0.98)',
                        boxShadow: '0 12px 32px rgba(19,35,61,0.18)',
                        pointerEvents: 'none',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
                          <span style={{ fontSize: 10, color: C.textBright, fontWeight: 800 }}>DISTANCE: {Math.round(tooltipData.dist).toLocaleString()} m</span>
                          <span style={{ fontSize: 9, color: tooltipData.speedDelta != null && tooltipData.speedDelta >= 0 ? driverData[0]?.colour : driverData[1]?.colour, fontWeight: 800, whiteSpace: 'nowrap' }}>
                            Δ SPEED · {driverData[0]?.abbr}/{driverData[1]?.abbr} {tooltipData.speedDelta == null ? '—' : `${tooltipData.speedDelta >= 0 ? '+' : ''}${tooltipData.speedDelta.toFixed(0)} km/h`}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                          {tooltipData.values.map((value, index) => (
                            <div key={value.abbr} style={{ minWidth: 0, padding: '9px 12px 10px', borderRight: index % 2 === 0 ? `1px solid ${C.border}` : undefined, borderBottom: index < 2 && tooltipData.values.length > 2 ? `1px solid ${C.border}` : undefined }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><span style={{ width: 8, height: 8, flex: '0 0 auto', borderRadius: '50%', background: value.colour }} /><span style={{ fontSize: 10, fontWeight: 800, color: value.colour }}>{value.abbr}</span></div>
                              <div style={{ color: C.textBright, fontSize: 19, lineHeight: 1.1, fontWeight: 800, whiteSpace: 'nowrap' }}>{Math.round(value.speed)}<span style={{ marginLeft: 4, color: C.textMid, fontSize: 9, fontWeight: 500 }}>km/h</span></div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 8px', marginTop: 8, color: C.textSub, fontSize: 9, lineHeight: 1.3 }}>
                                <span style={{ color: C.textDim }}>RPM</span><span>{Math.round(value.rpm).toLocaleString()}</span>
                                <span style={{ color: C.textDim }}>THROTTLE</span><span>{Math.round(value.throttle)}%</span>
                                <span style={{ color: C.textDim }}>BRAKE</span><span>{value.brake > 0 ? `${Math.round(value.brake)}%` : 'OFF'}</span>
                                <span style={{ color: C.textDim }}>GEAR</span><span>{value.gear}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div style={{ padding: '7px 12px 9px', borderTop: `1px solid ${C.border}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: C.textDim, fontSize: 8 }}><span>LAP PROGRESS</span><span>{Math.round(tooltipData.progress * 100)}%</span></div>
                          <div style={{ height: 3, overflow: 'hidden', borderRadius: 2, background: C.surfaceAlt }}><div style={{ width: `${tooltipData.progress * 100}%`, height: '100%', background: C.red }} /></div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '8px 18px 12px', color: C.textDim, fontSize: 8, fontFamily: 'JetBrains Mono, monospace' }}>Hover across the trace to inspect live telemetry values</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 0.95fr) minmax(0, 1.05fr)', gap: 14 }}>
                  <div style={{ padding: '16px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                    <div style={{ fontSize: 11, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, letterSpacing: '0.08em', color: C.textBright, textTransform: 'uppercase' }}>Session telemetry log</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', marginTop: 16, fontFamily: 'JetBrains Mono, monospace', fontSize: 9 }}>
                      <span style={{ color: C.textDim }}>SESSION <strong style={{ color: C.textBright }}>{selectedSegment}</strong></span><span style={{ color: C.textDim }}>LAPS <strong style={{ color: C.textBright }}>{comparisonRows.map(row => telLapNumbers.get(row.driver?.driver_number ?? -1) ?? '—').join(' / ')}</strong></span>
                      <span style={{ color: C.textDim }}>COMPARISON <strong style={{ color: C.textBright }}>{comparisonRows.map(row => row.abbr).join(' vs ')}</strong></span><span style={{ color: C.textDim }}>TRACK <strong style={{ color: C.textBright }}>{session?.gp_name ?? 'Circuit'}</strong></span>
                      <span style={{ color: C.textDim }}>TELEMETRY <strong style={{ color: C.green }}>READY</strong></span><span style={{ color: C.textDim }}>MODE <strong style={{ color: C.textBright }}>BEST LAP</strong></span>
                    </div>
                  </div>
                  <div style={{ padding: '16px 18px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 11 }}><span style={{ fontSize: 11, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, letterSpacing: '0.08em', color: C.textBright, textTransform: 'uppercase' }}>Performance matrix</span><span style={{ fontSize: 9, color: C.textDim, fontFamily: 'JetBrains Mono, monospace' }}>Sector times</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: `minmax(58px, 0.8fr) repeat(${comparisonRows.length}, minmax(48px, 1fr))`, gap: 6, paddingBottom: 7, borderBottom: `1px solid ${C.border}` }}>
                      <span />
                      {comparisonRows.map(row => <span key={row.abbr} style={{ textAlign: 'right', color: row.colour, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}>{row.abbr}</span>)}
                    </div>
                    {([
                      { label: 'S1', key: 's1_ms' as const },
                      { label: 'S2', key: 's2_ms' as const },
                      { label: 'S3', key: 's3_ms' as const },
                    ]).map(sector => {
                      const values = comparisonRows.map(row => ({
                        abbr: row.abbr,
                        ms: row.driver ? sectorTimes.get(row.driver.driver_number)?.[sector.key] ?? null : null,
                      }))
                      const valid = values.map(value => value.ms).filter((value): value is number => value != null)
                      const fastest = valid.length ? Math.min(...valid) : null
                      return <div key={sector.label} style={{ display: 'grid', gridTemplateColumns: `minmax(58px, 0.8fr) repeat(${comparisonRows.length}, minmax(48px, 1fr))`, gap: 6, padding: '9px 0', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 10, color: C.textMid }}>{sector.label}</span>
                        {values.map(value => <span key={value.abbr} style={{ textAlign: 'right', color: value.ms === fastest ? C.green : C.textSub, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: value.ms === fastest ? 800 : 500 }}>{value.ms != null ? (value.ms / 1000).toFixed(3) : '—'}</span>)}
                      </div>
                    })}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 11, padding: '8px 10px', background: '#FFF0F2', color: C.red, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}><span>{comparisonLead?.abbr} TO NEXT CAR</span><span>{comparisonGap != null ? `-${(comparisonGap / 1000).toFixed(3)}s` : '—'}</span></div>
                  </div>
                </div>
              </div>
            ) : (
              <InlineMessage title={loading ? 'Loading telemetry' : 'Select a comparison'} detail={loading ? 'Synchronizing the selected qualifying laps.' : 'Choose two drivers from the overview panel to build the telemetry console.'} />
            )}
            {false && (
              <>
            <CollapsibleSection
              title="Overview"
              subtitle="Core comparison controls, sector spread, and summary pace metrics."
              open={openSections.overview}
              onToggle={() => toggleSection('overview')}
              badge={comparisonCountLabel}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <Panel>
                  <PanelHeader title="Controls" subtitle="Segment lens and driver focus" />
                  <div style={{ padding: '16px 18px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(260px, 320px) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
                      <div>
                        {qualiSegments?.segments && (
                          <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 8 }}>
                              Segment Lens
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {(['Q1', 'Q2', 'Q3'] as const).map(seg => {
                                const isActive = selectedSegment === seg
                                const count = qualiSegments.segments[seg]?.length ?? 0
                                const sc = seg === 'Q1' ? '#3671C6' : seg === 'Q2' ? C.gold : C.red
                                return (
                                  <button key={seg} disabled={count === 0} onClick={() => setSelectedSegment(seg)} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: `1px solid ${isActive ? sc : C.border}`,
                                    background: isActive ? `${sc}15` : C.surfaceAlt, color: count === 0 ? C.textDim : isActive ? sc : C.textMid,
                                    fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: isActive ? 700 : 500, cursor: count === 0 ? 'not-allowed' : 'pointer',
                                  }}>
                                    {seg}
                                    {count > 0 && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: isActive ? `${sc}20` : C.border, color: isActive ? sc : C.textMid }}>{count}</span>}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div>
                        <div style={{ fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim, marginBottom: 8 }}>
                          Drivers
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {drivers.map(d => {
                            const isSel = selected.includes(d.driver_number)
                            const colour = teamColour(d.team_colour, d.team_name)
                            const unavail = isQualifying && qualiSegments?.segments ? !segmentDriverNumbers.has(d.driver_number) : false
                            const segLap = segmentLapByDriver.get(d.driver_number)
                            return (
                              <button key={d.driver_number} disabled={unavail} onClick={() => toggleDriver(d.driver_number)} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 10,
                                border: `1px solid ${isSel ? colour + '55' : C.border}`, background: isSel ? `${colour}12` : C.surfaceAlt,
                                color: isSel ? C.textBright : C.textMid, fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
                                fontWeight: isSel ? 700 : 500, cursor: unavail ? 'not-allowed' : 'pointer', opacity: unavail ? 0.35 : 1,
                              }}>
                                <div style={{ width: 5, height: 5, borderRadius: '50%', background: unavail ? C.textDim : colour }} />
                                {d.abbreviation}
                                {segLap && <span style={{ fontSize: 8, color: C.textDim }}>L{segLap}</span>}
                              </button>
                            )
                          })}
                        </div>

                        {driverData.length > 0 && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {driverData.map(d => (
                              <div key={d.abbr} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', background: `${d.colour}10`, border: `1px solid ${d.colour}28`, borderRadius: 999 }}>
                                <div style={{ width: 14, height: 2, borderRadius: 1, background: d.colour }} />
                                <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: C.textBright, fontWeight: 700 }}>
                                  {d.abbr}{(() => { const dr = drivers.find(x => x.abbreviation === d.abbr); const lap = dr ? telLapNumbers.get(dr.driver_number) : null; return lap ? ` · L${lap}` : '' })()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Panel>

                {driverData.length >= 2 && telemetryReady && (
                  <LapStory drivers={lapStoryDrivers} isMobile={isMobile} />
                )}

                {driverData.length >= 2 ? (
                  telemetryReady ? (
                    <GapToLeaderChart driverData={driverData} width={chartWidth} active={openSections.overview} />
                  ) : (
                    <InlineMessage
                      title={loading ? 'Loading telemetry' : 'Telemetry comparison pending'}
                      detail={loading ? 'Building the speed comparison for the selected qualifying laps.' : (telemetryError ?? 'Select at least two comparable laps to unlock the top-level gap view.')}
                    />
                  )
                ) : (
                  <InlineMessage
                    title="Select a comparison"
                    detail="Choose at least two available drivers from the current qualifying segment to unlock the top-level time gap view."
                  />
                )}

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.35fr) minmax(320px, 0.95fr)', gap: 18, alignItems: 'start' }}>
                  <div>
                    {driverData.length >= 2 && sectorTimes.size > 0 ? (
                      <SectorHeroCards driverData={driverData} sectorTimes={sectorTimes} drivers={drivers} />
                    ) : (
                      <InlineMessage
                        title="Sector comparison pending"
                        detail="Sector cards appear once lap-matched sector times are available for the currently selected qualifying laps."
                      />
                    )}
                  </div>

                  <div>
                    {driverData.length >= 2 ? (
                      <PerformanceMatrix driverData={driverData} sectorTimes={sectorTimes} drivers={drivers} telStats={telStats} />
                    ) : (
                      <InlineMessage
                        title="Performance matrix pending"
                        detail="The matrix and theoretical lap summary will populate once at least two drivers are selected."
                      />
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Driving Analysis"
              subtitle="Corner story, braking map, and narrative insights for the current duel."
              open={openSections.drivingAnalysis}
              onToggle={() => toggleSection('drivingAnalysis')}
            >
              {driverData.length >= 2 ? (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.3fr) minmax(320px, 0.9fr)', gap: 18, alignItems: 'start' }}>
                  <div>
                    {cornerInsights ? (
                      <CornerInsights data={cornerInsights} driverColours={insightDriverColours} />
                    ) : (
                      <InlineMessage
                        title="Driving insights loading"
                        detail="Corner-by-corner narrative insights will appear here as the braking comparison finishes processing."
                      />
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
                <InlineMessage
                  title="Driving analysis unavailable"
                  detail="Pick two comparable drivers from the selected segment to unlock braking and corner insights."
                />
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Speed Trace"
              subtitle="Primary speed comparison with a compact telemetry snapshot that expands on hover."
              open={openSections.speedTrace}
              onToggle={() => toggleSection('speedTrace')}
              badge={hoverActive && tooltipData ? `${(tooltipData.dist / 1000).toFixed(3)} km` : undefined}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Panel>
                  <PanelHeader
                    title="Telemetry Snapshot"
                    subtitle={hoverActive ? 'Live metrics at the highlighted distance marker' : 'Hover the charts below to inspect a point on lap'}
                    right={telemetryReady ? <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: C.textDim }}>{telLapNumbers.size > 0 ? `LAPS ${[...telLapNumbers.values()].join(' / ')}` : 'Telemetry ready'}</span> : undefined}
                  />
                  <div style={{ padding: '16px 18px' }}>
                    {!hoverActive || !tooltipData ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 10, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textDim }}>
                            Ready for inspection
                          </div>
                          <div style={{ fontSize: 13, fontFamily: 'Inter, sans-serif', color: C.textMid, marginTop: 6, lineHeight: 1.6 }}>
                            Hover the velocity or delta graph to reveal the live speed, throttle, brake, and RPM snapshot without taking over the page.
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {driverData.map((d, i) => (
                            <div key={d.abbr} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 14, background: `${d.colour}10`, border: `1px solid ${d.colour}25` }}>
                              {i === 0 ? <div style={{ width: 18, height: 2.5, borderRadius: 2, background: d.colour }} /> : <div style={{ width: 18, borderTop: `2px dashed ${d.colour}` }} />}
                              <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: C.textBright }}>{d.abbr}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                        {tooltipData.values.map(v => (
                          <div key={v.abbr} style={{ borderRadius: 18, border: `1px solid ${C.border}`, background: `${v.colour}08`, padding: '14px 16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: v.colour }} />
                                <span style={{ fontSize: 13, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 900, color: C.textBright }}>{v.abbr}</span>
                              </div>
                              <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: C.textDim }}>{(tooltipData.dist / 1000).toFixed(3)} km</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                              {[
                                { label: 'Speed', value: `${v.speed.toFixed(0)} km/h`, colour: C.textBright },
                                { label: 'RPM', value: `${Math.round(v.rpm).toLocaleString()}`, colour: C.textBright },
                                { label: 'Throttle', value: `${v.throttle.toFixed(0)}%`, colour: C.green },
                                { label: 'Brake', value: v.brake > 0 ? 'On' : 'Off', colour: v.brake > 0 ? C.red : C.textMid },
                              ].map(metric => (
                                <div key={metric.label}>
                                  <div style={{ fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textDim }}>
                                    {metric.label}
                                  </div>
                                  <div style={{ marginTop: 4, fontSize: 14, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: metric.colour }}>
                                    {metric.value}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Panel>

                {loading ? (
                  <InlineMessage
                    title="Loading speed traces"
                    detail="The selected qualifying comparison is loading. The charts will render as soon as the telemetry samples and lap mapping are synchronized."
                  />
                ) : telemetryError ? (
                  <InlineMessage
                    title="Telemetry unavailable"
                    detail={telemetryError}
                  />
                ) : telemetryReady ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <Panel>
                      <PanelHeader title="Velocity" subtitle="Speed vs distance" right={
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                          {driverData.map((d, i) => (
                            <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {i === 0 ? <div style={{ width: 18, height: 2.5, borderRadius: 2, background: d.colour }} /> : <div style={{ width: 18, borderTop: `2px dashed ${d.colour}` }} />}
                              <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: C.textMid }}>{d.abbr}</span>
                            </div>
                          ))}
                        </div>
                      } />
                      <div style={{ width: '100%' }}>
                        <canvas ref={el => { chartRefs.current[0] = el }} height={isMobile ? 300 : CHARTS[0].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                      </div>
                    </Panel>

                    {driverData.length >= 2 && (
                      <Panel>
                        <PanelHeader title="Speed Delta" subtitle={`${driverData[0].abbr} vs ${driverData[1].abbr}`} />
                        <div style={{ width: '100%' }}>
                          <canvas ref={deltaRef} height={isMobile ? 120 : 160} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                        </div>
                      </Panel>
                    )}
                  </div>
                ) : (
                  <InlineMessage
                    title="Awaiting telemetry"
                    detail="Once telemetry is ready for every selected driver, the primary speed charts will render here automatically."
                  />
                )}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="Inputs & Power"
              subtitle="Supporting traces for braking, throttle, engine RPM, and circuit path."
              open={openSections.inputsPower}
              onToggle={() => toggleSection('inputsPower')}
            >
              {telemetryReady ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Panel>
                    <PanelHeader title="Braking" subtitle="Brake application intensity" />
                    <div style={{ width: '100%' }}>
                      <canvas ref={el => { chartRefs.current[1] = el }} height={isMobile ? 120 : CHARTS[1].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                    </div>
                  </Panel>

                  <Panel>
                    <PanelHeader title="Throttle Input" subtitle="0 – 100%" />
                    <div style={{ width: '100%' }}>
                      <canvas ref={el => { chartRefs.current[2] = el }} height={isMobile ? 160 : CHARTS[2].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                    </div>
                  </Panel>

                  <Panel>
                    <PanelHeader title="Engine RPM" subtitle="6 000 – 13 000" />
                    <div style={{ width: '100%' }}>
                      <canvas ref={el => { chartRefs.current[3] = el }} height={isMobile ? 120 : CHARTS[3].height} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                    </div>
                  </Panel>

                  <Panel>
                    <PanelHeader title="Circuit Path" subtitle="Sector placement across the lap" right={
                      <div style={{ display: 'flex', gap: 14 }}>
                        {[{ c: C.red, l: 'S1' }, { c: C.gold, l: 'S2' }, { c: C.purple, l: 'S3' }].map(({ c, l }) => (
                          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 10, height: 3, borderRadius: 2, background: c }} />
                            <span style={{ fontSize: 9, color: C.textMid, fontFamily: 'Space Grotesk, sans-serif' }}>{l}</span>
                          </div>
                        ))}
                      </div>
                    } />
                    <canvas ref={trackRef} height={300} style={{ display: 'block', width: '100%', cursor: 'crosshair' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
                  </Panel>
                </div>
              ) : (
                <InlineMessage
                  title="Supporting telemetry pending"
                  detail={loading ? 'Supporting traces will appear as soon as the core telemetry comparison finishes loading.' : (telemetryError ?? 'Select a valid qualifying comparison to unlock the deeper input and power traces.')}
                />
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Qualifying Tables"
              subtitle="Session order, speed trap analysis, and lap progression grouped into one lower-priority data section."
              open={openSections.qualifyingTables}
              onToggle={() => toggleSection('qualifyingTables')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {qualiSegments?.segments && (
                  <Panel>
                    <PanelHeader
                      title="Qualifying Segments"
                      subtitle="Segment order and elimination line"
                      right={
                        <div style={{ display: 'flex', gap: 6 }}>
                          {(['Q1', 'Q2', 'Q3'] as const).map(seg => {
                            const count = qualiSegments.segments[seg]?.length ?? 0
                            const isA = activeSegment === seg
                            const sc = seg === 'Q1' ? '#3671C6' : seg === 'Q2' ? C.gold : C.red
                            return (
                              <button key={seg} onClick={() => setActiveSegment(seg)} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 10,
                                border: `1px solid ${isA ? sc : C.border}`, background: isA ? `${sc}15` : C.surfaceAlt,
                                color: isA ? sc : C.textMid, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: isA ? 700 : 500, cursor: 'pointer',
                              }}>
                                {seg}
                                {count > 0 && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: isA ? `${sc}22` : C.border, color: isA ? sc : C.textDim }}>{count}</span>}
                              </button>
                            )
                          })}
                        </div>
                      }
                    />
                    <div style={{ padding: '12px 16px', overflowX: 'auto' }}>
                      {(() => {
                        const entries = qualiSegments.segments[activeSegment] ?? []
                        const sc = activeSegment === 'Q1' ? '#3671C6' : activeSegment === 'Q2' ? C.gold : C.red
                        const cutoff = qualifyingAdvancePosition
                        return (
                          <div style={{ minWidth: isMobile ? '700px' : 580 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '28px 38px 1fr 84px 64px 64px 64px', gap: 4, paddingBottom: 8, borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
                              {['P', 'DRV', 'TEAM', 'TIME', 'S1', 'S2', 'S3'].map(h => (
                                <span key={h} style={{ fontSize: 8, color: C.textDim, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', textAlign: ['TIME', 'S1', 'S2', 'S3'].includes(h) ? 'right' : 'left' }}>{h}</span>
                              ))}
                            </div>
                            {entries.map((entry, idx) => {
                              const isFastest = idx === 0
                              const showCut = cutoff !== null && entry.position === cutoff
                              return (
                                <div key={entry.driver_number}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '28px 38px 1fr 84px 64px 64px 64px', gap: 4, alignItems: 'center', padding: '8px 8px', borderRadius: 10, background: isFastest ? `${sc}08` : 'transparent', opacity: entry.eliminated ? 0.45 : 1 }}>
                                    <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: isFastest ? sc : C.textMid, fontWeight: isFastest ? 700 : 500 }}>P{entry.position}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                      <div style={{ width: 3, height: 12, borderRadius: 2, background: `#${entry.team_colour}`, flexShrink: 0 }} />
                                      <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: isFastest ? C.textBright : C.textSub, fontWeight: isFastest ? 700 : 500 }}>{entry.abbreviation}</span>
                                    </div>
                                    <span style={{ fontSize: 9, fontFamily: 'Inter, sans-serif', color: C.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.team_name}</span>
                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: isFastest ? C.textBright : C.textSub, fontWeight: isFastest ? 700 : 500 }}>{fmtMs(entry.lap_time_ms)}</div>
                                      {entry.gap_ms > 0 && <div style={{ fontSize: 8, color: C.textDim, fontFamily: 'JetBrains Mono, monospace' }}>+{(entry.gap_ms / 1000).toFixed(3)}</div>}
                                    </div>
                                    {(['s1_ms', 's2_ms', 's3_ms'] as const).map(sk => (
                                      <span key={sk} style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: C.textMid, textAlign: 'right' }}>{entry[sk] ? (entry[sk]! / 1000).toFixed(3) : '—'}</span>
                                    ))}
                                  </div>
                                  {showCut && (
                                    <div style={{ height: 1, background: C.red, opacity: 0.3, margin: '4px 0', position: 'relative' }}>
                                      <span style={{ position: 'absolute', right: 0, top: -9, fontSize: 7, color: C.red, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, letterSpacing: '0.12em' }}>ELIMINATION ↓</span>
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

                <QualiSpeedPanel sessionKey={sessionKey} />
              </div>
            </CollapsibleSection>
              </>
            )}
          </div>
        )}

      </div>

      <style>{`@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }`}</style>
    </div>
  )
}
