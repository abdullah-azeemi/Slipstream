'use client'
import { useEffect, useState } from 'react'
import { telemetryApi } from '@/lib/api'
import { teamColour } from '@/lib/utils'
import type { DriverTelemetryStats } from '@/types/f1'

// ── Design tokens (light theme) ───────────────────────────────────────────────
const C = {
  bg: '#EEF3F9',
  surface: '#F8FBFE',
  border: '#D9E3EF',
  borderMid: '#C5D2E3',
  textDim: '#7D8BA2',
  textMid: '#56657C',
  textSub: '#293A52',
  textBright: '#13233D',
  red: '#E8002D',
  green: '#10B981',
  purple: '#6E56CF',
  gold: '#C98A27',
  rankBest: '#10B981',
  rankMid: '#64748B',
  rankWorst: '#E8002D',
} as const

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  sessionKey: number
  drivers: number[]
  driverMap: Record<number, { abbreviation: string; team_colour: string | null }>
}

function rankColour(val: number | null, vals: (number | null)[], higherIsBetter = false): string {
  if (val === null) return C.textDim
  const valid = vals.filter((v): v is number => v !== null)
  if (valid.length < 2) return C.textMid
  const best = higherIsBetter ? Math.max(...valid) : Math.min(...valid)
  const worst = higherIsBetter ? Math.min(...valid) : Math.max(...valid)
  if (val === best) return C.rankBest
  if (val === worst) return C.rankWorst
  return C.rankMid
}

type MetricEntry = { abbr: string; colour: string; value: number | null | undefined }

function isFiniteMetric(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getBestMetric(entries: MetricEntry[], higherIsBetter = true) {
  const valid = entries.map(e => e.value).filter(isFiniteMetric)
  if (!valid.length) return null
  return higherIsBetter ? Math.max(...valid) : Math.min(...valid)
}

function getSecondMetric(entries: MetricEntry[], higherIsBetter = true) {
  const valid = entries.map(e => e.value).filter(isFiniteMetric)
  if (valid.length < 2) return null
  const sorted = [...valid].sort((a, b) => higherIsBetter ? b - a : a - b)
  return sorted[1] ?? null
}

function MetricCard({
  label,
  entries,
  higherIsBetter = true,
  fmt,
  unit,
  accent,
}: {
  label: string
  entries: MetricEntry[]
  higherIsBetter?: boolean
  fmt: (v: number) => string
  unit?: string
  accent: string
}) {
  const best = getBestMetric(entries, higherIsBetter)
  const second = getSecondMetric(entries, higherIsBetter)
  const delta = isFiniteMetric(best) && isFiniteMetric(second) ? Math.abs(best - second) : null
  const spreadPct = isFiniteMetric(best) && isFiniteMetric(second) && second !== 0
    ? Math.abs((best - second) / second) * 100
    : null
  const maxValue = entries.map(e => e.value).filter(isFiniteMetric).reduce((a, b) => Math.max(a, b), 0) || 1

  return (
    <div style={{
      background: `linear-gradient(180deg, ${C.surface} 0%, #F4F8FC 100%)`,
      border: `1px solid ${C.border}`,
      borderRadius: 18,
      padding: '18px 18px 16px',
      boxShadow: '0 10px 24px rgba(37,54,82,0.06), inset 0 1px 0 rgba(255,255,255,0.78)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontFamily: 'Inter, sans-serif', fontWeight: 800, letterSpacing: '-0.02em', color: C.textBright }}>
          {label}
        </span>
        {spreadPct !== null && (
          <span style={{
            fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 700,
            color: C.textMid,
            background: '#F1F5FB',
            border: `1px solid ${C.border}`,
            borderRadius: 999,
            padding: '4px 8px',
          }}>
            {spreadPct.toFixed(1)}% spread
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map(entry => {
          const hasValue = isFiniteMetric(entry.value)
          const value: number | null = hasValue ? (entry.value as number) : null
          const pct = value !== null ? Math.max(10, (value / maxValue) * 100) : 0
          const isBest = value !== null && value === best
          return (
            <div key={entry.abbr}>
              <div style={{ display: 'grid', gridTemplateColumns: '38px 1fr auto', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: entry.colour }}>{entry.abbr}</span>
                <div style={{ height: 8, background: '#D8E3F5', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: entry.colour,
                    opacity: isBest ? 1 : 0.88,
                    borderRadius: 999,
                  }} />
                </div>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: isBest ? 700 : 500, color: isBest ? C.textBright : C.textMid, minWidth: 56, textAlign: 'right' }}>
                  {value !== null ? fmt(value) : '—'}{unit && value !== null ? ` ${unit}` : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {delta !== null && unit && (
        <div style={{ marginTop: 14, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: C.textMid, display: 'flex', justifyContent: 'space-between' }}>
          <span>Gap to next best</span>
          <span style={{ color: accent, fontWeight: 700 }}>{fmt(delta)} {unit}</span>
        </div>
      )}
    </div>
  )
}

function RpmGaugeCard({ entries }: { entries: MetricEntry[] }) {
  const maxRpm = 13000
  const best = getBestMetric(entries, true)
  const winner = entries.find(e => isFiniteMetric(e.value) && e.value === best) ?? null
  const second = getSecondMetric(entries, true)
  const delta = isFiniteMetric(best) && isFiniteMetric(second) ? best - second : null

  const radius = 50
  const circumference = 2 * Math.PI * radius

  return (
    <div style={{
      background: `linear-gradient(180deg, ${C.surface} 0%, #F4F8FC 100%)`,
      border: `1px solid ${C.border}`,
      borderRadius: 18,
      padding: '18px 18px 16px',
      boxShadow: '0 12px 28px rgba(37,54,82,0.07), inset 0 1px 0 rgba(255,255,255,0.78)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontFamily: 'Inter, sans-serif', fontWeight: 800, letterSpacing: '-0.02em', color: C.textBright }}>
          Peak RPM Distribution
        </span>
        {delta !== null && (
          <span style={{
            fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 700,
            color: C.textMid,
            background: '#F1F5FB',
            border: `1px solid ${C.border}`,
            borderRadius: 999,
            padding: '4px 8px',
          }}>
            {Math.round(delta)} rpm
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 12, alignItems: 'center' }}>
        {entries.map(entry => {
          const hasValue = isFiniteMetric(entry.value)
          const value: number | null = hasValue ? (entry.value as number) : null
          const progress = value !== null ? Math.min(1, value / maxRpm) : 0
          const dashOffset = circumference * (1 - progress)
          const isBest = value !== null && value === best
          return (
            <div key={entry.abbr} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '6px 4px 2px',
              borderRadius: 16,
            }}>
              <div style={{ position: 'relative', width: 92, height: 92 }}>
                <svg width="92" height="92" viewBox="0 0 132 132">
                  <circle cx="66" cy="66" r={radius} fill="none" stroke="#D8E3F5" strokeWidth="10" />
                  <circle
                    cx="66"
                    cy="66"
                    r={radius}
                    fill="none"
                    stroke={entry.colour}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 66 66)"
                  />
                </svg>
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: C.textMid }}>{entry.abbr}</span>
                  <span style={{ fontSize: 18, lineHeight: 1, fontWeight: 800, color: C.textBright }}>
                    {value !== null ? `${(value / 1000).toFixed(1)}k` : '—'}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: isBest ? entry.colour : C.textMid, fontWeight: isBest ? 700 : 500 }}>
                {value !== null ? `${Math.round(progress * 100)}%` : 'No data'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Summary stats panel ───────────────────────────────────────────────────────
function SummaryStats({ stats }: { stats: DriverTelemetryStats[] }) {
  const rpmEntries = stats.map(s => ({ abbr: s.abbreviation, colour: teamColour(s.team_colour), value: s.max_rpm }))
  const topSpeedEntries = stats.map(s => ({ abbr: s.abbreviation, colour: teamColour(s.team_colour), value: s.max_speed_kmh }))
  const brakingEntries = stats.map(s => ({ abbr: s.abbreviation, colour: C.red, value: s.avg_brake_point_pct }))
  const drsEntries = stats.map(s => ({
    abbr: s.abbreviation,
    colour: teamColour(s.team_colour),
    value: (s.drs_open_pct ?? 0) < 50 ? s.drs_open_pct : null,
  }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <RpmGaugeCard entries={rpmEntries} />
      </div>
      <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <MetricCard label="Top Speed" entries={topSpeedEntries} higherIsBetter fmt={v => v.toFixed(0)} unit="km/h" accent={C.green} />
        <MetricCard label="Late Braking" entries={brakingEntries} higherIsBetter fmt={v => v.toFixed(1)} unit="m" accent={C.red} />
        <MetricCard label="DRS Usage" entries={drsEntries} higherIsBetter fmt={v => v.toFixed(1)} unit="%" accent={C.purple} />
      </div>
    </div>
  )
}

// ── Corner detail ─────────────────────────────────────────────────────────────
function CornerDetail({ cornerNum, stats }: { cornerNum: number; stats: DriverTelemetryStats[] }) {
  const corners = stats
    .map(s => ({ ...s, corner: s.corners?.find(c => c.corner_num === cornerNum) ?? null }))
    .filter(s => s.corner !== null)
  if (!corners.length) return null

  const allEntry = corners.map(s => s.corner!.entry_speed_kmh)
  const allApex = corners.map(s => s.corner!.min_speed_kmh)
  const allExit = corners.map(s => s.corner!.exit_speed_kmh)
  const allBrake = corners.map(s => {
    const c = s.corner!
    return c.brake_point_m ? c.distance_m - c.brake_point_m : null
  })

  const cols = [
    { label: 'Entry', all: allEntry, field: (c: typeof corners[0]['corner']) => c!.entry_speed_kmh, unit: '' },
    { label: 'Apex', all: allApex, field: (c: typeof corners[0]['corner']) => c!.min_speed_kmh, unit: '', bold: true },
    { label: 'Exit', all: allExit, field: (c: typeof corners[0]['corner']) => c!.exit_speed_kmh, unit: '' },
    { label: 'Brake Dist', all: allBrake, field: (c: typeof corners[0]['corner']) => c!.brake_point_m ? c!.distance_m - c!.brake_point_m : null, unit: 'm' },
  ]

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: '16px 20px', background: C.bg }}>
      <div style={{ fontSize: 10, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, color: C.textDim, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>
        Corner {cornerNum} · {corners[0].corner!.distance_m.toFixed(0)}m
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
        <div />
        {cols.map(c => (
          <div key={c.label} style={{ fontSize: 9, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, color: C.textDim, textAlign: 'center', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {c.label}
          </div>
        ))}
      </div>
      {corners.map(s => {
        const colour = teamColour(s.team_colour)
        return (
          <div key={s.driver_number} style={{ display: 'grid', gridTemplateColumns: '60px repeat(4, 1fr)', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 3, height: 14, borderRadius: 2, background: colour }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700, color: C.textBright }}>{s.abbreviation}</span>
            </div>
            {cols.map((col, ci) => {
              const val = col.field(s.corner)
              const rc = rankColour(val, col.all as (number | null)[], true)
              return (
                <div key={ci} style={{ textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: col.bold ? 13 : 11, fontWeight: col.bold ? 700 : 400, color: rc }}>
                  {val !== null ? `${typeof val === 'number' ? val.toFixed(col.unit === 'm' ? 0 : 0) : val}${col.unit}` : '—'}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Corner table ──────────────────────────────────────────────────────────────
function CornerTable({ stats }: { stats: DriverTelemetryStats[] }) {
  const [selected, setSelected] = useState<number | null>(null)
  const maxCorners = Math.max(...stats.map(s => s.corners?.length ?? 0))
  if (maxCorners === 0) return null
  const cornerNums = Array.from({ length: maxCorners }, (_, i) => i + 1)

  return (
    <div style={{ background: `linear-gradient(180deg, ${C.surface} 0%, #F4F8FC 100%)`, border: `1px solid ${C.border}`, borderRadius: 18, overflow: 'hidden', boxShadow: '0 12px 28px rgba(37,54,82,0.07), inset 0 1px 0 rgba(255,255,255,0.78)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textBright, fontFamily: 'Inter, sans-serif' }}>Corner Analysis</div>
          <div style={{ fontSize: 11, color: C.textMid, marginTop: 2, fontFamily: 'Inter, sans-serif' }}>Apex speed · click a corner for detail</div>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {[{ c: C.rankBest, l: 'Fastest' }, { c: C.rankMid, l: 'Middle' }, { c: C.rankWorst, l: 'Slowest' }].map(({ c, l }) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
              <span style={{ fontSize: 10, color: C.textMid, fontFamily: 'Inter, sans-serif' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ textAlign: 'left', padding: '8px 20px', fontFamily: 'Space Grotesk, sans-serif', fontSize: 10, color: C.textDim, fontWeight: 600, letterSpacing: '0.1em', width: 64 }}>DRIVER</th>
              {cornerNums.map(n => (
                <th key={n} onClick={() => setSelected(selected === n ? null : n)} style={{
                  textAlign: 'center', padding: '8px 6px',
                  fontFamily: 'Space Grotesk, sans-serif', fontSize: 10, fontWeight: 600,
                  cursor: 'pointer', letterSpacing: '0.08em',
                  color: selected === n ? C.textBright : C.textDim,
                  background: selected === n ? C.bg : 'transparent',
                  transition: 'all 0.12s', userSelect: 'none',
                }}>C{n}</th>
              ))}
              <th style={{ textAlign: 'right', padding: '8px 20px', fontFamily: 'Space Grotesk, sans-serif', fontSize: 10, color: C.textDim, fontWeight: 600 }}>TRAP</th>
              <th style={{ textAlign: 'right', padding: '8px 20px', fontFamily: 'Space Grotesk, sans-serif', fontSize: 10, color: C.textDim, fontWeight: 600 }}>TOP</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, si) => {
              const colour = teamColour(s.team_colour)
              return (
                <tr key={s.driver_number} style={{ borderBottom: si < stats.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <td style={{ padding: '10px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 3, height: 16, borderRadius: 2, background: colour, flexShrink: 0 }} />
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: C.textBright, fontSize: 12 }}>{s.abbreviation}</span>
                    </div>
                  </td>
                  {cornerNums.map(n => {
                    const corner = s.corners?.find(c => c.corner_num === n)
                    const allSpeeds = stats.map(st => st.corners?.find(c => c.corner_num === n)?.min_speed_kmh ?? null)
                    const col = corner ? rankColour(corner.min_speed_kmh, allSpeeds, true) : C.textDim
                    return (
                      <td key={n} style={{ textAlign: 'center', padding: '10px 6px', background: selected === n ? C.bg : 'transparent' }}>
                        {corner
                          ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: 12, color: col }}>{corner.min_speed_kmh}</span>
                          : <span style={{ color: C.border }}>—</span>
                        }
                      </td>
                    )
                  })}
                  <td style={{ textAlign: 'right', padding: '10px 20px', fontFamily: 'JetBrains Mono, monospace', color: C.textMid, fontSize: 11 }}>{s.speed_trap_1_kmh ?? '—'}</td>
                  <td style={{ textAlign: 'right', padding: '10px 20px', fontFamily: 'JetBrains Mono, monospace', color: C.textBright, fontWeight: 700, fontSize: 12 }}>{s.max_speed_kmh ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected !== null && <CornerDetail cornerNum={selected} stats={stats} />}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function CornerAnalysis({ sessionKey, drivers, driverMap }: Props) {
  const [stats, setStats] = useState<DriverTelemetryStats[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!drivers.length) return
    setLoading(true)
    telemetryApi.stats(sessionKey, drivers)
      .then(setStats)
      .catch(() => setStats([]))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, drivers.join(',')])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 48, color: C.textDim, fontFamily: 'Inter, sans-serif', fontSize: 13 }}>
      Computing corner analysis...
    </div>
  )
  if (!stats.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ height: 1, flex: 1, background: C.border }} />
        <span style={{ fontSize: 10, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, color: C.textDim, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Corner Analysis</span>
        <div style={{ height: 1, flex: 1, background: C.border }} />
      </div>
      <SummaryStats stats={stats} />
      <CornerTable stats={stats} />
    </div>
  )
}
