import { C } from '@/components/telemetry/telemetry-ui'
import type { Interp } from '@/lib/telemetry-math'

// ── Canvas drawing ────────────────────────────────────────────────────────────
export const PAD = { top: 16, right: 20, bottom: 32, left: 56 }

export function chartCoords(W: number, H: number) {
  return { cW: W - PAD.left - PAD.right, cH: H - PAD.top - PAD.bottom }
}

export function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, yMin: number, yMax: number, gridCount: number, isRpm: boolean, xLabel?: (progress: number) => string) {
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

export type DriverRenderData = { interp: Interp; colour: string; abbr: string }

export function drawSpeedGapFill(ctx: CanvasRenderingContext2D, W: number, H: number, driverData: DriverRenderData[], yMin: number, yMax: number) {
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

export function drawLine(ctx: CanvasRenderingContext2D, vals: number[], colour: string, W: number, H: number, yMin: number, yMax: number, lw = 1.8, dashed = false, smooth = true) {
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

export function drawCrosshair(ctx: CanvasRenderingContext2D, nx: number, W: number, H: number) {
  const { cW, cH } = chartCoords(W, H)
  const cx = PAD.left + nx * cW
  ctx.beginPath(); ctx.strokeStyle = C.crosshair; ctx.lineWidth = 1
  ctx.setLineDash([4, 4]); ctx.moveTo(cx, PAD.top); ctx.lineTo(cx, PAD.top + cH); ctx.stroke(); ctx.setLineDash([])
}

export function drawDots(ctx: CanvasRenderingContext2D, nx: number, W: number, H: number, driverData: DriverRenderData[], field: string, yMin: number, yMax: number) {
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

export const CHARTS = [
  { label: 'SPEED', unit: 'km/h', field: 'speed', yMin: 60, yMax: 360, height: 420, gridCount: 6, isRpm: false },
  { label: 'THROTTLE', unit: '%', field: 'throttle', yMin: 0, yMax: 100, height: 220, gridCount: 4, isRpm: false },
  { label: 'RPM', unit: 'rpm', field: 'rpm', yMin: 6000, yMax: 13000, height: 140, gridCount: 5, isRpm: true },
  { label: 'BRAKE', unit: '', field: 'brake', yMin: 0, yMax: 100, height: 120, gridCount: 2, isRpm: false },
]

