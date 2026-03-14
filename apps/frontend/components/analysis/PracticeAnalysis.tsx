'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { teamColour, formatLapTime } from '@/lib/utils'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Types ─────────────────────────────────────────────────────────────────────

type ScatterLap = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  lap_number: number
  lap_time_ms: number
  compound: string
  tyre_life_laps: number | null
  is_outlier: boolean
  is_personal_best: boolean
}

type CompoundTeam = {
  team_name: string
  team_colour: string
  compounds: Record<string, { laps: number; best_ms: number | null }>
  drivers: {
    driver_number: number
    abbreviation: string
    compounds: Record<string, { laps: number; best_ms: number | null; avg_ms: number | null }>
  }[]
}

type RaceSimStint = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  compound: string
  laps: number
  start_lap: number
  end_lap: number
  best_ms: number
  avg_ms: string
  deg_ms_per_lap: string
  lap_times: { lap_number: number; lap_time_ms: number }[]
}

type SectorDriver = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  phases: Record<string, { best_s1: number | null; best_s2: number | null; best_s3: number | null }>
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
const CROSSHAIR  = 'rgba(255,255,255,0.10)'

const COMPOUND_COLOUR: Record<string, string> = {
  SOFT: '#E8002D', MEDIUM: '#FFD700', HARD: '#EFEFEF',
  INTER: '#39B54A', WET: '#0067FF',
}

const PAD = { top: 28, right: 100, bottom: 44, left: 72 }

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearCanvas(canvas: HTMLCanvasElement, W: number, H: number) {
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, H)
  return ctx
}

function makeToX(xMin: number, xMax: number, W: number) {
  const cW = W - PAD.left - PAD.right
  return (x: number) => PAD.left + ((x - xMin) / Math.max(xMax - xMin, 1)) * cW
}

function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', left: Math.min(x, window.innerWidth - 200), top: y,
      pointerEvents: 'none', zIndex: 9999,
      background: '#141414F0', border: '1px solid #2A2A2A',
      borderRadius: '10px', padding: '10px 14px',
      backdropFilter: 'blur(12px)', minWidth: '140px',
    }}>
      {children}
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#111111', border: '1px solid #1E1E1E', borderRadius: '16px', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px 8px', borderBottom: '1px solid #161616' }}>
        <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#71717A', letterSpacing: '0.14em', fontWeight: 600 }}>{title}</div>
        {subtitle && <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46', marginTop: '2px' }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
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
  const [scatter,      setScatter]      = useState<ScatterLap[]>([])
  const [compounds,    setCompounds]    = useState<CompoundTeam[]>([])
  const [raceSims,     setRaceSims]     = useState<RaceSimStint[]>([])
  const [sectors,      setSectors]      = useState<SectorDriver[]>([])
  const [loading,      setLoading]      = useState(false)
  const [showOutliers, setShowOutliers] = useState(false)

  const [hovLap,    setHovLap]    = useState<number | null>(null)
  const [hovSimLap, setHovSimLap] = useState<number | null>(null)
  const [lapTip,    setLapTip]    = useState<{ lap: number; entries: any[] } | null>(null)
  const [simTip,    setSimTip]    = useState<{ lap: number; entries: any[] } | null>(null)
  const [tipXY,     setTipXY]     = useState({ x: 0, y: 0 })
  const [simTipXY,  setSimTipXY]  = useState({ x: 0, y: 0 })

  const lapRef       = useRef<HTMLCanvasElement | null>(null)
  const simRef       = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const lapGeomRef = useRef<{ xMin: number; xMax: number } | null>(null)
  const simGeomRef = useRef<{ maxLapInStint: number } | null>(null)

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (allDrivers.length >= 2)
      setSelected([allDrivers[0].driver_number, allDrivers[1].driver_number])
  }, [allDrivers.map(d => d.driver_number).join(',')])

  // ── Fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/fp-scatter`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/fp-compounds`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/fp-racesim`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/fp-sectors`).then(r => r.json()),
    ])
      .then(([sc, cp, rs, sec]) => {
        setScatter(Array.isArray(sc) ? sc : [])
        setCompounds(Array.isArray(cp) ? cp : [])
        setRaceSims(Array.isArray(rs) ? rs : [])
        setSectors(Array.isArray(sec) ? sec : [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sessionKey])

  const toggleDriver = (dn: number) =>
    setSelected(prev => prev.includes(dn) ? prev.filter(d => d !== dn) : prev.length < 5 ? [...prev, dn] : prev)

  // ── Derived data — ALL filtered by selected ───────────────────────────────

  // Lap chart: only laps for selected drivers
  const selectedLaps = scatter.filter(l =>
    selected.includes(l.driver_number) && (showOutliers || !l.is_outlier)
  )

  // Group by driver for line chart
  const lapsByDriver: Record<number, ScatterLap[]> = {}
  selectedLaps.forEach(l => {
    if (!lapsByDriver[l.driver_number]) lapsByDriver[l.driver_number] = []
    lapsByDriver[l.driver_number].push(l)
  })
  Object.values(lapsByDriver).forEach(laps => laps.sort((a, b) => a.lap_number - b.lap_number))

  // Race sims: only stints for selected drivers, re-sorted by avg pace
  const visibleSims = raceSims
    .filter(s => selected.includes(s.driver_number))
    .sort((a, b) => parseFloat(a.avg_ms) - parseFloat(b.avg_ms))

  // Compound usage: only teams that have at least one selected driver
  const visibleCompounds = compounds.filter(team =>
    team.drivers.some(d => selected.includes(d.driver_number))
  )

  // Sectors: only selected drivers
  const visibleSectors = sectors.filter(d => selected.includes(d.driver_number))

  // ── Draw: lap time line chart ─────────────────────────────────────────────

  useEffect(() => {
    const canvas = lapRef.current
    if (!canvas || !selectedLaps.length) return
    const W = containerRef.current?.clientWidth ?? 900
    const H = 300
    const ctx = clearCanvas(canvas, W, H)
    const cW = W - PAD.left - PAD.right
    const cH = H - PAD.top  - PAD.bottom

    const allLapNums = selectedLaps.map(l => l.lap_number)
    const allMs      = selectedLaps.map(l => l.lap_time_ms)
    const xMin = Math.min(...allLapNums)
    const xMax = Math.max(...allLapNums)
    const sorted = [...allMs].sort((a, b) => a - b)
    const yMin = sorted[0] - 1000
    const yMax = sorted[Math.floor(sorted.length * 0.96)] + 3000

    lapGeomRef.current = { xMin, xMax }

    const toX = makeToX(xMin, xMax, W)
    const toY = (ms: number) => PAD.top + cH - ((Math.min(ms, yMax) - yMin) / (yMax - yMin)) * cH

    // Grid
    for (let i = 0; i <= 5; i++) {
      const ms = yMin + (i / 5) * (yMax - yMin); const y = toY(ms)
      ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
      ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
      ctx.fillText(formatLapTime(ms), PAD.left - 6, y + 3)
    }
    const lapStep = Math.max(1, Math.ceil((xMax - xMin) / 12))
    for (let lap = xMin; lap <= xMax; lap += lapStep) {
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
      ctx.fillText(String(lap), toX(lap), H - 12)
    }
    ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText('LAP', PAD.left + cW / 2, H - 2)

    // Crosshair
    if (hovLap !== null) {
      ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
      ctx.moveTo(toX(hovLap), PAD.top); ctx.lineTo(toX(hovLap), PAD.top + cH); ctx.stroke()
    }

    // Per driver
    Object.entries(lapsByDriver).forEach(([dn, laps]) => {
      const driver = allDrivers.find(d => d.driver_number === parseInt(dn))
      const colour = '#' + (driver?.team_colour ?? '666666')
      const clean  = laps.filter(l => !l.is_outlier && l.lap_time_ms <= yMax)

      // Line through clean laps
      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.lineJoin = 'round'
      clean.forEach((l, i) => { i === 0 ? ctx.moveTo(toX(l.lap_number), toY(l.lap_time_ms)) : ctx.lineTo(toX(l.lap_number), toY(l.lap_time_ms)) })
      ctx.stroke()

      // Compound dots on all laps
      laps.forEach(l => {
        if (l.lap_time_ms > yMax) return
        const cx = toX(l.lap_number); const cy = toY(l.lap_time_ms)
        const cCol = COMPOUND_COLOUR[l.compound] ?? '#555'
        const r    = l.is_outlier ? 3 : 5
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = l.is_outlier ? cCol + '55' : cCol; ctx.fill()
        if (!l.is_outlier) {
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.strokeStyle = colour + '88'; ctx.lineWidth = 1.5; ctx.stroke()
        }
      })

      // Driver label at end
      const last = clean[clean.length - 1]
      if (last) {
        ctx.fillStyle = colour; ctx.font = 'bold 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'
        ctx.fillText(driver?.abbreviation ?? '', toX(last.lap_number) + 8, toY(last.lap_time_ms) + 4)
      }

      // Hover dot
      if (hovLap !== null) {
        const row = laps.find(l => l.lap_number === hovLap)
        if (row && row.lap_time_ms <= yMax) {
          const hx = toX(row.lap_number); const hy = toY(row.lap_time_ms)
          ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.strokeStyle = colour + '66'; ctx.lineWidth = 2; ctx.stroke()
          ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill()
          ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5; ctx.stroke()
        }
      }
    })
  }, [lapsByDriver, hovLap, showOutliers, selected])

  // ── Draw: race sim chart ──────────────────────────────────────────────────

  useEffect(() => {
    const canvas = simRef.current
    if (!canvas || !visibleSims.length) return
    const W = containerRef.current?.clientWidth ?? 900
    const H = 240
    const ctx = clearCanvas(canvas, W, H)
    const cW = W - PAD.left - PAD.right
    const cH = H - PAD.top  - PAD.bottom

    const allMs = visibleSims.flatMap(s => s.lap_times.map(l => l.lap_time_ms))
    if (!allMs.length) return
    allMs.sort((a, b) => a - b)
    const yMin = allMs[0] - 800
    const yMax = allMs[allMs.length - 1] + 1500
    const maxLapInStint = Math.max(...visibleSims.map(s => s.laps))

    simGeomRef.current = { maxLapInStint }

    const toX = (l: number) => PAD.left + ((l - 1) / Math.max(maxLapInStint - 1, 1)) * cW
    const toY = (ms: number) => PAD.top + cH - ((ms - yMin) / (yMax - yMin)) * cH

    // Grid
    for (let i = 0; i <= 5; i++) {
      const ms = yMin + (i / 5) * (yMax - yMin); const y = toY(ms)
      ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
      ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
      ctx.fillText(formatLapTime(ms), PAD.left - 6, y + 3)
    }
    for (let l = 1; l <= maxLapInStint; l += Math.max(1, Math.ceil(maxLapInStint / 10))) {
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
      ctx.fillText(String(l), toX(l), H - 12)
    }
    ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText('LAP IN STINT', PAD.left + cW / 2, H - 2)

    if (hovSimLap !== null) {
      ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
      ctx.moveTo(toX(hovSimLap), PAD.top); ctx.lineTo(toX(hovSimLap), PAD.top + cH); ctx.stroke()
    }

    visibleSims.forEach(sim => {
      const colour  = '#' + sim.team_colour
      const compCol = COMPOUND_COLOUR[sim.compound] ?? '#666'
      const pts     = sim.lap_times.map((l, idx) => ({ x: toX(idx + 1), y: toY(l.lap_time_ms), ms: l.lap_time_ms, i: idx + 1 }))

      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'
      pts.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y) })
      ctx.stroke()

      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 6, 0, Math.PI * 2); ctx.fillStyle = compCol; ctx.fill()
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 6, 0, Math.PI * 2); ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.stroke()

      const last = pts[pts.length - 1]
      ctx.fillStyle = colour; ctx.font = 'bold 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'
      ctx.fillText(sim.abbreviation, last.x + 8, last.y + 4)

      if (hovSimLap !== null && hovSimLap <= sim.laps) {
        const p = pts[hovSimLap - 1]
        if (p) {
          ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.strokeStyle = colour + '66'; ctx.lineWidth = 2; ctx.stroke()
          ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill()
          ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 1.5; ctx.stroke()
        }
      }
    })
  }, [visibleSims, hovSimLap])

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const handleLapMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const geom = lapGeomRef.current; if (!geom) return
    const rect = e.currentTarget.getBoundingClientRect()
    const cW   = rect.width - PAD.left - PAD.right
    const nx   = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / cW))
    const lap  = Math.round(nx * (geom.xMax - geom.xMin)) + geom.xMin
    setHovLap(lap)

    const entries = Object.entries(lapsByDriver).map(([dn, laps]) => {
      const driver = allDrivers.find(d => d.driver_number === parseInt(dn))
      const row    = laps.find(l => l.lap_number === lap)
      return { abbr: driver?.abbreviation ?? '', colour: '#' + (driver?.team_colour ?? '666'), lap_time_ms: row?.lap_time_ms ?? null, compound: row?.compound ?? null, is_outlier: row?.is_outlier ?? false }
    }).filter(e => e.lap_time_ms !== null)
    setLapTip({ lap, entries })
    setTipXY({ x: e.clientX + 16, y: e.clientY - 20 })
  }, [selectedLaps, lapsByDriver, allDrivers])

  const handleSimMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const geom = simGeomRef.current; if (!geom || !visibleSims.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    const cW   = rect.width - PAD.left - PAD.right
    const nx   = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / cW))
    const lap  = Math.round(nx * (geom.maxLapInStint - 1)) + 1
    setHovSimLap(lap)

    const entries = visibleSims.filter(s => lap <= s.laps).map(s => ({
      abbr: s.abbreviation, colour: '#' + s.team_colour, compound: s.compound,
      ms: s.lap_times[lap - 1]?.lap_time_ms ?? 0,
    })).filter(e => e.ms > 0).sort((a, b) => a.ms - b.ms)
    setSimTip({ lap, entries })
    setSimTipXY({ x: e.clientX + 16, y: e.clientY - 20 })
  }, [visibleSims])

  // ── Sector delta helper ───────────────────────────────────────────────────

  const delta = (d: SectorDriver, sk: 'best_s1' | 'best_s2' | 'best_s3') => {
    const e = d.phases['early']?.[sk]; const l = d.phases['late']?.[sk]
    return e && l ? l - e : null
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* Driver selector */}
      <div style={{ background: '#111111', border: '1px solid #1E1E1E', borderRadius: '16px', padding: '16px' }}>
        <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', letterSpacing: '0.12em', marginBottom: '10px' }}>SELECT DRIVERS TO COMPARE</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {allDrivers.map(d => {
            const isSel  = selected.includes(d.driver_number)
            const colour = teamColour(d.team_colour, d.team_name)
            return (
              <button key={d.driver_number} onClick={() => toggleDriver(d.driver_number)} style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px',
                borderRadius: '20px', cursor: 'pointer', transition: 'all 0.15s',
                border: isSel ? `1.5px solid ${colour}` : '1.5px solid #2A2A2A',
                background: isSel ? `${colour}15` : 'transparent',
                color: isSel ? '#fff' : '#52525B',
                fontSize: '12px', fontWeight: isSel ? 700 : 400, fontFamily: 'monospace',
              }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isSel ? colour : '#3F3F46', display: 'inline-block', transition: 'background 0.15s' }} />
                {d.abbreviation}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>COMPOUND:</span>
          {Object.entries(COMPOUND_COLOUR).map(([c, col]) => (
            <div key={c} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col }} />
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#71717A' }}>{c}</span>
            </div>
          ))}
          <button onClick={() => setShowOutliers(v => !v)} style={{
            marginLeft: 'auto', fontSize: '9px', fontFamily: 'monospace', padding: '3px 10px',
            borderRadius: '6px', cursor: 'pointer', transition: 'all 0.15s',
            border: `1px solid ${showOutliers ? '#2CF4C5' : '#2A2A2A'}`,
            background: showOutliers ? '#2CF4C518' : 'transparent',
            color: showOutliers ? '#2CF4C5' : '#52525B',
          }}>
            {showOutliers ? '✓ ' : ''}show outlaps
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px', color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px' }}>
          Loading practice data...
        </div>
      )}

      {!loading && selectedLaps.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#3F3F46', fontFamily: 'monospace', fontSize: '12px', background: '#111111', borderRadius: '16px', border: '1px solid #1E1E1E' }}>
          Select drivers above to see their lap data
        </div>
      )}

      {!loading && selectedLaps.length > 0 && (
        <>
          {/* ── LAP TIMES ──────────────────────────────────────────── */}
          <Section title="LAP TIMES" subtitle="line = driver pace · dot colour = tyre compound · hover to inspect">
            <div style={{ position: 'relative' }}>
              <canvas
                ref={lapRef}
                height={300}
                style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
                onMouseMove={handleLapMouseMove}
                onMouseLeave={() => { setHovLap(null); setLapTip(null) }}
              />
            </div>
            {lapTip && (
              <Tooltip x={tipXY.x} y={tipXY.y}>
                <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', fontWeight: 600, marginBottom: '8px', letterSpacing: '0.06em' }}>LAP {lapTip.lap}</div>
                {lapTip.entries.map((e: any) => {
                  const compCol = COMPOUND_COLOUR[e.compound ?? ''] ?? '#555'
                  return (
                    <div key={e.abbr} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ width: '3px', height: '36px', borderRadius: '2px', background: e.colour, flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        <div style={{ fontSize: '10px', color: e.colour, fontFamily: 'monospace', fontWeight: 700 }}>{e.abbr}</div>
                        <div style={{ fontSize: '14px', fontFamily: 'monospace', color: e.is_outlier ? '#71717A' : '#fff', fontWeight: 700 }}>
                          {formatLapTime(e.lap_time_ms)}
                          {e.is_outlier && <span style={{ fontSize: '8px', color: '#52525B', marginLeft: '5px' }}>outlap</span>}
                        </div>
                        {e.compound && <div style={{ fontSize: '9px', fontFamily: 'monospace', color: compCol, marginTop: '1px' }}>● {e.compound}</div>}
                      </div>
                    </div>
                  )
                })}
              </Tooltip>
            )}
          </Section>

          {/* ── RACE SIM DETECTION ─────────────────────────────────── */}
          {visibleSims.length > 0 && (
            <Section title="RACE SIM DETECTION" subtitle="stints of 6+ laps on medium or hard · consistent pace · ordered fastest first">
              {/* Summary cards */}
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {visibleSims.map((s, i) => {
                  const colour   = teamColour(s.team_colour, s.team_name)
                  const compCol  = COMPOUND_COLOUR[s.compound] ?? '#666'
                  const degVal   = parseFloat(s.deg_ms_per_lap)
                  const degColor = degVal > 150 ? '#E8002D' : degVal > 60 ? '#FFD700' : '#2CF4C5'
                  const gapToP1  = i === 0 ? null : parseFloat(s.avg_ms) - parseFloat(visibleSims[0].avg_ms)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: '#0D0D0D', borderRadius: '10px', border: '1px solid #1A1A1A' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: i === 0 ? '#FFD70022' : '#1A1A1A', border: `1px solid ${i === 0 ? '#FFD700' : '#2A2A2A'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: i === 0 ? '#FFD700' : '#52525B', fontWeight: 700 }}>P{i + 1}</span>
                      </div>
                      <div style={{ width: '3px', height: '40px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '12px', fontFamily: 'monospace', color: colour, fontWeight: 700 }}>{s.abbreviation}</span>
                          <span style={{ fontSize: '9px', padding: '1px 7px', borderRadius: '4px', background: compCol + '22', color: compCol, fontFamily: 'monospace', fontWeight: 700, border: `1px solid ${compCol}33` }}>{s.compound}</span>
                          <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B', marginLeft: 'auto' }}>{s.laps} laps · L{s.start_lap}–{s.end_lap}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px' }}>
                          <span style={{ fontSize: '18px', fontFamily: 'monospace', color: '#fff', fontWeight: 700 }}>{formatLapTime(parseFloat(s.avg_ms))}</span>
                          {gapToP1 !== null && <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#E8002D' }}>+{(gapToP1 / 1000).toFixed(3)}s</span>}
                          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: degColor }}>{degVal >= 0 ? '+' : ''}{degVal.toFixed(0)} ms/lap deg</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Sim trace */}
              <div style={{ borderTop: '1px solid #161616', position: 'relative' }}>
                <div style={{ padding: '10px 18px 4px', fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>
                  actual lap times through stint · dot = compound · hover to compare
                </div>
                <canvas
                  ref={simRef}
                  height={240}
                  style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
                  onMouseMove={handleSimMouseMove}
                  onMouseLeave={() => { setHovSimLap(null); setSimTip(null) }}
                />
                {simTip && (
                  <Tooltip x={simTipXY.x} y={simTipXY.y}>
                    <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', fontWeight: 600, marginBottom: '8px' }}>STINT LAP {simTip.lap}</div>
                    {simTip.entries.map((e: any) => (
                      <div key={e.abbr} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ width: '3px', height: '28px', borderRadius: '2px', background: e.colour, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: '10px', fontFamily: 'monospace', color: e.colour, fontWeight: 700 }}>{e.abbr}</div>
                          <div style={{ fontSize: '13px', fontFamily: 'monospace', color: '#fff', fontWeight: 700 }}>{formatLapTime(e.ms)}</div>
                        </div>
                      </div>
                    ))}
                  </Tooltip>
                )}
              </div>
            </Section>
          )}

          {/* No race sim message */}
          {visibleSims.length === 0 && !loading && (
            <Section title="RACE SIM DETECTION" subtitle="stints of 6+ laps on medium or hard · consistent pace">
              <div style={{ padding: '28px', textAlign: 'center', color: '#3F3F46', fontFamily: 'monospace', fontSize: '12px' }}>
                No race simulations found for selected drivers
              </div>
            </Section>
          )}

          {/* ── COMPOUND USAGE ──────────────────────────────────────── */}
          {visibleCompounds.length > 0 && (
            <Section title="COMPOUND USAGE" subtitle="laps run on each tyre — reveals planned race strategy">
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {visibleCompounds.map((team, i) => {
                  const colour    = teamColour(team.team_colour, team.team_name)
                  const totalLaps = Object.values(team.compounds).reduce((s, c) => s + c.laps, 0)
                  const entries   = Object.entries(team.compounds).sort((a, b) => b[1].laps - a[1].laps)
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ width: '32px', fontSize: '10px', fontFamily: 'monospace', color: colour, fontWeight: 700, flexShrink: 0 }}>
                        {team.drivers.find(d => selected.includes(d.driver_number))?.abbreviation ?? ''}
                      </span>
                      <div style={{ flex: 1, display: 'flex', height: '22px', borderRadius: '6px', overflow: 'hidden', gap: '1px', background: '#0D0D0D' }}>
                        {entries.map(([compound, data]) => {
                          const pct  = (data.laps / totalLaps) * 100
                          const cCol = COMPOUND_COLOUR[compound] ?? '#666'
                          return (
                            <div key={compound} title={`${compound}: ${data.laps} laps`} style={{ width: `${pct}%`, background: cCol + '99', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {pct > 12 && <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#000', fontWeight: 700 }}>{data.laps}</span>}
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        {entries.map(([compound, data]) => (
                          <span key={compound} style={{ fontSize: '10px', fontFamily: 'monospace', color: COMPOUND_COLOUR[compound] ?? '#666', fontWeight: 600 }}>
                            {compound.slice(0, 1)}{data.laps}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', gap: '12px', paddingTop: '8px', borderTop: '1px solid #1A1A1A' }}>
                  {Object.entries(COMPOUND_COLOUR).filter(([c]) => visibleCompounds.some(t => t.compounds[c])).map(([c, col]) => (
                    <div key={c} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: col + '99' }} />
                      <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#71717A' }}>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}

          {/* ── SECTOR PROGRESSION ──────────────────────────────────── */}
          {visibleSectors.length > 0 && (
            <Section title="SECTOR PROGRESSION" subtitle="best sector time early vs late in session — green = improving · red = getting slower">
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {visibleSectors.map(driver => {
                  const colour = teamColour(driver.team_colour, driver.team_name)
                  return (
                    <div key={driver.driver_number}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ width: '4px', height: '16px', borderRadius: '2px', background: colour }} />
                        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: colour, fontWeight: 700 }}>{driver.abbreviation}</span>
                      </div>
                      {(['best_s1', 'best_s2', 'best_s3'] as const).map((sk, si) => {
                        const sCol     = ['#E8002D', '#FFD700', '#B347FF'][si]
                        const early    = driver.phases['early']?.[sk]
                        const late     = driver.phases['late']?.[sk]
                        const d        = delta(driver, sk)
                        const improved = d !== null && d < -50
                        const slower   = d !== null && d > 50
                        return (
                          <div key={sk} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ width: '20px', fontSize: '10px', fontFamily: 'monospace', color: sCol, fontWeight: 700, flexShrink: 0 }}>S{si + 1}</span>
                            <div style={{ flex: 1, padding: '4px 8px', background: '#0D0D0D', borderRadius: '6px', textAlign: 'center' }}>
                              <div style={{ fontSize: '8px', fontFamily: 'monospace', color: '#3F3F46', marginBottom: '1px' }}>EARLY</div>
                              <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#A1A1AA' }}>{early ? (early / 1000).toFixed(3) : '—'}</div>
                            </div>
                            <span style={{ color: '#2A2A2A', fontSize: '12px' }}>→</span>
                            <div style={{ flex: 1, padding: '4px 8px', background: '#0D0D0D', borderRadius: '6px', textAlign: 'center' }}>
                              <div style={{ fontSize: '8px', fontFamily: 'monospace', color: '#3F3F46', marginBottom: '1px' }}>LATE</div>
                              <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#A1A1AA' }}>{late ? (late / 1000).toFixed(3) : '—'}</div>
                            </div>
                            <div style={{ width: '64px', padding: '4px 6px', background: improved ? '#2CF4C518' : slower ? '#E8002D18' : '#1A1A1A', borderRadius: '6px', border: `1px solid ${improved ? '#2CF4C544' : slower ? '#E8002D44' : '#2A2A2A'}`, textAlign: 'center', flexShrink: 0 }}>
                              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: improved ? '#2CF4C5' : slower ? '#E8002D' : '#52525B', fontWeight: 700 }}>
                                {d === null ? '—' : `${d > 0 ? '+' : ''}${(d / 1000).toFixed(3)}s`}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}