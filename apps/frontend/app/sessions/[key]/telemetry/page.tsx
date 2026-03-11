'use client'

import { use, useEffect, useRef, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { teamColour, formatLapTime } from '@/lib/utils'
import type { Driver, TelemetrySample } from '@/types/f1'
import CornerAnalysis from '@/components/telemetry/CornerAnalysis'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── CHANGE 1 ─────────────────────────────────────────────────────────────────
// fetchTelemetryCompare now also returns lap_number per driver.
// We need this so we can look up the *correct* lap's sector times from the DB.
// Previously we were throwing away the lap_number — now we surface it.
async function fetchTelemetryCompare(
  sessionKey: number,
  drivers: number[]
): Promise<{ samples: any[]; lapNumbers: Map<number, number> }> {
  const res = await fetch(
    `${BASE}/api/v1/sessions/${sessionKey}/telemetry/compare?drivers=${drivers.join(',')}`
  )
  if (!res.ok) throw new Error(`telemetry ${res.status}`)
  const data = await res.json()

  const lapNumbers = new Map<number, number>()
  let samples: any[] = []

  if (Array.isArray(data)) {
    // Flat array — no lap_number metadata available, fall back gracefully
    samples = data
  } else {
    // Shape: { "44": { lap_number: 24, samples: [...] }, "63": { ... } }
    samples = Object.entries(data).flatMap(([dn, val]: [string, any]) => {
      const driverNum = parseInt(dn)
      const rows = Array.isArray(val) ? val : (val?.samples ?? [])
      if (val?.lap_number) lapNumbers.set(driverNum, val.lap_number)
      return rows.map((r: any) => ({ ...r, driver_number: driverNum }))
    })
  }

  return { samples, lapNumbers }
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CHART_BG    = '#0A0A0A'
const AXIS_COLOR  = '#1E1E1E'
const TEXT_DIM    = '#3F3F46'
const TEXT_MID    = '#71717A'
const RED_ACCENT  = '#E8002D'
const GREEN_DRS   = '#22FF88'
const BRAKE_COLOR = '#FF2D55'
const CROSSHAIR   = 'rgba(255,255,255,0.12)'

// ── Interpolation ─────────────────────────────────────────────────────────────
type Interp = {
  dist: number[]; speed: number[]; throttle: number[];
  gear: number[]; rpm: number[]; brake: boolean[]; drs: number[];
  x: number[]; y: number[];
}

function interpolateSamples(samples: TelemetrySample[], points = 400): Interp {
  if (!samples.length) return { dist:[], speed:[], throttle:[], gear:[], rpm:[], brake:[], drs:[], x:[], y:[] }
  const sorted  = [...samples].sort((a, b) => a.distance_m - b.distance_m)
  const minDist = sorted[0].distance_m
  const maxDist = sorted[sorted.length - 1].distance_m
  const step    = (maxDist - minDist) / (points - 1)
  const dist    = Array.from({ length: points }, (_, i) => minDist + i * step)

  function lerp(field: keyof TelemetrySample, d: number): number {
    const idx = sorted.findIndex(s => s.distance_m >= d)
    if (idx <= 0) return (sorted[0]?.[field] as number) ?? 0
    const a = sorted[idx - 1], b = sorted[idx]
    const t = (d - a.distance_m) / ((b.distance_m - a.distance_m) || 1)
    return ((a[field] as number) ?? 0) * (1 - t) + ((b[field] as number) ?? 0) * t
  }

  return {
    dist,
    speed:    dist.map(d => lerp('speed_kmh', d)),
    throttle: dist.map(d => lerp('throttle_pct', d)),
    gear:     dist.map(d => Math.round(lerp('gear', d))),
    rpm:      dist.map(d => lerp('rpm', d)),
    brake:    dist.map(d => lerp('brake' as any, d) > 0.5),
    drs:      dist.map(d => lerp('drs', d)),
    x:        dist.map(d => lerp('x_pos' as any, d)),
    y:        dist.map(d => lerp('y_pos' as any, d)),
  }
}

// ── Drawing helpers ───────────────────────────────────────────────────────────
const PAD = { top: 10, right: 10, bottom: 26, left: 48 }

function chartCoords(W: number, H: number) {
  return {
    cW:  W - PAD.left - PAD.right,
    cH:  H - PAD.top  - PAD.bottom,
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

  ctx.fillStyle = CHART_BG
  ctx.fillRect(0, 0, W, H)

  for (let i = 0; i <= gridCount; i++) {
    const y = PAD.top + cH - (i / gridCount) * cH
    ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
    ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
    const val = yMin + (i / gridCount) * (yMax - yMin)
    ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
    ctx.fillText(isRpm ? `${(val/1000).toFixed(0)}k` : Math.round(val).toString(), PAD.left - 6, y + 3)
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
    const x  = PAD.left + nx * cW
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
    const cy = PAD.top  + cH - ny * cH
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
    const vals = (interp as any)[field] as number[]
    const idx  = Math.round(nx * (vals.length - 1))
    const v    = vals[idx] ?? 0
    const ny   = (v - yMin) / (yMax - yMin)
    const cy   = PAD.top + cH - ny * cH
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2)
    ctx.fillStyle = colour; ctx.fill()
    ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5; ctx.stroke()
  })
}

type DriverRenderData = { interp: Interp; colour: string; abbr: string }

// ── Chart configs ─────────────────────────────────────────────────────────────
const CHARTS = [
  { label: 'SPEED',    unit: 'km/h', field: 'speed',    yMin: 60,   yMax: 360,   height: 200, gridCount: 6, isRpm: false },
  { label: 'THROTTLE', unit: '%',    field: 'throttle', yMin: 0,    yMax: 100,   height: 120, gridCount: 4, isRpm: false },
  { label: 'GEAR',     unit: '1–8',  field: 'gear',     yMin: 1,    yMax: 8,     height: 100, gridCount: 7, isRpm: false },
  { label: 'RPM',      unit: 'rpm',  field: 'rpm',      yMin: 4000, yMax: 13000, height: 130, gridCount: 5, isRpm: true  },
]

// ── CHANGE 2 ─────────────────────────────────────────────────────────────────
// Type for the sector times we'll fetch from the laps API.
// s1_ms / s2_ms / s3_ms come from FastF1 → lap_times table.
type DriverSectorTimes = {
  s1_ms: number | null
  s2_ms: number | null
  s3_ms: number | null
  lap_number: number
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TelemetryPage({ params }: { params: Promise<{ key: string }> }) {
  const { key }    = use(params)
  const sessionKey = parseInt(key)

  const [drivers,      setDrivers]      = useState<Driver[]>([])
  const [selected,     setSelected]     = useState<number[]>([])
  const [telData,      setTelData]      = useState<Map<number, Interp>>(new Map())
  const [tooltipNx,    setTooltipNx]    = useState<number | null>(null)
  const [tooltipData,  setTooltipData]  = useState<{ dist: number; values: any[] } | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [sessionYear,  setSessionYear]  = useState<number | null>(null)

  // ── CHANGE 2 (cont.) ───────────────────────────────────────────────────────
  // New state: Map<driverNumber, DriverSectorTimes>
  // Populated after telemetry loads — we need lap_number from telemetry first
  // so we fetch the right lap's sector times, not just the fastest on record.
  const [sectorTimes, setSectorTimes] = useState<Map<number, DriverSectorTimes>>(new Map())
  // Also store lap_numbers from the telemetry response (which lap's telemetry we're showing)
  const [telLapNumbers, setTelLapNumbers] = useState<Map<number, number>>(new Map())

  const is2026 = sessionYear === 2026

  const chartRefs    = useRef<(HTMLCanvasElement | null)[]>([null, null, null, null])
  const deltaRef     = useRef<HTMLCanvasElement | null>(null)
  const drsRef       = useRef<HTMLCanvasElement | null>(null)
  const trackRef     = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Load drivers + session year
  useEffect(() => {
    api.sessions.get(sessionKey).then(s => setSessionYear(s.year)).catch(() => {})
    api.drivers.list(sessionKey).then(d => {
      setDrivers(d)
      if (d.length >= 2) setSelected([d[0].driver_number, d[1].driver_number])
    })
  }, [sessionKey])

  // ── CHANGE 2 (cont.) ───────────────────────────────────────────────────────
  // Load telemetry — now also captures lap_numbers from the response
  // so we know exactly which lap each driver's telemetry corresponds to.
  useEffect(() => {
    if (!selected.length) return
    setLoading(true)
    fetchTelemetryCompare(sessionKey, selected)
      .then(({ samples, lapNumbers }) => {
        // Store which lap number the telemetry is for, per driver
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
  }, [sessionKey, selected.join(',')])

  // ── CHANGE 2 (cont.) ───────────────────────────────────────────────────────
  // Fetch real sector times once we know which lap numbers the telemetry uses.
  // We call GET /api/v1/sessions/<key>/laps?driver=<num> for each selected driver,
  // then pick the lap that matches the telemetry lap_number.
  //
  // WHY a separate useEffect? Because telLapNumbers is set async after telemetry loads.
  // We need to wait for both: (1) selected drivers, (2) their telemetry lap numbers.
  useEffect(() => {
    if (!selected.length || !telLapNumbers.size) return

    const fetchAll = selected.map(async (driverNum) => {
      try {
        // api.laps.list returns Lap[] — each has lap_number, s1_ms, s2_ms, s3_ms
        const laps = await api.laps.list(sessionKey, driverNum)
        const telLap = telLapNumbers.get(driverNum)

        // Find the lap matching the one shown in telemetry
        // Fall back to the overall fastest lap if no match (edge case)
        const matchedLap = laps.find(l => l.lap_number === telLap)
          ?? laps.reduce((best, l) =>
            (l.lap_time_ms ?? Infinity) < (best.lap_time_ms ?? Infinity) ? l : best
          , laps[0])

        if (!matchedLap) return null

        return {
          driverNum,
          times: {
            s1_ms:      matchedLap.s1_ms      ?? null,
            s2_ms:      matchedLap.s2_ms      ?? null,
            s3_ms:      matchedLap.s3_ms      ?? null,
            lap_number: matchedLap.lap_number,
          } as DriverSectorTimes,
        }
      } catch {
        return null
      }
    })

    Promise.all(fetchAll).then(results => {
      const map = new Map<number, DriverSectorTimes>()
      results.forEach(r => { if (r) map.set(r.driverNum, r.times) })
      setSectorTimes(map)
    })
  }, [sessionKey, selected.join(','), telLapNumbers])

  // Build driver render data
  const driverData: DriverRenderData[] = selected
    .map(dn => {
      const interp = telData.get(dn)
      const d      = drivers.find(x => x.driver_number === dn)
      if (!interp || !d) return null
      return { interp, colour: teamColour(d.team_colour, d.team_name), abbr: d.abbreviation }
    })
    .filter(Boolean) as DriverRenderData[]

  const sectorLines = [1/3, 2/3]

  // ── Render all canvases ────────────────────────────────────────────────────
  useEffect(() => {
    if (!driverData.length) return
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
      const ctx  = canvas.getContext('2d')!
      const a    = driverData[0].interp.speed
      const b    = driverData[1].interp.speed
      const n    = Math.min(a.length, b.length)
      const deltas  = Array.from({ length: n }, (_, i) => a[i] - b[i])
      const maxD    = Math.max(...deltas.map(Math.abs), 15)
      const { cW, cH } = chartCoords(W, 120)
      const midY   = PAD.top + cH / 2

      ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, 120)
      ctx.beginPath(); ctx.strokeStyle = '#333'; ctx.lineWidth = 1
      ctx.moveTo(PAD.left, midY); ctx.lineTo(PAD.left + cW, midY); ctx.stroke()
      for (const m of [-1, -0.5, 0.5, 1]) {
        const y  = PAD.top + cH / 2 - m * cH / 2
        const lv = (m * maxD).toFixed(0)
        ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
        ctx.fillText(lv, PAD.left - 6, y + 3)
        ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
        ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(PAD.left, midY)
      deltas.forEach((d, i) => {
        ctx.lineTo(PAD.left + (i/(n-1)) * cW, midY - (d/maxD) * (cH/2))
      })
      ctx.lineTo(PAD.left + cW, midY); ctx.closePath()
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH)
      grad.addColorStop(0,   driverData[0].colour + '44')
      grad.addColorStop(0.5, '#0A0A0A')
      grad.addColorStop(1,   driverData[1].colour + '44')
      ctx.fillStyle = grad; ctx.fill()
      ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
      deltas.forEach((d, i) => {
        const cx = PAD.left + (i/(n-1)) * cW
        const cy = midY - (d/maxD) * (cH/2)
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy)
      })
      ctx.stroke()
      ctx.fillStyle = driverData[0].colour + 'CC'; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'left'
      ctx.fillText(`▲ ${driverData[0].abbr} faster`, PAD.left + 6, PAD.top + 14)
      ctx.fillStyle = driverData[1].colour + 'CC'
      ctx.fillText(`▼ ${driverData[1].abbr} faster`, PAD.left + 6, PAD.top + cH - 6)
      if (tooltipNx !== null) {
        const cx  = PAD.left + tooltipNx * cW
        const idx = Math.round(tooltipNx * (n-1))
        const d   = deltas[idx] ?? 0
        const cy  = midY - (d/maxD) * (cH/2)
        ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
        ctx.moveTo(cx, PAD.top); ctx.lineTo(cx, PAD.top + cH); ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI*2)
        ctx.fillStyle = d >= 0 ? driverData[0].colour : driverData[1].colour
        ctx.fill(); ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5; ctx.stroke()
        const label = `${d >= 0 ? '+' : ''}${d.toFixed(1)} km/h`
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px JetBrains Mono, monospace'
        ctx.textAlign = cx > PAD.left + cW/2 ? 'right' : 'left'
        ctx.fillText(label, cx + (cx > PAD.left + cW/2 ? -10 : 10), PAD.top + 22)
      }
    }

    // DRS chart
    if (drsRef.current) {
      const canvas = drsRef.current
      const rowH   = 20
      const totalH = driverData.length * (rowH + 6) + PAD.top + PAD.bottom
      canvas.width = W; canvas.height = totalH
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, totalH)
      const { cW } = chartCoords(W, totalH)

      driverData.forEach(({ interp, colour, abbr }, di) => {
        const y = PAD.top + di * (rowH + 6)
        ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
        ctx.fillText(abbr, PAD.left - 6, y + rowH/2 + 4)
        ctx.fillStyle = '#1A1A1A'
        ctx.beginPath(); ctx.roundRect?.(PAD.left, y, cW, rowH, 3); ctx.fill()
        const n = interp.drs.length
        let inDrs = false, ds = 0
        interp.drs.forEach((v, i) => {
          const open = v > 8
          if (open && !inDrs) { inDrs = true; ds = i }
          if (!open && inDrs) {
            inDrs = false
            const x1 = PAD.left + (ds/(n-1)) * cW
            const x2 = PAD.left + (i/(n-1)) * cW
            ctx.fillStyle = GREEN_DRS
            ctx.beginPath(); ctx.roundRect?.(x1, y, x2-x1, rowH, 2); ctx.fill()
          }
        })
        if (inDrs) {
          const x1 = PAD.left + (ds/(n-1)) * cW
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
      const scale = Math.min((W - mapPad*2) / (xMax - xMin || 1), (340 - mapPad*2) / (yMax - yMin || 1)) * 0.9
      const offX  = (W   - (xMax - xMin) * scale) / 2 - xMin * scale
      const offY  = (340 - (yMax - yMin) * scale) / 2 - yMin * scale
      const tx    = (x: number) => x * scale + offX
      const ty    = (y: number) => y * scale + offY

      ctx.beginPath()
      xs.forEach((x, i) => i === 0 ? ctx.moveTo(tx(x), ty(ys[i])) : ctx.lineTo(tx(x), ty(ys[i])))
      ctx.closePath()
      ctx.strokeStyle = '#2A2A2A'; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke()

      const sectColours = ['#E8002D55', '#FFD70055', '#B347FF55']
      sectColours.forEach((col, si) => {
        const s = Math.floor(si * n / 3), e = Math.floor((si + 1) * n / 3)
        ctx.beginPath()
        for (let i = s; i <= e; i++) i === s ? ctx.moveTo(tx(xs[i]), ty(ys[i])) : ctx.lineTo(tx(xs[i]), ty(ys[i]))
        ctx.strokeStyle = col; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke()
      })

      let inB = false, bs = 0
      interp.brake.forEach((b, i) => {
        if (b && !inB) { inB = true; bs = i }
        if (!b && inB) {
          inB = false
          ctx.beginPath()
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

      ctx.beginPath(); ctx.arc(tx(xs[0]), ty(ys[0]), 5, 0, Math.PI*2)
      ctx.fillStyle = '#fff'; ctx.fill()
    }
  }, [driverData.map(d => d.abbr).join(','), tooltipNx, telData])

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cW   = rect.width - PAD.left - PAD.right
    const nx   = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / cW))
    setTooltipNx(nx)
    if (!driverData.length) return
    const n   = driverData[0].interp.dist.length
    const idx = Math.round(nx * (n - 1))
    setTooltipData({
      dist:   driverData[0].interp.dist[idx],
      values: driverData.map(d => ({
        abbr:     d.abbr,
        colour:   d.colour,
        speed:    d.interp.speed[idx]    ?? 0,
        throttle: d.interp.throttle[idx] ?? 0,
        gear:     d.interp.gear[idx]     ?? 0,
        rpm:      d.interp.rpm[idx]      ?? 0,
        brake:    d.interp.brake[idx]    ?? false,
      })),
    })
  }, [driverData])

  const handleMouseLeave = useCallback(() => {
    setTooltipNx(null); setTooltipData(null)
  }, [])

  const toggleDriver = (dn: number) =>
    setSelected(prev => prev.includes(dn)
      ? prev.filter(d => d !== dn)
      : prev.length < 4 ? [...prev, dn] : prev)

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>

      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '32px', color: '#fff', lineHeight: 1 }}>
          Speed Traces
        </h1>
        <p style={{ color: '#52525B', fontSize: '13px', marginTop: '4px', fontFamily: 'monospace' }}>
          Fastest lap telemetry — distance-aligned overlay
        </p>
      </div>

      {/* Driver selector */}
      <div style={{
        background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px',
        padding: '14px 16px', marginBottom: '10px',
      }}>
        <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: '10px' }}>
          DRIVERS (MAX 4)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {drivers.map(d => {
            const isSel  = selected.includes(d.driver_number)
            const colour = teamColour(d.team_colour, d.team_name)
            return (
              <button key={d.driver_number} onClick={() => toggleDriver(d.driver_number)} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '20px', cursor: 'pointer',
                border:      isSel ? `1.5px solid ${colour}` : '1.5px solid #2A2A2A',
                background:  isSel ? `${colour}18` : 'transparent',
                color:       isSel ? '#fff' : '#52525B',
                fontSize:    '12px', fontWeight: isSel ? 700 : 400,
                fontFamily:  'monospace', transition: 'all 0.12s',
              }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: colour, display: 'inline-block' }} />
                {d.abbreviation}
                {isSel && <span style={{ color: colour, fontSize: '10px' }}>×</span>}
              </button>
            )
          })}
        </div>
        {driverData.length > 0 && (
          <div style={{ display: 'flex', gap: '24px', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #1A1A1A' }}>
            {driverData.map(d => (
              <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '24px', height: '2px', background: d.colour }} />
                <span style={{ fontSize: '12px', fontFamily: 'monospace', color: '#A1A1AA', fontWeight: 600 }}>{d.abbr}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px' }}>
          Loading telemetry...
        </div>
      )}

      {!loading && driverData.length > 0 && (
        <>
          {/* Floating tooltip */}
          {tooltipData && (
            <div style={{
              position: 'fixed', left: 80, top: 80, zIndex: 200, pointerEvents: 'none',
              background: '#111111ee', border: '1px solid #2A2A2A', borderRadius: '10px',
              padding: '10px 14px', backdropFilter: 'blur(8px)',
            }}>
              <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', marginBottom: '8px' }}>
                {(tooltipData.dist / 1000).toFixed(2)} km
              </div>
              {tooltipData.values.map((v: any) => (
                <div key={v.abbr} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '6px' }}>
                  <div style={{ width: '3px', height: '32px', borderRadius: '2px', background: v.colour, flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <div style={{ fontSize: '10px', color: v.colour, fontFamily: 'monospace', fontWeight: 700 }}>{v.abbr}</div>
                    <div style={{ fontSize: '14px', fontFamily: 'monospace', color: '#fff', fontWeight: 700 }}>{v.speed.toFixed(0)} km/h</div>
                    <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#71717A' }}>
                      G{v.gear} · {v.throttle.toFixed(0)}% thr · {(v.rpm/1000).toFixed(1)}k
                      {v.brake && <span style={{ color: BRAKE_COLOR, marginLeft: '6px', fontWeight: 700 }}>BRAKE</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Speed / Throttle / Gear / RPM charts */}
          {CHARTS.map((cfg, i) => (
            <div key={cfg.field} style={{
              background: '#111111', border: '1px solid #2A2A2A',
              borderRadius: '12px', overflow: 'hidden', marginBottom: '8px',
            }}>
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
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden', marginBottom: '8px' }}>
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

          {/* DRS Open — hidden for 2026 (no DRS in new regs) */}
          {!is2026 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden', marginBottom: '8px' }}>
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

          {/* ── CHANGE 3 ────────────────────────────────────────────────────────
              SECTOR TIMES — replaces the old "sector speed average" block.

              What changed and why:
              - Old: sliced telemetry speed arrays into thirds, averaged speed.
                That was a proxy metric, not a real sector time.
              - New: reads s1_ms / s2_ms / s3_ms from the lap_times DB table
                via GET /laps?driver=N, for the exact lap shown in telemetry.
              - formatLapTime(ms) from utils.ts formats ms → "23.456s" correctly.
              - Delta shown in ms, formatted to 3 decimal places in seconds.
              - If sector data hasn't loaded yet, we show a subtle skeleton.
          ── */}
          {driverData.length >= 2 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '12px 16px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
                <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>
                  SECTOR TIMES
                </span>
                <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>
                  fastest telemetry lap · from timing data
                </span>
              </div>

              {/* Sector rows — one per S1 / S2 / S3 */}
              {(() => {
                const SECTOR_KEYS   = ['s1_ms', 's2_ms', 's3_ms'] as const
                const SECTOR_LABELS = ['S1', 'S2', 'S3']
                const SECTOR_COLOURS = ['#E8002D', '#FFD700', '#B347FF']
                const hasSectorData = sectorTimes.size > 0

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {SECTOR_KEYS.map((key, si) => {
                      const label = SECTOR_LABELS[si]
                      const sCol  = SECTOR_COLOURS[si]

                      // Collect each driver's sector time for this sector
                      const driverSectors = driverData.map(d => {
                        const dn    = drivers.find(x => x.abbreviation === d.abbr)?.driver_number
                        const times = dn !== undefined ? sectorTimes.get(dn) : undefined
                        return {
                          abbr:   d.abbr,
                          colour: d.colour,
                          ms:     times?.[key] ?? null,
                        }
                      })

                      // Find the fastest time in this sector across shown drivers
                      const validMs   = driverSectors.map(d => d.ms).filter((v): v is number => v !== null)
                      const fastestMs = validMs.length ? Math.min(...validMs) : null
                      const slowestMs = validMs.length ? Math.max(...validMs) : null
                      const deltaMs   = fastestMs !== null && slowestMs !== null ? slowestMs - fastestMs : null

                      return (
                        <div key={si}>
                          {/* Sector header */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <div style={{
                              width: '4px', height: '16px', borderRadius: '2px',
                              background: sCol, flexShrink: 0,
                            }} />
                            <span style={{ fontSize: '10px', fontFamily: 'monospace', fontWeight: 700, color: sCol, letterSpacing: '0.08em' }}>
                              {label}
                            </span>
                            {deltaMs !== null && deltaMs > 0 && (
                              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B', marginLeft: 'auto' }}>
                                Δ {(deltaMs / 1000).toFixed(3)}s
                              </span>
                            )}
                          </div>

                          {/* Per-driver time rows */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '14px' }}>
                            {driverSectors.map(({ abbr, colour, ms }) => {
                              const isFastest = ms !== null && ms === fastestMs
                              const isLoading = !hasSectorData

                              // Bar width: fastest driver = 100%, slowest = 60%.
                              // We invert the delta so a lower (better) time = wider bar.
                              // Formula: fastest gets (slowestMs - fastestMs) / range = 1.0 → 100%
                              //          slowest gets 0 / range = 0.0 → 60%
                              const barPct = ms !== null && fastestMs !== null && slowestMs !== null
                                ? 60 + ((slowestMs - ms) / ((slowestMs - fastestMs) || 1)) * 40
                                : 60

                              return (
                                <div key={abbr} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  {/* Driver abbreviation */}
                                  <span style={{
                                    width: '30px', fontSize: '10px', fontFamily: 'monospace',
                                    color: isFastest ? '#fff' : '#52525B', flexShrink: 0, fontWeight: isFastest ? 700 : 400,
                                  }}>
                                    {abbr}
                                  </span>

                                  {/* Bar */}
                                  <div style={{ flex: 1, height: '18px', background: '#1A1A1A', borderRadius: '4px', overflow: 'hidden' }}>
                                    {isLoading ? (
                                      // Skeleton shimmer while data loads
                                      <div style={{
                                        width: '40%', height: '100%', borderRadius: '4px',
                                        background: `linear-gradient(90deg, #1A1A1A 25%, #2A2A2A 50%, #1A1A1A 75%)`,
                                        backgroundSize: '200% 100%',
                                        animation: 'shimmer 1.4s infinite',
                                      }} />
                                    ) : (
                                      <div style={{
                                        width: `${barPct}%`, height: '100%', borderRadius: '4px',
                                        background: isFastest ? colour : colour + '40',
                                        transition: 'width 0.4s ease',
                                      }} />
                                    )}
                                  </div>

                                  {/* Sector time */}
                                  <span style={{
                                    width: '64px', textAlign: 'right', fontSize: '11px',
                                    fontFamily: 'monospace', fontWeight: isFastest ? 700 : 400,
                                    color: isFastest ? '#fff' : '#52525B', flexShrink: 0,
                                  }}>
                                    {ms !== null ? formatLapTime(ms) : '—'}
                                  </span>

                                  {/* Fastest indicator */}
                                  {isFastest && (
                                    <span style={{ fontSize: '8px', fontFamily: 'monospace', color: sCol, width: '14px', flexShrink: 0 }}>
                                      ▲
                                    </span>
                                  )}
                                </div>
                              )
                            })}
                          </div>

                          {/* Divider between sectors */}
                          {si < 2 && (
                            <div style={{ height: '1px', background: '#1A1A1A', marginTop: '10px' }} />
                          )}
                        </div>
                      )
                    })}

                    {/* Footer legend */}
                    <div style={{ display: 'flex', gap: '16px', paddingTop: '8px', borderTop: '1px solid #1A1A1A', alignItems: 'center' }}>
                      {driverData.map(d => (
                        <div key={d.abbr} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                          <div style={{ width: '12px', height: '4px', borderRadius: '2px', background: d.colour }} />
                          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#71717A' }}>{d.abbr}</span>
                        </div>
                      ))}
                      <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', marginLeft: 'auto' }}>
                        ▲ fastest in sector
                      </span>
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

          {/* Corner Analysis */}
          <CornerAnalysis
            sessionKey={sessionKey}
            drivers={selected}
            driverMap={Object.fromEntries(
              drivers.map(d => [d.driver_number, { abbreviation: d.abbreviation, team_colour: d.team_colour }])
            )}
          />
        </>
      )}

      {/* Shimmer keyframe — injected once, used by sector skeleton */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  )
}