'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { teamColour, formatLapTime } from '@/lib/utils'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Types ─────────────────────────────────────────────────────────────────────

type LapRow = {
  lap_number: number
  lap_time_ms: number | null
  compound: string | null
  position: number | null
  stint: number | null
  deleted: boolean
}

type DriverLapData = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  laps: LapRow[]
}

type PosDriver = {
  abbreviation: string
  team_colour: string
  team_name: string
  positions: Record<string, number>
}

type StintPace = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  stint: number
  compound: string
  start_lap: number
  end_lap: number
  clean_laps: number
  avg_ms: string
  best_ms: number
  deg_ms_per_lap: string
}

type DriverInfo = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
}

type LapTooltipEntry = {
  abbr: string
  colour: string
  lap_time_ms: number | null
  compound: string | null
  prev_compound: string | null   // to detect pit stop
  position: number | null
  is_pit: boolean                // deleted or no lap time = pit lap
}

type PosTooltipEntry = {
  abbr: string
  colour: string
  position: number | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHART_BG   = '#0A0A0A'
const AXIS_COLOR = '#1E1E1E'
const TEXT_DIM   = '#3F3F46'
const TEXT_MID   = '#71717A'
const CROSSHAIR  = 'rgba(255,255,255,0.10)'

const COMPOUND_COLOUR: Record<string, string> = {
  SOFT: '#E8002D', MEDIUM: '#FFD700', HARD: '#FFFFFF',
  INTER: '#39B54A', WET: '#0067FF',
}

// Shared padding — both charts use the same left/right so x-axes align perfectly
const PAD = { top: 24, right: 110, bottom: 44, left: 72 }

// ── Canvas helper ─────────────────────────────────────────────────────────────

function clearCanvas(canvas: HTMLCanvasElement, W: number, H: number) {
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, H)
  return ctx
}

// ── Shared x-axis helpers ─────────────────────────────────────────────────────

function makeToX(maxLap: number, W: number) {
  const cW = W - PAD.left - PAD.right
  return (lap: number) => PAD.left + ((lap - 1) / Math.max(maxLap - 1, 1)) * cW
}

function lapFromNx(nx: number, maxLap: number) {
  return Math.round(nx * (maxLap - 1)) + 1
}

function nxFromEvent(e: React.MouseEvent<HTMLCanvasElement>, W: number) {
  const rect = e.currentTarget.getBoundingClientRect()
  const cW   = rect.width - PAD.left - PAD.right
  return Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / cW))
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RaceAnalysis({
  sessionKey,
  drivers: allDrivers,
}: {
  sessionKey: number
  drivers: DriverInfo[]
}) {
  const [selected,  setSelected]  = useState<number[]>([])
  const [lapData,   setLapData]   = useState<Record<string, DriverLapData>>({})
  const [posData,   setPosData]   = useState<{ total_laps: number; drivers: Record<string, PosDriver> }>({ total_laps: 0, drivers: {} })
  const [stintPace, setStintPace] = useState<StintPace[]>([])
  const [loading,   setLoading]   = useState(false)

  // ── Shared hover state — single source of truth for BOTH charts ──────────
  const [hovLap, setHovLap] = useState<number | null>(null)

  // Separate tooltip data per chart
  const [lapTooltip, setLapTooltip] = useState<{ lap: number; entries: LapTooltipEntry[] } | null>(null)
  const [posTooltip, setPosTooltip] = useState<{ lap: number; entries: PosTooltipEntry[] } | null>(null)

  // Mouse position for tooltip card placement (canvas-relative)
  const [lapTipPos, setLapTipPos] = useState({ x: 0, y: 0 })
  const [posTipPos, setPosTipPos] = useState({ x: 0, y: 0 })

  const lapRef       = useRef<HTMLCanvasElement | null>(null)
  const posRef       = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Stable geometry refs so mouse handlers never read stale state
  const geomRef = useRef<{
    maxLap: number
    lapYMin: number
    lapYMax: number
    numDrivers: number
    lapDrivers: DriverLapData[]
    posDrivers: Record<string, PosDriver>
  } | null>(null)

  // ── Init selection ────────────────────────────────────────────────────────

  useEffect(() => {
    if (allDrivers.length >= 2)
      setSelected([allDrivers[0].driver_number, allDrivers[1].driver_number])
  }, [allDrivers.map(d => d.driver_number).join(',')])

  // ── Fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selected.length) return
    setLoading(true)
    Promise.all([
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/lap-evolution?drivers=${selected.join(',')}`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/position-changes`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/stint-pace`).then(r => r.json()),
    ])
      .then(([evo, pos, stints]) => {
        setLapData(evo.drivers ?? {})
        setPosData(pos)
        setStintPace(Array.isArray(stints) ? stints : [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sessionKey, selected.join(',')])

  const toggleDriver = (dn: number) =>
    setSelected(prev =>
      prev.includes(dn) ? prev.filter(d => d !== dn) : prev.length < 4 ? [...prev, dn] : prev
    )

  // ── Derived: single maxLap used by BOTH charts ────────────────────────────
  // Use the larger of posData.total_laps and lapData max lap so axes always agree.

  const maxLap = Math.max(
    posData.total_laps,
    ...Object.values(lapData).flatMap(d => d.laps.map(l => l.lap_number)),
    2
  )

  // ── Draw lap time evolution ───────────────────────────────────────────────

  useEffect(() => {
    const canvas = lapRef.current
    if (!canvas || !Object.keys(lapData).length) return
    const W = containerRef.current?.clientWidth ?? 900
    const H = 300
    const ctx = clearCanvas(canvas, W, H)
    const cW  = W - PAD.left - PAD.right
    const cH  = H - PAD.top  - PAD.bottom

    // Y range P5–P95 to exclude formation/outlap spikes
    const allMs: number[] = []
    Object.values(lapData).forEach(d =>
      d.laps.forEach(l => {
        if (l.lap_time_ms && !l.deleted && l.lap_time_ms < 300_000) allMs.push(l.lap_time_ms)
      })
    )
    if (!allMs.length) return
    allMs.sort((a, b) => a - b)
    const yMin = allMs[Math.floor(allMs.length * 0.05)] - 1_500
    const yMax = allMs[Math.floor(allMs.length * 0.95)] + 4_000

    // Update shared geometry ref
    geomRef.current = {
      ...(geomRef.current ?? { numDrivers: 0, posDrivers: {} }),
      maxLap,
      lapYMin: yMin,
      lapYMax: yMax,
      lapDrivers: Object.values(lapData),
    }

    const toX = makeToX(maxLap, W)
    const toY = (ms: number) => PAD.top + cH - ((ms - yMin) / (yMax - yMin)) * cH

    // Grid + Y labels
    for (let i = 0; i <= 5; i++) {
      const ms = yMin + (i / 5) * (yMax - yMin)
      const y  = toY(ms)
      ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
      ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
      ctx.fillText(formatLapTime(ms), PAD.left - 6, y + 3)
    }

    // X labels
    const lapStep = Math.max(1, Math.ceil(maxLap / 10))
    for (let lap = 1; lap <= maxLap; lap += lapStep) {
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
      ctx.fillText(String(lap), toX(lap), H - 12)
    }
    ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText('LAP', PAD.left + cW / 2, H - 2)

    // Shared crosshair
    if (hovLap !== null) {
      const hx = toX(hovLap)
      ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
      ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + cH); ctx.stroke()
    }

    // Lines + dots
    Object.values(lapData).forEach(driver => {
      const colour = '#' + driver.team_colour
      const valid  = driver.laps
        .filter(l => l.lap_time_ms && !l.deleted && l.lap_time_ms >= yMin && l.lap_time_ms <= yMax)
        .sort((a, b) => a.lap_number - b.lap_number)
      if (!valid.length) return

      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.lineJoin = 'round'
      valid.forEach((l, i) => {
        const x = toX(l.lap_number); const y = toY(l.lap_time_ms!)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()

      valid.forEach(l => {
        const x   = toX(l.lap_number); const y = toY(l.lap_time_ms!)
        const dot = COMPOUND_COLOUR[l.compound ?? ''] ?? '#555'
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fillStyle = dot; ctx.fill()
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.strokeStyle = colour + '99'; ctx.lineWidth = 1; ctx.stroke()
      })

      // Hover dot
      if (hovLap !== null) {
        const hovRow = valid.find(l => l.lap_number === hovLap)
        if (hovRow) {
          const hx = toX(hovRow.lap_number); const hy = toY(hovRow.lap_time_ms!)
          ctx.beginPath(); ctx.arc(hx, hy, 7, 0, Math.PI * 2)
          ctx.strokeStyle = colour + '55'; ctx.lineWidth = 2; ctx.stroke()
          ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2)
          ctx.fillStyle = colour; ctx.fill()
          ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2)
          ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5; ctx.stroke()
        }
      }
    })
  }, [lapData, hovLap, maxLap])

  // ── Draw position changes ─────────────────────────────────────────────────

  useEffect(() => {
    const canvas = posRef.current
    if (!canvas || !posData.total_laps) return
    const W = containerRef.current?.clientWidth ?? 900
    const H = 280
    const ctx = clearCanvas(canvas, W, H)
    const cW  = W - PAD.left - PAD.right
    const cH  = H - PAD.top  - PAD.bottom

    const allDriverEntries = Object.entries(posData.drivers)
    const numDrivers = allDriverEntries.length
    if (numDrivers < 2 || maxLap < 2) return

    // Update geometry ref with pos data
    if (geomRef.current) {
      geomRef.current.numDrivers = numDrivers
      geomRef.current.posDrivers = posData.drivers
    } else {
      geomRef.current = {
        maxLap, lapYMin: 0, lapYMax: 0, lapDrivers: [],
        numDrivers, posDrivers: posData.drivers,
      }
    }

    const toX = makeToX(maxLap, W)
    const toY = (pos: number) => PAD.top + ((pos - 1) / (numDrivers - 1)) * cH

    // Grid — P labels every 4
    for (let p = 1; p <= numDrivers; p += 4) {
      const y = toY(p)
      ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
      ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
      ctx.fillText(`P${p}`, PAD.left - 6, y + 4)
    }

    // X labels — same step as lap chart
    const lapStep = Math.max(1, Math.ceil(maxLap / 10))
    for (let lap = 1; lap <= maxLap; lap += lapStep) {
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
      ctx.fillText(String(lap), toX(lap), H - 12)
    }
    ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText('LAP', PAD.left + cW / 2, H - 2)

    // Shared crosshair
    if (hovLap !== null) {
      const hx = toX(hovLap)
      ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
      ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + cH); ctx.stroke()
    }

    // Lines — unselected first, selected on top
    const sorted = [...allDriverEntries].sort(([a], [b]) =>
      (selected.includes(parseInt(a)) ? 1 : 0) - (selected.includes(parseInt(b)) ? 1 : 0)
    )

    sorted.forEach(([dn, data]) => {
      const isSel  = selected.includes(parseInt(dn))
      const colour = '#' + data.team_colour
      const pts    = Object.entries(data.positions)
        .map(([lap, pos]) => ({ lap: parseInt(lap), pos }))
        .sort((a, b) => a.lap - b.lap)
      if (!pts.length) return

      ctx.beginPath()
      ctx.strokeStyle = isSel ? colour : colour + '28'
      ctx.lineWidth   = isSel ? 2.5 : 0.8
      ctx.lineJoin    = 'round'
      pts.forEach(({ lap, pos }, i) => {
        i === 0 ? ctx.moveTo(toX(lap), toY(pos)) : ctx.lineTo(toX(lap), toY(pos))
      })
      ctx.stroke()

      // End-of-line label for selected
      if (isSel && pts.length) {
        const last = pts[pts.length - 1]
        ctx.fillStyle = colour; ctx.font = 'bold 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'
        ctx.fillText(data.abbreviation, toX(last.lap) + 8, toY(last.pos) + 4)
      }

      // Hover dot for selected drivers
      if (isSel && hovLap !== null) {
        const pos = data.positions[String(hovLap)]
        if (pos !== undefined) {
          const hx = toX(hovLap); const hy = toY(pos)
          ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2)
          ctx.strokeStyle = colour + '55'; ctx.lineWidth = 2; ctx.stroke()
          ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2)
          ctx.fillStyle = colour; ctx.fill()
          ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2)
          ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5; ctx.stroke()
        }
      }
    })
  }, [posData, hovLap, selected, maxLap])

  // ── Shared mouse handler — works on EITHER canvas ─────────────────────────
  // Reads nx from whichever canvas fired the event, updates hovLap,
  // then builds both tooltip datasets from the same lap number.

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const W    = containerRef.current?.clientWidth ?? 900
    const nx   = nxFromEvent(e, W)
    const geom = geomRef.current
    if (!geom) return

    const lap = lapFromNx(nx, geom.maxLap)
    setHovLap(lap)

    // ── Lap tooltip ──
    const lapEntries: LapTooltipEntry[] = geom.lapDrivers
      .filter(d => selected.includes(d.driver_number))
      .map(d => {
        const sorted = [...d.laps].sort((a, b) => a.lap_number - b.lap_number)
        const cur    = sorted.find(l => l.lap_number === lap)
        const prev   = sorted.find(l => l.lap_number === lap - 1)
        const isPit  = !cur || cur.deleted || cur.lap_time_ms === null

        // Detect tyre change: compound differs from previous lap
        const tyrChanged = cur?.compound !== prev?.compound && prev?.compound !== null && prev?.compound !== undefined

        return {
          abbr:          d.abbreviation,
          colour:        '#' + d.team_colour,
          lap_time_ms:   isPit ? null : (cur?.lap_time_ms ?? null),
          compound:      cur?.compound ?? prev?.compound ?? null,
          prev_compound: prev?.compound ?? null,
          position:      cur?.position ?? null,
          is_pit:        isPit || tyrChanged,
        }
      })
    setLapTooltip({ lap, entries: lapEntries })

    // ── Position tooltip ──
    const posEntries: PosTooltipEntry[] = Object.entries(geom.posDrivers)
      .filter(([dn]) => selected.includes(parseInt(dn)))
      .map(([dn, data]) => ({
        abbr:     data.abbreviation,
        colour:   '#' + data.team_colour,
        position: data.positions[String(lap)] ?? null,
      }))
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    setPosTooltip({ lap, entries: posEntries })

    // Tooltip position within canvas
    const rect = e.currentTarget.getBoundingClientRect()
    const tipX = Math.min(e.clientX - rect.left + 16, W - 175)
    const tipY = Math.max(e.clientY - rect.top - 20, 8)
    if (e.currentTarget === lapRef.current) setLapTipPos({ x: tipX, y: tipY })
    if (e.currentTarget === posRef.current) setPosTipPos({ x: tipX, y: tipY })
  }, [lapData, posData, selected])

  const handleMouseLeave = useCallback(() => {
    setHovLap(null)
    setLapTooltip(null)
    setPosTooltip(null)
  }, [])

  // ── Stint pace filtered ───────────────────────────────────────────────────

  const selectedStints = stintPace
    .filter(s => selected.includes(s.driver_number))
    .sort((a, b) => a.driver_number - b.driver_number || a.stint - b.stint)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

      {/* Driver selector */}
      <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
        <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: '10px' }}>
          DRIVERS (MAX 4)
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
        <div style={{ display: 'flex', gap: '12px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #1A1A1A', flexWrap: 'wrap' }}>
          {Object.entries(COMPOUND_COLOUR).map(([c, col]) => (
            <div key={c} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col }} />
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>{c}</span>
            </div>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px' }}>
          Loading race data...
        </div>
      )}

      {!loading && (
        <>
          {/* ── LAP TIME EVOLUTION ───────────────────────────────────────── */}
          <div style={{
            background: '#111111', border: '1px solid #2A2A2A',
            borderRadius: '12px', overflow: 'hidden', position: 'relative',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 4px' }}>
              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>LAP TIME EVOLUTION</span>
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>dots = tyre compound · pit laps excluded</span>
            </div>
            <canvas
              ref={lapRef}
              height={300}
              style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />

            {/* Lap tooltip */}
            {lapTooltip && (
              <div style={{
                position: 'absolute', left: lapTipPos.x, top: lapTipPos.y,
                pointerEvents: 'none', zIndex: 100,
                background: '#111111EE', border: '1px solid #2A2A2A',
                borderRadius: '10px', padding: '10px 14px',
                backdropFilter: 'blur(8px)', minWidth: '148px',
              }}>
                <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>
                  LAP {lapTooltip.lap}
                </div>
                {lapTooltip.entries.map(entry => {
                  const compCol = COMPOUND_COLOUR[entry.compound ?? ''] ?? '#555'
                  const isPitLap = entry.lap_time_ms === null
                  const isTyreChange = entry.is_pit && !isPitLap
                  return (
                    <div key={entry.abbr} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ width: '3px', minHeight: '44px', borderRadius: '2px', background: entry.colour, flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        <div style={{ fontSize: '10px', color: entry.colour, fontFamily: 'monospace', fontWeight: 700 }}>
                          {entry.abbr}
                          {entry.position !== null && (
                            <span style={{ color: '#52525B', fontWeight: 400, marginLeft: '6px' }}>P{entry.position}</span>
                          )}
                        </div>

                        {/* Lap time OR pit badge */}
                        {isPitLap ? (
                          <div style={{
                            display: 'inline-block', marginTop: '2px',
                            fontSize: '10px', fontFamily: 'monospace', fontWeight: 700,
                            padding: '2px 8px', borderRadius: '4px',
                            background: '#E8002D22', color: '#E8002D',
                            border: '1px solid #E8002D44',
                          }}>
                            PIT
                          </div>
                        ) : (
                          <div style={{ fontSize: '15px', fontFamily: 'monospace', color: '#fff', fontWeight: 700, lineHeight: 1.2 }}>
                            {formatLapTime(entry.lap_time_ms!)}
                          </div>
                        )}

                        {/* Compound — show NEW badge if tyre changed this lap */}
                        {entry.compound && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <span style={{ fontSize: '9px', fontFamily: 'monospace', color: compCol }}>
                              ● {entry.compound}
                            </span>
                            {isTyreChange && (
                              <span style={{
                                fontSize: '10px', fontFamily: 'monospace', fontWeight: 900,
                                padding: '2px 4px', borderRadius: '4px',
                                background: '#E8002D22', color: '#E8002D',
                              }}>
                                PIT
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── POSITION CHANGES (interactive) ───────────────────────────── */}
          <div style={{
            background: '#111111', border: '1px solid #2A2A2A',
            borderRadius: '12px', overflow: 'hidden', position: 'relative',
          }}>
            <div style={{ padding: '10px 16px 4px' }}>
              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>POSITION CHANGES</span>
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', marginLeft: '12px' }}>full field · selected drivers highlighted</span>
            </div>
            <canvas
              ref={posRef}
              height={280}
              style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />

            {/* Position tooltip */}
            {posTooltip && (
              <div style={{
                position: 'absolute', left: posTipPos.x, top: posTipPos.y,
                pointerEvents: 'none', zIndex: 100,
                background: '#111111EE', border: '1px solid #2A2A2A',
                borderRadius: '10px', padding: '10px 14px',
                backdropFilter: 'blur(8px)', minWidth: '120px',
              }}>
                <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em', marginBottom: '8px' }}>
                  LAP {posTooltip.lap}
                </div>
                {posTooltip.entries.map(entry => (
                  <div key={entry.abbr} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <div style={{ width: '3px', height: '24px', borderRadius: '2px', background: entry.colour, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '10px', color: entry.colour, fontFamily: 'monospace', fontWeight: 700 }}>{entry.abbr}</div>
                      <div style={{ fontSize: '15px', fontFamily: 'monospace', color: '#fff', fontWeight: 700, lineHeight: 1.1 }}>
                        {entry.position !== null ? `P${entry.position}` : '—'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── STINT PACE ───────────────────────────────────────────────── */}
          {selectedStints.length > 0 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em', marginBottom: '12px' }}>
                STINT PACE — clean laps only · deg = ms lost per lap
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {selectedStints.map((s, i) => {
                  const colour     = teamColour(s.team_colour, s.team_name)
                  const degVal     = parseFloat(s.deg_ms_per_lap)
                  const degSign    = degVal >= 0 ? '+' : ''
                  const degColour  = degVal > 100 ? '#E8002D' : degVal > 30 ? '#FFD700' : '#2CF4C5'
                  const compColour = COMPOUND_COLOUR[s.compound] ?? '#666666'
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      padding: '10px 12px', background: '#0D0D0D',
                      borderRadius: '8px', border: '1px solid #1A1A1A',
                    }}>
                      <div style={{ width: '3px', height: '44px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: colour, fontWeight: 700 }}>{s.abbreviation}</span>
                          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46' }}>Stint {s.stint}</span>
                          <span style={{
                            fontSize: '9px', padding: '1px 6px', borderRadius: '4px',
                            background: compColour + '22', color: compColour,
                            fontFamily: 'monospace', fontWeight: 700,
                          }}>{s.compound}</span>
                          <span style={{ fontSize: '9px', color: '#3F3F46', fontFamily: 'monospace', marginLeft: 'auto' }}>
                            L{s.start_lap}–{s.end_lap} · {s.clean_laps} laps
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'baseline' }}>
                          <span style={{ fontSize: '15px', fontFamily: 'monospace', color: '#fff', fontWeight: 700 }}>
                            {formatLapTime(parseFloat(s.avg_ms))}
                          </span>
                          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: degColour }}>
                            {degSign}{degVal.toFixed(0)} ms/lap
                          </span>
                          <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>
                            best {formatLapTime(s.best_ms)}
                          </span>
                        </div>
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