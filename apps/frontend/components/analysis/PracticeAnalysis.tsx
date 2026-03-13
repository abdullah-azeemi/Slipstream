'use client'

import { useEffect, useRef, useState } from 'react'
import { teamColour, formatLapTime } from '@/lib/utils'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Types ─────────────────────────────────────────────────────────────────────

type LongRun = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  stint_num: number
  compound: string
  laps: number
  start_lap: number
  end_lap: number
  best_ms: number
  avg_ms: string
  stddev_ms: string
  deg_ms_per_lap: string
}

type TyreDegDriver = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  stint_num: number
  compound: string
  laps: number
  deg_ms_per_lap: string
  avg_ms: string
}

type TyreDegCompound = {
  compound: string
  avg_deg_ms_per_lap: string
  drivers_sampled: number
}

type DriverInfo = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHART_BG   = '#0A0A0A'
const AXIS_COLOR = '#1E1E1E'
const TEXT_DIM   = '#3F3F46'
const TEXT_MID   = '#71717A'

const COMPOUND_COLOUR: Record<string, string> = {
  SOFT: '#E8002D', MEDIUM: '#FFD700', HARD: '#FFFFFF',
  INTER: '#39B54A', WET: '#0067FF',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearCanvas(canvas: HTMLCanvasElement, W: number, H: number) {
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, H)
  return ctx
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PracticeAnalysis({
  sessionKey,
  drivers: allDrivers,
}: {
  sessionKey: number
  drivers: DriverInfo[]
}) {
  const [selected,     setSelected]     = useState<number[]>([])
  const [longRuns,     setLongRuns]     = useState<LongRun[]>([])
  const [degDrivers,   setDegDrivers]   = useState<TyreDegDriver[]>([])
  const [degCompounds, setDegCompounds] = useState<TyreDegCompound[]>([])
  const [loading,      setLoading]      = useState(false)

  const longRunRef   = useRef<HTMLCanvasElement | null>(null)
  const degRef       = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Init selection
  useEffect(() => {
    if (allDrivers.length >= 2) setSelected([allDrivers[0].driver_number, allDrivers[1].driver_number])
  }, [allDrivers.map(d => d.driver_number).join(',')])

  // Fetch
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/long-runs?min_laps=5`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/tyre-deg`).then(r => r.json()),
    ])
      .then(([runs, deg]) => {
        setLongRuns(Array.isArray(runs) ? runs : [])
        setDegDrivers(deg.per_driver ?? [])
        setDegCompounds(deg.per_compound ?? [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sessionKey])

  const toggleDriver = (dn: number) =>
    setSelected(prev =>
      prev.includes(dn) ? prev.filter(d => d !== dn) : prev.length < 4 ? [...prev, dn] : prev
    )

  // ── Draw long run pace chart ───────────────────────────────────────────────
  // Shows each driver's selected long stints as a lap-time trend line.
  // X = lap within stint (not absolute lap), Y = lap_time_ms.
  // Each run is an independent line segment.

  useEffect(() => {
    const canvas = longRunRef.current
    if (!canvas || !longRuns.length) return
    const W = containerRef.current?.clientWidth ?? 900
    const H = 320
    const ctx = clearCanvas(canvas, W, H)
    const PAD = { top: 24, right: 20, bottom: 44, left: 72 }
    const cW  = W - PAD.left - PAD.right
    const cH  = H - PAD.top  - PAD.bottom

    // Only show selected drivers (or all if none selected)
    const visibleRuns = longRuns.filter(r =>
      !selected.length || selected.includes(r.driver_number)
    )
    if (!visibleRuns.length) return

    // Y range from visible runs
    const allAvg = visibleRuns.map(r => parseFloat(r.avg_ms))
    const yMin   = Math.min(...visibleRuns.map(r => r.best_ms)) - 1_000
    const yMax   = Math.max(...allAvg) + 3_000

    // X range: longest stint length
    const maxStintLen = Math.max(...visibleRuns.map(r => r.laps))

    const toX = (lapInStint: number) => PAD.left + ((lapInStint - 1) / (maxStintLen - 1)) * cW
    const toY = (ms: number)          => PAD.top + cH - ((ms - yMin) / (yMax - yMin)) * cH

    // Grid
    for (let i = 0; i <= 5; i++) {
      const ms = yMin + (i / 5) * (yMax - yMin)
      const y  = toY(ms)
      ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
      ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
      ctx.fillText(formatLapTime(ms), PAD.left - 6, y + 3)
    }
    for (let l = 1; l <= maxStintLen; l += Math.max(1, Math.floor(maxStintLen / 8))) {
      const x = toX(l)
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
      ctx.fillText(String(l), x, H - 12)
    }
    ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText('LAP IN STINT', PAD.left + cW / 2, H - 2)

    // Each long run = one line segment
    visibleRuns.forEach(run => {
      const colour     = '#' + run.team_colour
      const compColour = COMPOUND_COLOUR[run.compound] ?? '#666'

      // We only have summary stats (avg, best, deg) not individual lap times.
      // Reconstruct a linear trend: start at best_ms, increase by deg_ms_per_lap each lap.
      const degPerLap = parseFloat(run.deg_ms_per_lap)
      // Estimate start of stint as slightly above best
      const startMs   = run.best_ms + Math.abs(degPerLap) * 0.5

      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.lineJoin = 'round'
      ctx.setLineDash([])
      for (let l = 1; l <= run.laps; l++) {
        const x  = toX(l)
        const ms = startMs + degPerLap * (l - 1)
        const y  = toY(Math.max(yMin, Math.min(yMax, ms)))
        l === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()

      // Compound badge at start
      const y0 = toY(startMs)
      ctx.beginPath(); ctx.arc(PAD.left, y0, 5, 0, Math.PI * 2)
      ctx.fillStyle = compColour; ctx.fill()
      ctx.beginPath(); ctx.arc(PAD.left, y0, 5, 0, Math.PI * 2)
      ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.stroke()

      // Driver label at end
      const endMs = startMs + degPerLap * (run.laps - 1)
      const xEnd  = toX(run.laps)
      const yEnd  = toY(Math.max(yMin, Math.min(yMax, endMs)))
      ctx.fillStyle = colour; ctx.font = 'bold 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'
      ctx.fillText(run.abbreviation, xEnd + 6, yEnd + 4)
    })
  }, [longRuns, selected])

  // ── Draw tyre degradation bar chart ───────────────────────────────────────
  // One horizontal bar per driver×stint, length = deg_ms_per_lap.

  useEffect(() => {
    const canvas = degRef.current
    if (!canvas || !degDrivers.length) return
    const W       = containerRef.current?.clientWidth ?? 900
    const visible = degDrivers.filter(d =>
      !selected.length || selected.includes(d.driver_number)
    )
    if (!visible.length) return

    const rowH   = 28
    const PAD    = { top: 16, right: 24, bottom: 32, left: 80 }
    const H      = PAD.top + visible.length * (rowH + 6) + PAD.bottom
    const ctx    = clearCanvas(canvas, W, H)
    const cW     = W - PAD.left - PAD.right

    // X range: 0 to max deg
    const maxDeg = Math.max(...visible.map(d => Math.abs(parseFloat(d.deg_ms_per_lap))), 100)

    // Grid verticals
    for (let i = 0; i <= 4; i++) {
      const x    = PAD.left + (i / 4) * cW
      const val  = (i / 4) * maxDeg
      ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
      ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + visible.length * (rowH + 6)); ctx.stroke()
      ctx.fillStyle = TEXT_DIM; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'center'
      ctx.fillText(`${val.toFixed(0)}ms`, x, H - 10)
    }
    ctx.fillStyle = TEXT_MID; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText('DEG ms / LAP', PAD.left + cW / 2, H - 2)

    visible.forEach((d, i) => {
      const y      = PAD.top + i * (rowH + 6)
      const colour = '#' + d.team_colour
      const degVal = parseFloat(d.deg_ms_per_lap)
      const barW   = Math.max(2, (Math.abs(degVal) / maxDeg) * cW)
      const compColour = COMPOUND_COLOUR[d.compound] ?? '#666'

      // Background track
      ctx.fillStyle = '#151515'
      ctx.beginPath(); ctx.roundRect?.(PAD.left, y, cW, rowH, 3); ctx.fill()

      // Bar
      const barColour = degVal > 100 ? '#E8002D' : degVal > 40 ? '#FFD700' : '#2CF4C5'
      ctx.beginPath(); ctx.roundRect?.(PAD.left, y, barW, rowH, 3); ctx.fill()
      ctx.fillStyle = barColour + '33'
      ctx.beginPath(); ctx.roundRect?.(PAD.left, y, barW, rowH, 3); ctx.fill()
      ctx.fillStyle = barColour
      ctx.beginPath(); ctx.roundRect?.(PAD.left, y, barW, rowH, 3); ctx.fill()

      // Driver label left
      ctx.fillStyle = colour; ctx.font = 'bold 10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
      ctx.fillText(d.abbreviation, PAD.left - 6, y + rowH / 2 + 4)

      // Compound dot
      ctx.beginPath(); ctx.arc(PAD.left - 26, y + rowH / 2, 5, 0, Math.PI * 2)
      ctx.fillStyle = compColour; ctx.fill()

      // Value label inside/outside bar
      const labelX = barW > 60 ? PAD.left + barW - 6 : PAD.left + barW + 6
      const align  = barW > 60 ? 'right' : 'left'
      ctx.fillStyle  = '#fff'; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = align
      ctx.fillText(`+${degVal.toFixed(1)}ms`, labelX, y + rowH / 2 + 4)
    })
  }, [degDrivers, selected])

  // ── Filtered long runs for list view ──────────────────────────────────────

  const visibleRuns = longRuns.filter(r =>
    !selected.length || selected.includes(r.driver_number)
  )

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

      {/* Header */}
      <div style={{ marginBottom: '4px' }}>
        <p style={{ color: '#52525B', fontSize: '13px', fontFamily: 'monospace', margin: 0 }}>
          Practice long-run analysis — race pace before anyone's cards are on the table
        </p>
      </div>

      {/* Driver selector */}
      <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
        <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: '10px' }}>
          FILTER DRIVERS (MAX 4)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {allDrivers.map(d => {
            const isSel  = selected.includes(d.driver_number)
            const colour = teamColour(d.team_colour, d.team_name)
            return (
              <button key={d.driver_number} onClick={() => toggleDriver(d.driver_number)} style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px',
                borderRadius: '20px', cursor: 'pointer', transition: 'all 0.12s',
                border:     isSel ? `1.5px solid ${colour}` : '1.5px solid #2A2A2A',
                background: isSel ? `${colour}18` : 'transparent',
                color:      isSel ? '#fff' : '#52525B',
                fontSize: '12px', fontWeight: isSel ? 700 : 400, fontFamily: 'monospace',
              }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: colour, display: 'inline-block' }} />
                {d.abbreviation}
                {isSel && <span style={{ color: colour, fontSize: '10px' }}>×</span>}
              </button>
            )
          })}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px' }}>
          Loading practice data...
        </div>
      )}

      {!loading && (
        <>
          {/* Long run pace chart */}
          <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 4px' }}>
              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>LONG RUN PACE</span>
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>stints ≥ 5 laps · linear deg trend · dot = compound</span>
            </div>
            {visibleRuns.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#3F3F46', fontFamily: 'monospace', fontSize: '12px' }}>
                No long runs found (≥ 5 consecutive laps)
              </div>
            ) : (
              <canvas ref={longRunRef} height={320} style={{ display: 'block', width: '100%' }} />
            )}
          </div>

          {/* Long run summary cards */}
          {visibleRuns.length > 0 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em', marginBottom: '12px' }}>
                LONG RUN SUMMARY
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {visibleRuns.map((run, i) => {
                  const colour    = teamColour(run.team_colour, run.team_name)
                  const compCol   = COMPOUND_COLOUR[run.compound] ?? '#666'
                  const degVal    = parseFloat(run.deg_ms_per_lap)
                  const degSign   = degVal >= 0 ? '+' : ''
                  const degColour = degVal > 100 ? '#E8002D' : degVal > 30 ? '#FFD700' : '#2CF4C5'
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 12px', background: '#0D0D0D',
                      borderRadius: '8px', border: '1px solid #1A1A1A',
                    }}>
                      <div style={{ width: '3px', height: '44px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: colour, fontWeight: 700 }}>{run.abbreviation}</span>
                          <span style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', background: compCol + '22', color: compCol, fontFamily: 'monospace', fontWeight: 700 }}>
                            {run.compound}
                          </span>
                          <span style={{ fontSize: '9px', color: '#3F3F46', fontFamily: 'monospace', marginLeft: 'auto' }}>
                            {run.laps} laps · L{run.start_lap}–{run.end_lap}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'baseline' }}>
                          <span style={{ fontSize: '15px', fontFamily: 'monospace', color: '#fff', fontWeight: 700 }}>
                            {formatLapTime(parseFloat(run.avg_ms))}
                          </span>
                          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: degColour }}>
                            {degSign}{degVal.toFixed(0)} ms/lap
                          </span>
                          <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>
                            best {formatLapTime(run.best_ms)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tyre degradation chart */}
          {degDrivers.length > 0 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 4px' }}>
                <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>TYRE DEGRADATION RATE</span>
                <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>ms lost per additional lap · lower = better</span>
              </div>
              <canvas ref={degRef} style={{ display: 'block', width: '100%' }} />
            </div>
          )}

          {/* Per-compound average */}
          {degCompounds.length > 0 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em', marginBottom: '12px' }}>
                COMPOUND AVERAGES
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {degCompounds.map(c => {
                  const col     = COMPOUND_COLOUR[c.compound] ?? '#666'
                  const degVal  = parseFloat(c.avg_deg_ms_per_lap)
                  const degCol  = degVal > 100 ? '#E8002D' : degVal > 40 ? '#FFD700' : '#2CF4C5'
                  return (
                    <div key={c.compound} style={{
                      flex: 1, minWidth: '120px', padding: '12px',
                      background: '#0D0D0D', borderRadius: '8px',
                      border: `1px solid ${col}33`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: col }} />
                        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: col, fontWeight: 700 }}>{c.compound}</span>
                      </div>
                      <div style={{ fontSize: '18px', fontFamily: 'monospace', color: degCol, fontWeight: 700 }}>
                        +{degVal.toFixed(1)}<span style={{ fontSize: '10px', color: '#52525B' }}> ms/lap</span>
                      </div>
                      <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', marginTop: '4px' }}>
                        {c.drivers_sampled} drivers sampled
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}