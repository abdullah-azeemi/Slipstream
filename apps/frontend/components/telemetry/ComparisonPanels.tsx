'use client'

import { useEffect, useRef } from 'react'
import { C, Panel, PanelHeader } from '@/components/telemetry/telemetry-ui'
import type { DriverRenderData } from '@/components/telemetry/chart-draw'
import { isRaceSession, type DriverSectorTimes } from '@/lib/telemetry-math'
import { formatLapTime } from '@/lib/utils'
import type { Driver } from '@/types/f1'

// Smooth bezier gap chart ───────────────────────────────────────────────────
export function GapToLeaderChart({
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
export function PerformanceMatrix({
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
          background: '#1E293B',
          borderRadius: 18,
          padding: '22px 24px',
          boxShadow: '0 16px 34px rgba(19,35,61,0.16)',
          position: 'relative',
          overflow: 'hidden',
          marginTop: 'auto',
        }}>
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
export function SectorHeroCards({
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
export function TelemetryDecisionHero({
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

