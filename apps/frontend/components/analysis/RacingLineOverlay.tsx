'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { vec2, sub, cross2, length, normalize } from '@/lib/geometry';


type CornerStats = {
    corner_number: number;
    brake_point_dist_m: number;
    braking_dist_m: number;
    decel_rate: number;
    apex_speed_kmh: number;
    exit_speed_kmh: number | null;
    apex_x : number;
    apex_y : number;
    apex_dist_m: number;
}

type MatchedCorner = {
    corner_number: number;
    apex_x: number;
    apex_y: number;
    apex_dist_m: number;
    driver: Record<string, CornerStats>;
    delta: { braking_point_m: number} | null;
}

type CompareStats = {
    session_key: number;
    driver_keys: string[];
    matched_corners: MatchedCorner[];
}

type Interp = {
    dist: number[]; speed: number[]; throttle: number[];
    gear: number[]; rpm: number[]; brake: number[]; drs: number[];
    x: number[]; y: number[];
}

type DriverRenderData = { 
    interp: Interp;
    colour: string;
    abbr: string;
}

type CornerDeviation = {
    dist: number[];
    xA: number[]; yA: number[];
    xB: number[]; yB: number[];
    deviation: number[];
    signedDeviation: number[];
    maxDeviation: number;
}

/// The design tokens used in the RacingLineOverlay component.
const C = {
  surface: '#FFFFFF',
  surfaceAlt: '#F5F7FB',
  border: '#D9E3EF',
  borderMid: '#C5D2E3',
  textDim: '#7D8BA2',
  textMid: '#56657C',
  textBright: '#13233D',
  red: '#E8002D',
  green: '#10B981',
} as const

const BASE = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const CORNER_WINDOW_BEFORE = 150  // metres before apex
const CORNER_WINDOW_AFTER = 100   // metres after apex
const WINDOW_SAMPLE_POINTS = 100  // interpolation resolution

// --- HELPER FUNCTIONS ---

function interpAtDist(dist: number[], vals: number[], d: number): number {
  // Binary search for segment containing d, then linear interpolate
  if (d <= dist[0]) return vals[0]
  if (d >= dist[dist.length - 1]) return vals[vals.length - 1]
  let lo = 0, hi = dist.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (dist[mid] <= d) lo = mid
    else hi = mid
  }
  const t = (d - dist[lo]) / (dist[hi] - dist[lo] || 1)
  return vals[lo] + (vals[hi] - vals[lo]) * t
}

function heatmapColor(t: number): string {
  // t=0 → green, t=0.5 → yellow, t=1 → red
  const r = Math.round(Math.min(1, t * 2) * 255)
  const g = Math.round(Math.min(1, (1 - t) * 2) * 255)
  return `rgb(${r},${g},0)`
}


export default function RacingLineOverlay({
    sessionKey,
    drivers, 
    driverData,
    compact= false,
} : {
    sessionKey: number;
    drivers: string[];
    driverData: DriverRenderData[];
    compact?: boolean;
}) {
    const [compareData, setCompareData] = useState<CompareStats | null>(null)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [loading, setLoading] = useState(false)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [error, setError] = useState<string | null>(null)
    const [selectedCorner, setSelectedCorner] = useState<number>(0)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)

    useEffect(() => {
        if (drivers.length < 2) {
            setCompareData(null)
            return
        }
            const abort = new AbortController()
                let active = true
                setLoading(true)
                setError(null)
                fetch(
                `${BASE}/api/v1/sessions/${sessionKey}/analysis/driver-compare-stats?drivers=${drivers.join(',')}`,
                { signal: abort.signal }
                )
                .then(r => { if (!r.ok) throw new Error('Failed')
                    return r.json()
                })
                .then((d: CompareStats) => {
                    if (!active) return
                    setCompareData(d)
                    // Default to first matched corner
                    if (d.matched_corners.length > 0) {
                    setSelectedCorner(prev =>
                        prev === 0 ? d.matched_corners[0].corner_number : prev
                    )
                    }
                })
                .catch(err => {
                    if (!active || err?.name === 'AbortError') return
                    setError(err instanceof Error ? err.message : 'Failed to load')
                })
                .finally(() => { if (active) setLoading(false) })

                return () => { active = false; abort.abort() }
            }, [sessionKey, drivers])


    const deviation = useMemo<CornerDeviation | null>(() => {
    if (!compareData || driverData.length < 2 || selectedCorner === 0) return null

    const corner = compareData.matched_corners.find(
      c => c.corner_number === selectedCorner
    )
    if (!corner) return null

    const interpA = driverData[0].interp
    const interpB = driverData[1].interp

    // Define window in distance space
    const winStart = corner.apex_dist_m - CORNER_WINDOW_BEFORE
    const winEnd = corner.apex_dist_m + CORNER_WINDOW_AFTER
    const step = (winEnd - winStart) / (WINDOW_SAMPLE_POINTS - 1)

    const dist: number[] = []
    const xA: number[] = []; const yA: number[] = []
    const xB: number[] = []; const yB: number[] = []
    const deviation: number[] = []
    const signedDeviation: number[] = []

    for (let i = 0; i < WINDOW_SAMPLE_POINTS; i++) {
      const d = winStart + i * step
      dist.push(d)
      xA.push(interpAtDist(interpA.dist, interpA.x, d))
      yA.push(interpAtDist(interpA.dist, interpA.y, d))
      xB.push(interpAtDist(interpB.dist, interpB.x, d))
      yB.push(interpAtDist(interpB.dist, interpB.y, d))

      const pA = vec2(xA[i], yA[i])
      const pB = vec2(xB[i], yB[i])
      const dev = length(sub(pA, pB))
      deviation.push(dev)

      // Signed deviation: cross product of A's direction vs vector to B
      if (i > 0) {
        const dir = normalize(sub(pA, vec2(xA[i-1], yA[i-1])))
        const toB = normalize(sub(pB, pA))
        signedDeviation.push(cross2(dir, toB) * dev)
      } else {
        signedDeviation.push(0)
      }
    }

    const maxDeviation = Math.max(...deviation, 0.01)

    return { dist, xA, yA, xB, yB, deviation, signedDeviation, maxDeviation }
  }, [compareData, driverData, selectedCorner])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !deviation) return

    const W = canvas.clientWidth || 600
    const H = compact ? 300 : 400
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#F8F9FC'
    ctx.fillRect(0, 0, W, H)

    const { xA, yA, xB, yB, deviation: dev, maxDeviation } = deviation
    const n = xA.length
    if (n < 2) return

    // ── Coordinate transform ────────────────────────────────────
    const allX = [...xA, ...xB]
    const allY = [...yA, ...yB]
    const minX = Math.min(...allX); const maxX = Math.max(...allX)
    const minY = Math.min(...allY); const maxY = Math.max(...allY)
    const pad = compact ? 28 : 40
    const trackW = maxX - minX || 1; const trackH = maxY - minY || 1
    const scale = Math.min((W - pad * 2) / trackW, (H - pad * 2) / trackH) * 0.9
    const offX = (W - trackW * scale) / 2
    const offY = (H - trackH * scale) / 2
    const tx = (x: number) => (x - minX) * scale + offX
    const ty = (y: number) => (y - minY) * scale + offY

    // ── Gap ribbon (deviation heatmap) ──────────────────────────
    for (let i = 0; i < n - 1; i++) {
      const midT = (dev[i] + dev[i + 1]) / 2 / maxDeviation
      ctx.beginPath()
      ctx.moveTo(tx(xA[i]), ty(yA[i]))
      ctx.lineTo(tx(xA[i + 1]), ty(yA[i + 1]))
      ctx.lineTo(tx(xB[i + 1]), ty(yB[i + 1]))
      ctx.lineTo(tx(xB[i]), ty(yB[i]))
      ctx.closePath()
      ctx.fillStyle = heatmapColor(midT)
      ctx.fill()
    }

    // ── Driver B path (dashed) ──────────────────────────────────
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(tx(xB[i]), ty(yB[i]))
      else ctx.lineTo(tx(xB[i]), ty(yB[i]))
    }
    ctx.strokeStyle = driverData[1]?.colour ?? '#666'
    ctx.lineWidth = 3
    ctx.setLineDash([6, 4])
    ctx.stroke()
    ctx.setLineDash([])

    // ── Driver A path (solid) ───────────────────────────────────
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(tx(xA[i]), ty(yA[i]))
      else ctx.lineTo(tx(xA[i]), ty(yA[i]))
    }
    ctx.strokeStyle = driverData[0]?.colour ?? '#666'
    ctx.lineWidth = 3
    ctx.stroke()

    // ── Apex marker ─────────────────────────────────────────────
    const corner = compareData?.matched_corners.find(
      c => c.corner_number === selectedCorner
    )
    if (corner) {
      const cx = tx(corner.apex_x); const cy = ty(corner.apex_y)
      ctx.beginPath()
      ctx.arc(cx, cy, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#FFFFFF'
      ctx.fill()
      ctx.strokeStyle = '#13233D'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#13233D'
      ctx.font = 'bold 10px "JetBrains Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`T${corner.corner_number}`, cx, cy - 10)
    }

    // ── Legend ──────────────────────────────────────────────────
    const legendY = H - 12
    const legendX = W - 140
    ctx.fillStyle = C.textDim
    ctx.font = '9px "JetBrains Mono", monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('Close', legendX, legendY)
    ctx.fillText('Far', legendX + 85, legendY)
    const grad = ctx.createLinearGradient(legendX + 32, 0, legendX + 80, 0)
    grad.addColorStop(0, heatmapColor(0))
    grad.addColorStop(0.5, heatmapColor(0.5))
    grad.addColorStop(1, heatmapColor(1))
    ctx.fillStyle = grad
    ctx.fillRect(legendX + 32, legendY - 4, 48, 8)

    // ── Scale bar ───────────────────────────────────────────────
    const metresPerPx = (maxX - minX) / (trackW * scale) || 1
    // Actually compute the scale: we know the physical distance in metres
    // between two x-axis points, and the pixel distance on screen
    const scaleMetres = 5 // show 5m scale
    const scalePx = scaleMetres / metresPerPx
    ctx.fillStyle = C.textDim
    ctx.font = '9px "JetBrains Mono", monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${scaleMetres}m`, pad, H - pad + 16)
    ctx.strokeStyle = C.textDim
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(pad, H - pad + 10)
    ctx.lineTo(pad + scalePx, H - pad + 10)
    ctx.stroke()
    // tick marks
    ctx.beginPath()
    ctx.moveTo(pad, H - pad + 6)
    ctx.lineTo(pad, H - pad + 14)
    ctx.moveTo(pad + scalePx, H - pad + 6)
    ctx.lineTo(pad + scalePx, H - pad + 14)
    ctx.stroke()

  }, [deviation, driverData, compact, compareData, selectedCorner])

  
        
}