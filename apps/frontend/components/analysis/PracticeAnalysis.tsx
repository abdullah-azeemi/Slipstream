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
  compound: string | null
  tyre_life_laps: number | null
  is_outlier: boolean
  is_personal_best: boolean
}

type CompoundDeltaDriver = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  overall_best_ms: number
  compounds: Record<string, { best_ms: number; gap_to_best_ms: number }>
}

type DegStint = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  stint_num: number
  laps: { lap_in_stint: number; lap_time_ms: number; delta_ms: number; tyre_life_laps: number | null }[]
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

type SectorDriver = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  phases: Record<string, { best_s1: number | null; best_s2: number | null; best_s3: number | null; laps: number }>
}

type DriverInfo = {
  driver_number: number
  abbreviation: string
  team_name: string | null
  team_colour: string | null
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

const PAD = { top: 24, right: 20, bottom: 44, left: 68 }

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearCanvas(canvas: HTMLCanvasElement, W: number, H: number) {
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = CHART_BG; ctx.fillRect(0, 0, W, H)
  return ctx
}

// Fixed-position tooltip — canvas stacking context blocks absolute children
function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', left: x, top: y, pointerEvents: 'none', zIndex: 9999,
      background: '#111111EE', border: '1px solid #2A2A2A', borderRadius: '10px',
      padding: '10px 14px', backdropFilter: 'blur(8px)', minWidth: '140px',
    }}>
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
  const [selected,      setSelected]      = useState<number[]>([])
  const [scatter,       setScatter]       = useState<ScatterLap[]>([])
  const [compoundDelta, setCompoundDelta] = useState<CompoundDeltaDriver[]>([])
  const [tyreDeg,       setTyreDeg]       = useState<Record<string, DegStint[]>>({})
  const [compounds,     setCompounds]     = useState<CompoundTeam[]>([])
  const [sectors,       setSectors]       = useState<SectorDriver[]>([])
  const [loading,       setLoading]       = useState(false)
  const [showOutliers,  setShowOutliers]  = useState(false)
  const [activeDegCmp,  setActiveDegCmp]  = useState<string>('HARD')

  // Hover
  const [scatterTip, setScatterTip] = useState<{ x: number; y: number; lap: ScatterLap; gapMs: number } | null>(null)
  const [degHovIdx,  setDegHovIdx]  = useState<number | null>(null)
  const [degTip,     setDegTip]     = useState<{ x: number; y: number; entries: { abbr: string; colour: string; delta_ms: number }[] } | null>(null)

  const scatterRef   = useRef<HTMLCanvasElement | null>(null)
  const degRef       = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const scatterGeomRef = useRef<{
    laps: (ScatterLap & { gap_ms: number })[]
    xMin: number; xMax: number; yMax: number; W: number; H: number
  } | null>(null)

  const degGeomRef = useRef<{
    stints: DegStint[]
    maxLapInStint: number
    yMin: number; yMax: number
    W: number; H: number
  } | null>(null)

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
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/fp-compound-delta`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/fp-tyre-deg`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/fp-compounds`).then(r => r.json()),
      fetch(`${BASE}/api/v1/sessions/${sessionKey}/analysis/fp-sectors`).then(r => r.json()),
    ])
      .then(([sc, cd, td, cp, sec]) => {
        setScatter(Array.isArray(sc) ? sc : [])
        setCompoundDelta(Array.isArray(cd) ? cd : [])
        setTyreDeg(td && typeof td === 'object' ? td : {})
        setCompounds(Array.isArray(cp) ? cp : [])
        setSectors(Array.isArray(sec) ? sec : [])
        // Default to first available compound in deg data
        const firstCmp = Object.keys(td ?? {})[0]
        if (firstCmp) setActiveDegCmp(firstCmp)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sessionKey])

  const toggleDriver = (dn: number) =>
    setSelected(prev =>
      prev.includes(dn) ? prev.filter(d => d !== dn) : prev.length < 6 ? [...prev, dn] : prev
    )

  // ── Draw: scatter as gap-to-session-best ─────────────────────────────────

  useEffect(() => {
    const canvas = scatterRef.current
    if (!canvas || !scatter.length || !compoundDelta.length) return
    const W = containerRef.current?.clientWidth ?? 900
    const H = 300
    const ctx = clearCanvas(canvas, W, H)
    const cW = W - PAD.left - PAD.right
    const cH = H - PAD.top  - PAD.bottom

    // Session best = best lap_time_ms in scatter (non-outlier)
    const cleanLaps = scatter.filter(l => !l.is_outlier && l.lap_time_ms)
    if (!cleanLaps.length) return
    const sessionBest = Math.min(...cleanLaps.map(l => l.lap_time_ms))

    // Build enriched laps with gap_ms
    const visible = scatter
      .filter(l => selected.includes(l.driver_number) && (showOutliers || !l.is_outlier))
      .map(l => ({ ...l, gap_ms: l.lap_time_ms - sessionBest }))

    if (!visible.length) return

    const allGaps = visible.map(l => l.gap_ms)
    const allLaps = visible.map(l => l.lap_number)
    const yMax    = Math.min(Math.max(...allGaps) + 500, 8000) // cap at +8s
    const xMin    = Math.min(...allLaps)
    const xMax    = Math.max(...allLaps)

    scatterGeomRef.current = { laps: visible, xMin, xMax, yMax, W, H }

    const toX = (lap: number) => PAD.left + ((lap - xMin) / Math.max(xMax - xMin, 1)) * cW
    const toY = (gap: number) => PAD.top  + (Math.min(gap, yMax) / yMax) * cH

    // Grid — gap lines at 0, 1s, 2s, 3s, 5s
    const gridVals = [0, 500, 1000, 2000, 3000, 5000].filter(g => g <= yMax)
    gridVals.forEach(g => {
      const y = toY(g)
      ctx.beginPath()
      ctx.strokeStyle = g === 0 ? '#2A2A2A' : AXIS_COLOR
      ctx.lineWidth   = g === 0 ? 1.5 : 1
      if (g === 0) ctx.setLineDash([])
      else ctx.setLineDash([3, 4])
      ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
      ctx.fillText(g === 0 ? 'P1' : `+${(g / 1000).toFixed(1)}s`, PAD.left - 6, y + 3)
    })

    // X axis
    const lapStep = Math.max(1, Math.ceil((xMax - xMin) / 10))
    for (let lap = xMin; lap <= xMax; lap += lapStep) {
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
      ctx.fillText(String(lap), toX(lap), H - 12)
    }
    ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText('LAP', PAD.left + cW / 2, H - 2)

    // Session best annotation
    ctx.fillStyle = '#2CF4C5'; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'left'
    ctx.fillText(`SESSION BEST: ${formatLapTime(sessionBest)}`, PAD.left + 6, PAD.top + 14)

    // Dots
    visible.forEach(l => {
      const x    = toX(l.lap_number)
      const y    = toY(Math.min(l.gap_ms, yMax))
      const col  = COMPOUND_COLOUR[l.compound ?? ''] ?? '#555'
      const dCol = '#' + l.team_colour
      const r    = l.is_personal_best ? 5 : l.is_outlier ? 3 : 4

      ctx.globalAlpha = l.is_outlier ? 0.25 : 1

      // Outer ring = team colour
      ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2)
      ctx.strokeStyle = dCol + '66'; ctx.lineWidth = 1.5; ctx.stroke()

      // Inner fill = compound colour
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = col; ctx.fill()

      // PB glow
      if (l.is_personal_best) {
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2)
        ctx.strokeStyle = col + '33'; ctx.lineWidth = 2; ctx.stroke()
      }

      ctx.globalAlpha = 1
    })
  }, [scatter, compoundDelta, selected, showOutliers])

  // ── Scatter mouse ─────────────────────────────────────────────────────────

  const handleScatterMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const geom = scatterGeomRef.current
    if (!geom) return
    const rect  = e.currentTarget.getBoundingClientRect()
    const mx    = e.clientX - rect.left
    const my    = e.clientY - rect.top
    const cW    = rect.width - PAD.left - PAD.right
    const cH    = geom.H - PAD.top - PAD.bottom

    let nearest: (typeof geom.laps)[0] | null = null
    let nearDist = 14

    geom.laps.forEach(l => {
      const nx = PAD.left + ((l.lap_number - geom.xMin) / Math.max(geom.xMax - geom.xMin, 1)) * cW
      const ny = PAD.top  + (Math.min(l.gap_ms, geom.yMax) / geom.yMax) * cH
      const dist = Math.hypot(mx - nx, my - ny)
      if (dist < nearDist) { nearDist = dist; nearest = l }
    })

    if (nearest) setScatterTip({ x: e.clientX + 16, y: e.clientY - 20, lap: nearest, gapMs: (nearest as any).gap_ms })
    else setScatterTip(null)
  }, [scatter, selected])

  // ── Draw: tyre deg comparison ─────────────────────────────────────────────

  useEffect(() => {
    const canvas = degRef.current
    if (!canvas) return
    const stints = (tyreDeg[activeDegCmp] ?? []).filter(s =>
      !selected.length || selected.includes(s.driver_number)
    )
    if (!stints.length) {
      const W = containerRef.current?.clientWidth ?? 900
      clearCanvas(canvas, W, 220)
      return
    }

    const W = containerRef.current?.clientWidth ?? 900
    const H = 220
    const ctx = clearCanvas(canvas, W, H)
    const cW = W - PAD.left - PAD.right
    const cH = H - PAD.top  - PAD.bottom

    const allDeltas = stints.flatMap(s => s.laps.map(l => l.delta_ms))
    const maxLapInStint = Math.max(...stints.map(s => s.laps.length))
    const yMin = Math.min(...allDeltas) - 100
    const yMax = Math.max(...allDeltas, 500) + 200

    degGeomRef.current = { stints, maxLapInStint, yMin, yMax, W, H }

    const toX = (idx: number) => PAD.left + (idx / Math.max(maxLapInStint - 1, 1)) * cW
    const toY = (delta: number) => PAD.top + cH - ((delta - yMin) / (yMax - yMin)) * cH

    // Zero line (baseline)
    const zy = toY(0)
    ctx.beginPath(); ctx.strokeStyle = '#2A2A2A'; ctx.lineWidth = 1.5
    ctx.moveTo(PAD.left, zy); ctx.lineTo(PAD.left + cW, zy); ctx.stroke()
    ctx.fillStyle = TEXT_DIM; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'right'
    ctx.fillText('BASE', PAD.left - 6, zy + 3)

    // Grid
    for (let i = 0; i <= 4; i++) {
      const delta = yMin + (i / 4) * (yMax - yMin); const y = toY(delta)
      if (Math.abs(delta) < 50) continue
      ctx.beginPath(); ctx.strokeStyle = AXIS_COLOR; ctx.lineWidth = 1
      ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke()
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right'
      ctx.fillText(`${delta >= 0 ? '+' : ''}${(delta / 1000).toFixed(2)}s`, PAD.left - 6, y + 3)
    }

    for (let i = 0; i < maxLapInStint; i += Math.max(1, Math.floor(maxLapInStint / 8))) {
      ctx.fillStyle = TEXT_DIM; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
      ctx.fillText(String(i + 1), toX(i), H - 12)
    }
    ctx.fillStyle = TEXT_MID; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center'
    ctx.fillText('LAP IN STINT', PAD.left + cW / 2, H - 2)

    // Crosshair
    if (degHovIdx !== null) {
      ctx.beginPath(); ctx.strokeStyle = CROSSHAIR; ctx.lineWidth = 1
      ctx.moveTo(toX(degHovIdx), PAD.top); ctx.lineTo(toX(degHovIdx), PAD.top + cH); ctx.stroke()
    }

    // Draw each stint
    stints.forEach(stint => {
      const colour = '#' + stint.team_colour
      const pts    = stint.laps

      ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.lineJoin = 'round'
      pts.forEach((l, i) => {
        const x = toX(l.lap_in_stint); const y = toY(l.delta_ms)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Dots
      pts.forEach(l => {
        const x = toX(l.lap_in_stint); const y = toY(l.delta_ms)
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.fillStyle = COMPOUND_COLOUR[activeDegCmp] ?? '#fff'; ctx.fill()
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
        ctx.strokeStyle = colour + '88'; ctx.lineWidth = 1; ctx.stroke()
      })

      // Hover dot
      if (degHovIdx !== null && pts[degHovIdx]) {
        const l = pts[degHovIdx]
        const hx = toX(l.lap_in_stint); const hy = toY(l.delta_ms)
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.strokeStyle = colour + '55'; ctx.lineWidth = 2; ctx.stroke()
        ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill()
      }

      // End label
      if (pts.length) {
        const last = pts[pts.length - 1]
        ctx.fillStyle = colour; ctx.font = 'bold 10px JetBrains Mono, monospace'; ctx.textAlign = 'left'
        ctx.fillText(stint.abbreviation, toX(last.lap_in_stint) + 8, toY(last.delta_ms) + 4)
      }
    })
  }, [tyreDeg, activeDegCmp, selected, degHovIdx])

  // ── Deg mouse ─────────────────────────────────────────────────────────────

  const handleDegMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const geom = degGeomRef.current
    if (!geom) return
    const rect = e.currentTarget.getBoundingClientRect()
    const nx   = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / (rect.width - PAD.left - PAD.right)))
    const idx  = Math.round(nx * (geom.maxLapInStint - 1))
    setDegHovIdx(idx)

    const entries = geom.stints
      .filter(s => s.laps[idx])
      .map(s => ({ abbr: s.abbreviation, colour: '#' + s.team_colour, delta_ms: s.laps[idx].delta_ms }))
      .sort((a, b) => a.delta_ms - b.delta_ms)

    if (entries.length) setDegTip({ x: e.clientX + 16, y: e.clientY - 20, entries })
    else setDegTip(null)
  }, [tyreDeg, activeDegCmp, selected])

  // ── Sector delta helper ───────────────────────────────────────────────────

  function sectorDelta(driver: SectorDriver, sector: 'best_s1' | 'best_s2' | 'best_s3') {
    const early = driver.phases['early']?.[sector]
    const late  = driver.phases['late']?.[sector]
    if (!early || !late) return null
    return late - early
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const degCompounds = Object.keys(tyreDeg).sort()

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

      {/* Driver selector */}
      <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
        <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: '10px' }}>
          FILTER DRIVERS (MAX 6)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {allDrivers.map(d => {
            const isSel  = selected.includes(d.driver_number)
            const colour = teamColour(d.team_colour, d.team_name)
            return (
              <button key={d.driver_number} onClick={() => toggleDriver(d.driver_number)} style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px',
                borderRadius: '20px', cursor: 'pointer', transition: 'all 0.12s',
                border: isSel ? `1.5px solid ${colour}` : '1.5px solid #2A2A2A',
                background: isSel ? `${colour}18` : 'transparent',
                color: isSel ? '#fff' : '#52525B',
                fontSize: '12px', fontWeight: isSel ? 700 : 400, fontFamily: 'monospace',
              }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: colour, display: 'inline-block' }} />
                {d.abbreviation}
                {isSel && <span style={{ color: colour, fontSize: '10px' }}>×</span>}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: '16px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #1A1A1A', flexWrap: 'wrap', alignItems: 'center' }}>
          {Object.entries(COMPOUND_COLOUR).map(([c, col]) => (
            <div key={c} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col }} />
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>{c}</span>
            </div>
          ))}
          <button onClick={() => setShowOutliers(v => !v)} style={{
            marginLeft: 'auto', padding: '3px 10px', borderRadius: '20px', cursor: 'pointer',
            border: showOutliers ? '1.5px solid #2CF4C5' : '1.5px solid #2A2A2A',
            background: showOutliers ? '#2CF4C518' : 'transparent',
            color: showOutliers ? '#2CF4C5' : '#52525B',
            fontSize: '10px', fontFamily: 'monospace',
          }}>
            {showOutliers ? 'Hide' : 'Show'} outliers
          </button>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '48px', color: '#3F3F46', fontFamily: 'monospace' }}>Loading practice data...</div>}

      {!loading && (
        <>
          {/* ── GAP TO SESSION BEST SCATTER ───────────────────── */}
          <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 4px' }}>
              <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>GAP TO SESSION BEST</span>
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>every lap · 0 = fastest lap of session · ring = team · dot = compound</span>
            </div>
            <canvas
              ref={scatterRef} height={300}
              style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
              onMouseMove={handleScatterMove}
              onMouseLeave={() => setScatterTip(null)}
            />
          </div>

          {scatterTip && (
            <Tooltip x={scatterTip.x} y={scatterTip.y}>
              <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', marginBottom: '6px' }}>LAP {scatterTip.lap.lap_number}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ width: '3px', minHeight: '44px', borderRadius: '2px', background: '#' + scatterTip.lap.team_colour, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '11px', color: '#' + scatterTip.lap.team_colour, fontFamily: 'monospace', fontWeight: 700 }}>{scatterTip.lap.abbreviation}</div>
                  <div style={{ fontSize: '14px', fontFamily: 'monospace', color: '#fff', fontWeight: 700 }}>{formatLapTime(scatterTip.lap.lap_time_ms)}</div>
                  <div style={{ fontSize: '11px', fontFamily: 'monospace', color: scatterTip.gapMs < 200 ? '#2CF4C5' : '#E8002D', fontWeight: 600 }}>
                    {scatterTip.gapMs < 10 ? '🏆 SESSION BEST' : `+${(scatterTip.gapMs / 1000).toFixed(3)}s`}
                  </div>
                  {scatterTip.lap.compound && (
                    <div style={{ fontSize: '9px', fontFamily: 'monospace', color: COMPOUND_COLOUR[scatterTip.lap.compound] ?? '#666', marginTop: '2px' }}>
                      ● {scatterTip.lap.compound}{scatterTip.lap.tyre_life_laps != null ? ` · ${scatterTip.lap.tyre_life_laps}L` : ''}
                    </div>
                  )}
                </div>
              </div>
            </Tooltip>
          )}

          {/* ── COMPOUND DELTA TABLE ──────────────────────────── */}
          {compoundDelta.length > 0 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
                <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>COMPOUND DELTA</span>
                <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>best lap per compound · gap to session fastest on that tyre</span>
              </div>

              {(() => {
                const allCompounds = Array.from(new Set(compoundDelta.flatMap(d => Object.keys(d.compounds)))).sort((a, b) => {
                  const order = ['SOFT', 'MEDIUM', 'HARD', 'INTER', 'WET']
                  return order.indexOf(a) - order.indexOf(b)
                })
                const visibleDrivers = compoundDelta.filter(d =>
                  !selected.length || selected.includes(d.driver_number)
                )

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {/* Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: `32px 36px 1fr ${allCompounds.map(() => '90px').join(' ')}`, gap: '8px', padding: '4px 8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '9px', color: '#3F3F46', fontFamily: 'monospace' }}>POS</span>
                      <span></span>
                      <span style={{ fontSize: '9px', color: '#3F3F46', fontFamily: 'monospace' }}>DRIVER</span>
                      {allCompounds.map(c => (
                        <span key={c} style={{ fontSize: '9px', fontFamily: 'monospace', color: COMPOUND_COLOUR[c] ?? '#666', textAlign: 'right' }}>
                          ● {c.slice(0, 1)}
                        </span>
                      ))}
                    </div>

                    {visibleDrivers.map((driver, i) => {
                      const colour = '#' + driver.team_colour
                      return (
                        <div key={driver.driver_number} style={{
                          display: 'grid',
                          gridTemplateColumns: `32px 36px 1fr ${allCompounds.map(() => '90px').join(' ')}`,
                          gap: '8px', padding: '8px 8px',
                          background: i % 2 === 0 ? '#0D0D0D' : 'transparent',
                          borderRadius: '6px', alignItems: 'center',
                        }}>
                          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#3F3F46' }}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <div style={{ width: '3px', height: '20px', borderRadius: '2px', background: colour }} />
                          <div>
                            <div style={{ fontSize: '12px', fontFamily: 'monospace', color: colour, fontWeight: 700 }}>{driver.abbreviation}</div>
                            <div style={{ fontSize: '9px', color: '#52525B', fontFamily: 'monospace' }}>{driver.team_name.split(' ')[0]}</div>
                          </div>
                          {allCompounds.map(c => {
                            const data    = driver.compounds[c]
                            const compCol = COMPOUND_COLOUR[c] ?? '#666'
                            const isZero  = data && data.gap_to_best_ms < 10
                            return (
                              <div key={c} style={{ textAlign: 'right' }}>
                                {data ? (
                                  <>
                                    <div style={{ fontSize: '12px', fontFamily: 'monospace', color: isZero ? compCol : '#A1A1AA', fontWeight: isZero ? 700 : 400 }}>
                                      {isZero ? '🏆' : `+${(data.gap_to_best_ms / 1000).toFixed(3)}s`}
                                    </div>
                                    <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>
                                      {formatLapTime(data.best_ms)}
                                    </div>
                                  </>
                                ) : (
                                  <span style={{ fontSize: '11px', color: '#2A2A2A', fontFamily: 'monospace' }}>—</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── TYRE DEGRADATION COMPARISON ───────────────────── */}
          {degCompounds.length > 0 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 0' }}>
                <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>TYRE DEGRADATION</span>
                <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>delta from stint base · 0 = no deg · positive = slower</span>
              </div>

              {/* Compound tabs */}
              <div style={{ display: 'flex', gap: '6px', padding: '8px 16px' }}>
                {degCompounds.map(c => {
                  const col    = COMPOUND_COLOUR[c] ?? '#666'
                  const active = activeDegCmp === c
                  return (
                    <button key={c} onClick={() => setActiveDegCmp(c)} style={{
                      padding: '4px 12px', borderRadius: '20px', cursor: 'pointer',
                      border: active ? `1.5px solid ${col}` : '1.5px solid #2A2A2A',
                      background: active ? col + '18' : 'transparent',
                      color: active ? col : '#52525B',
                      fontSize: '11px', fontFamily: 'monospace', fontWeight: active ? 700 : 400,
                    }}>
                      ● {c}
                    </button>
                  )
                })}
              </div>

              <canvas
                ref={degRef} height={220}
                style={{ display: 'block', width: '100%', cursor: 'crosshair' }}
                onMouseMove={handleDegMove}
                onMouseLeave={() => { setDegHovIdx(null); setDegTip(null) }}
              />

              {/* No data message */}
              {(tyreDeg[activeDegCmp] ?? []).filter(s => !selected.length || selected.includes(s.driver_number)).length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', fontSize: '11px', fontFamily: 'monospace', color: '#3F3F46' }}>
                  No {activeDegCmp} stints for selected drivers (≥4 consecutive laps required)
                </div>
              )}
            </div>
          )}

          {degTip && (
            <Tooltip x={degTip.x} y={degTip.y}>
              <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', marginBottom: '6px' }}>
                ● {activeDegCmp}
              </div>
              {degTip.entries.map(e => (
                <div key={e.abbr} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                  <div style={{ width: '3px', height: '22px', borderRadius: '2px', background: e.colour, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '10px', color: e.colour, fontFamily: 'monospace', fontWeight: 700 }}>{e.abbr}</div>
                    <div style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 700, color: e.delta_ms > 300 ? '#E8002D' : e.delta_ms < -50 ? '#2CF4C5' : '#fff' }}>
                      {e.delta_ms >= 0 ? '+' : ''}{(e.delta_ms / 1000).toFixed(3)}s
                    </div>
                  </div>
                </div>
              ))}
            </Tooltip>
          )}

          {/* ── COMPOUND STRATEGY REVEAL ──────────────────────── */}
          {compounds.length > 0 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
                <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>COMPOUND STRATEGY REVEAL</span>
                <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>laps per compound per team reveals planned race strategy</span>
              </div>
              {(() => {
                const allCompounds = Array.from(new Set(compounds.flatMap(t => Object.keys(t.compounds)))).sort((a, b) => {
                  const order = ['SOFT', 'MEDIUM', 'HARD', 'INTER', 'WET']
                  return order.indexOf(a) - order.indexOf(b)
                })
                const maxLaps = Math.max(...compounds.flatMap(t => Object.values(t.compounds).map(c => c.laps)))
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${allCompounds.length}, 1fr)`, gap: '8px', padding: '0 4px', marginBottom: '2px' }}>
                      <span style={{ fontSize: '9px', color: '#3F3F46', fontFamily: 'monospace' }}>TEAM</span>
                      {allCompounds.map(c => (
                        <span key={c} style={{ fontSize: '9px', fontFamily: 'monospace', color: COMPOUND_COLOUR[c] ?? '#666', textAlign: 'center' }}>
                          ● {c.slice(0,1)}
                        </span>
                      ))}
                    </div>
                    {compounds.map(team => {
                      const colour = '#' + team.team_colour
                      return (
                        <div key={team.team_name} style={{ display: 'grid', gridTemplateColumns: `140px repeat(${allCompounds.length}, 1fr)`, gap: '8px', alignItems: 'center', padding: '7px 4px', background: '#0D0D0D', borderRadius: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                            <div style={{ width: '3px', height: '16px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: colour, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {team.team_name.split(' ')[0]}
                            </span>
                          </div>
                          {allCompounds.map(c => {
                            const data    = team.compounds[c]
                            const compCol = COMPOUND_COLOUR[c] ?? '#555'
                            const barW    = data ? (data.laps / maxLaps) * 100 : 0
                            return (
                              <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ height: '10px', background: '#1A1A1A', borderRadius: '3px', overflow: 'hidden' }}>
                                  {data && <div style={{ width: `${barW}%`, height: '100%', background: compCol + '88', borderRadius: '3px' }} />}
                                </div>
                                <span style={{ fontSize: '9px', fontFamily: 'monospace', color: data ? compCol : '#2A2A2A', textAlign: 'center' }}>
                                  {data ? `${data.laps}L` : '—'}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── SECTOR PROGRESSION ────────────────────────────── */}
          {sectors.length > 0 && (
            <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
                <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em' }}>SECTOR PROGRESSION</span>
                <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46' }}>early → mid → late · negative = improving setup</span>
              </div>
              {(() => {
                const visible = sectors.filter(d => selected.includes(d.driver_number))
                if (!visible.length) return (
                  <div style={{ fontSize: '11px', color: '#3F3F46', fontFamily: 'monospace', textAlign: 'center', padding: '16px' }}>
                    Select drivers above to see sector progression
                  </div>
                )
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {visible.map(driver => {
                      const colour = teamColour(driver.team_colour, driver.team_name)
                      const phases = ['early', 'middle', 'late'] as const
                      return (
                        <div key={driver.driver_number} style={{ padding: '10px 12px', background: '#0D0D0D', borderRadius: '8px', border: '1px solid #1A1A1A' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                            <div style={{ width: '3px', height: '16px', borderRadius: '2px', background: colour }} />
                            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: colour, fontWeight: 700 }}>{driver.abbreviation}</span>
                            <span style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace' }}>{driver.team_name}</span>
                            {(() => {
                              const deltas = (['best_s1', 'best_s2', 'best_s3'] as const).map(s => sectorDelta(driver, s)).filter(d => d !== null) as number[]
                              const total  = deltas.reduce((a, b) => a + b, 0)
                              if (!deltas.length) return null
                              return (
                                <span style={{ marginLeft: 'auto', fontSize: '10px', fontFamily: 'monospace', fontWeight: 700, color: total < 0 ? '#2CF4C5' : total > 0 ? '#E8002D' : '#71717A' }}>
                                  {total < 0 ? `▲ ${(Math.abs(total)/1000).toFixed(3)}s faster` : total > 0 ? `▼ ${(total/1000).toFixed(3)}s slower` : '→ no change'}
                                </span>
                              )
                            })()}
                          </div>
                          {(['best_s1', 'best_s2', 'best_s3'] as const).map((sector, si) => {
                            const sColour  = ['#E8002D', '#FFD700', '#B347FF'][si]
                            const phaseMs  = phases.map(p => driver.phases[p]?.[sector] ?? null)
                            const validMs  = phaseMs.filter(t => t !== null) as number[]
                            const minMs    = validMs.length ? Math.min(...validMs) : 0
                            const maxMs    = validMs.length ? Math.max(...validMs) : 1
                            const delta    = sectorDelta(driver, sector)
                            return (
                              <div key={sector} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: si < 2 ? '6px' : 0 }}>
                                <span style={{ width: '20px', fontSize: '9px', fontFamily: 'monospace', color: sColour, fontWeight: 700, flexShrink: 0 }}>S{si+1}</span>
                                <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
                                  {phases.map((phase, pi) => {
                                    const t      = driver.phases[phase]?.[sector] ?? null
                                    const isBest = t !== null && t === minMs
                                    const barH   = t !== null && maxMs > minMs ? 4 + ((maxMs - t) / (maxMs - minMs)) * 8 : 4
                                    return (
                                      <div key={phase} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                        <div style={{ width: '100%', height: '14px', display: 'flex', alignItems: 'flex-end' }}>
                                          <div style={{ width: '100%', height: `${barH}px`, background: isBest ? sColour : sColour + '33', borderRadius: '2px' }} />
                                        </div>
                                        <span style={{ fontSize: '8px', fontFamily: 'monospace', color: t !== null ? (isBest ? '#fff' : '#52525B') : '#2A2A2A' }}>
                                          {t !== null ? (t/1000).toFixed(2) : '—'}
                                        </span>
                                        {pi === 0 && <span style={{ fontSize: '7px', color: '#3F3F46', fontFamily: 'monospace' }}>Early</span>}
                                        {pi === 2 && <span style={{ fontSize: '7px', color: '#3F3F46', fontFamily: 'monospace' }}>Late</span>}
                                      </div>
                                    )
                                  })}
                                </div>
                                {delta !== null && (
                                  <span style={{ width: '56px', fontSize: '9px', fontFamily: 'monospace', textAlign: 'right', flexShrink: 0, fontWeight: 700, color: delta < 0 ? '#2CF4C5' : delta > 0 ? '#E8002D' : '#71717A' }}>
                                    {delta < 0 ? `−${(Math.abs(delta)/1000).toFixed(3)}` : `+${(delta/1000).toFixed(3)}`}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}
        </>
      )}
    </div>
  )
}