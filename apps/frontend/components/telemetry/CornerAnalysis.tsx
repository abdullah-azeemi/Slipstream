'use client'
import { useEffect, useState } from 'react'
import { telemetryApi } from '@/lib/api'
import { teamColour } from '@/lib/utils'
import type { DriverTelemetryStats } from '@/types/f1'

// ── Constants ────────────────────────────────────────────────────────────────
const RANK_BEST   = '#B347FF'
const RANK_MID    = '#22C55E'
const RANK_WORST  = '#E8002D'
const RANK_NONE   = '#3F3F46'

// ── Types ────────────────────────────────────────────────────────────────────
interface Props {
  sessionKey: number
  drivers:    number[]
  driverMap:  Record<number, { abbreviation: string; team_colour: string | null }>
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function rankColour(val: number | null, vals: (number | null)[], higherIsBetter = false): string {
  if (val === null) return RANK_NONE
  const valid = vals.filter((v): v is number => v !== null)
  if (valid.length < 2) return '#A1A1AA'
  const best  = higherIsBetter ? Math.max(...valid) : Math.min(...valid)
  const worst = higherIsBetter ? Math.min(...valid) : Math.max(...valid)
  if (val === best)  return RANK_BEST
  if (val === worst) return RANK_WORST
  return RANK_MID
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '4px 0',
    }}>
      <div style={{ height: '1px', flex: 1, background: '#1E1E1E' }} />
      <span style={{
        fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46',
        letterSpacing: '0.12em', textTransform: 'uppercase',
      }}>{label}</span>
      <div style={{ height: '1px', flex: 1, background: '#1E1E1E' }} />
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({
  title, subtitle, children,
}: {
  title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <div style={{
      background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px',
      padding: '14px 16px',
    }}>
      <div style={{ marginBottom: subtitle ? '2px' : '12px' }}>
        <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', marginTop: '2px', marginBottom: '10px' }}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

// ── Bar Row ───────────────────────────────────────────────────────────────────
function BarRow({
  abbr, value, maxValue, colour, label,
}: {
  abbr: string; value: number | null; maxValue: number; colour: string; label: string
}) {
  const pct = value !== null ? ((value / maxValue) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#71717A', width: '28px', flexShrink: 0 }}>
        {abbr}
      </span>
      <div style={{ flex: 1, height: '6px', background: '#1A1A1A', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '3px',
          background: colour, opacity: 0.85,
          transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>
      <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#A1A1AA', width: '52px', textAlign: 'right', flexShrink: 0 }}>
        {label}
      </span>
    </div>
  )
}

// ── Summary Stats ─────────────────────────────────────────────────────────────
function SummaryStats({ stats }: { stats: DriverTelemetryStats[] }) {
  const rpms   = stats.map(s => s.max_rpm).filter(Boolean) as number[]
  const brakes = stats.map(s => s.avg_brake_point_pct).filter(Boolean) as number[]
  const drsList = stats.map(s => s.drs_open_pct).filter(v => v !== null && v < 50) as number[]
  const maxRpm   = Math.max(...rpms,   1)
  const maxBrake = Math.max(...brakes, 1)
  const maxDrs   = Math.max(...drsList, 1)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>

      {/* Max RPM */}
      <StatCard title="Max RPM">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...stats]
            .sort((a, b) => (b.max_rpm ?? 0) - (a.max_rpm ?? 0))
            .map(s => (
              <BarRow
                key={s.driver_number}
                abbr={s.abbreviation}
                value={s.max_rpm}
                maxValue={maxRpm}
                colour={teamColour(s.team_colour)}
                label={s.max_rpm?.toLocaleString() ?? '—'}
              />
            ))}
        </div>
      </StatCard>

      {/* Late Braking */}
      <StatCard title="Late Braking" subtitle="avg metres before apex">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...stats]
            .sort((a, b) => (b.avg_brake_point_pct ?? 0) - (a.avg_brake_point_pct ?? 0))
            .map(s => (
              <BarRow
                key={s.driver_number}
                abbr={s.abbreviation}
                value={s.avg_brake_point_pct}
                maxValue={maxBrake}
                colour='#FF2D55'
                label={s.avg_brake_point_pct != null ? `${s.avg_brake_point_pct.toFixed(1)}m` : '—'}
              />
            ))}
        </div>
      </StatCard>

      {/* DRS Usage */}
      <StatCard title="DRS Usage" subtitle="% of lap with DRS open">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...stats]
            .filter(s => (s.drs_open_pct ?? 0) < 50)
            .sort((a, b) => (b.drs_open_pct ?? 0) - (a.drs_open_pct ?? 0))
            .map(s => (
              <BarRow
                key={s.driver_number}
                abbr={s.abbreviation}
                value={s.drs_open_pct}
                maxValue={maxDrs}
                colour='#22FF88'
                label={s.drs_open_pct != null ? `${s.drs_open_pct.toFixed(1)}%` : '—'}
              />
            ))}
        </div>
      </StatCard>

    </div>
  )
}

// ── Corner Detail Panel ───────────────────────────────────────────────────────
function CornerDetail({
  cornerNum, stats,
}: {
  cornerNum: number; stats: DriverTelemetryStats[]
}) {
  const corners = stats
    .map(s => ({ ...s, corner: s.corners?.find(c => c.corner_num === cornerNum) ?? null }))
    .filter(s => s.corner !== null)

  if (!corners.length) return null

  const allEntry = corners.map(s => s.corner!.entry_speed_kmh)
  const allApex  = corners.map(s => s.corner!.min_speed_kmh)
  const allExit  = corners.map(s => s.corner!.exit_speed_kmh)
  const allBrake = corners.map(s => {
    const c = s.corner!
    return c.brake_point_m ? c.distance_m - c.brake_point_m : null
  })

  const cols = [
    { label: 'Entry',       key: 'entry'  },
    { label: 'Apex',        key: 'apex'   },
    { label: 'Exit',        key: 'exit'   },
    { label: 'Brake Dist',  key: 'brake'  },
  ]

  return (
    <div style={{
      borderTop: '1px solid #1E1E1E', padding: '12px 16px',
      background: '#0D0D0D',
    }}>
      <div style={{
        fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46',
        letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '10px',
      }}>
        Corner {cornerNum} · {corners[0].corner!.distance_m.toFixed(0)}m into lap
      </div>

      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(4, 1fr)', gap: '8px', marginBottom: '6px' }}>
        <div />
        {cols.map(c => (
          <div key={c.key} style={{
            fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46',
            textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>{c.label}</div>
        ))}
      </div>

      {/* Rows */}
      {corners.map(s => {
        const c = s.corner!
        const colour = teamColour(s.team_colour)
        const brakeDist = c.brake_point_m ? c.distance_m - c.brake_point_m : null

        const values = [
          { val: c.entry_speed_kmh, all: allEntry, label: `${c.entry_speed_kmh}` },
          { val: c.min_speed_kmh,   all: allApex,  label: `${c.min_speed_kmh}`,  bold: true },
          { val: c.exit_speed_kmh,  all: allExit,  label: `${c.exit_speed_kmh}` },
          { val: brakeDist,         all: allBrake, label: brakeDist ? `${brakeDist.toFixed(0)}m` : '—' },
        ]

        return (
          <div key={s.driver_number} style={{
            display: 'grid', gridTemplateColumns: '60px repeat(4, 1fr)',
            gap: '8px', alignItems: 'center', marginBottom: '6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '3px', height: '14px', borderRadius: '2px', background: colour }} />
              <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, color: '#fff' }}>
                {s.abbreviation}
              </span>
            </div>
            {values.map((v, vi) => (
              <div key={vi} style={{
                textAlign: 'center', fontFamily: 'monospace',
                fontSize: v.bold ? '13px' : '11px',
                fontWeight: v.bold ? 700 : 400,
                color: rankColour(v.val, v.all, true),
              }}>
                {v.label}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Corner Table ──────────────────────────────────────────────────────────────
function CornerTable({ stats }: { stats: DriverTelemetryStats[] }) {
  const [selected, setSelected] = useState<number | null>(null)

  const maxCorners = Math.max(...stats.map(s => s.corners?.length ?? 0))
  if (maxCorners === 0) return null
  const cornerNums = Array.from({ length: maxCorners }, (_, i) => i + 1)

  return (
    <div style={{
      background: '#111111', border: '1px solid #2A2A2A',
      borderRadius: '12px', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 16px', borderBottom: '1px solid #1E1E1E',
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', fontFamily: 'monospace' }}>
            Corner Analysis
          </div>
          <div style={{ fontSize: '10px', color: '#52525B', marginTop: '2px', fontFamily: 'monospace' }}>
            Apex speed · click a corner for detail
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {[
            { colour: RANK_BEST,  label: 'Fastest' },
            { colour: RANK_MID,   label: 'Middle'  },
            { colour: RANK_WORST, label: 'Slowest' },
          ].map(({ colour, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: colour }} />
              <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1E1E1E' }}>
              <th style={{ textAlign: 'left', padding: '8px 16px', fontFamily: 'monospace', fontSize: '10px', color: '#3F3F46', fontWeight: 400, letterSpacing: '0.1em', width: '64px' }}>
                DRIVER
              </th>
              {cornerNums.map(n => (
                <th key={n}
                  onClick={() => setSelected(selected === n ? null : n)}
                  style={{
                    textAlign: 'center', padding: '8px', fontFamily: 'monospace',
                    fontSize: '10px', fontWeight: 400, cursor: 'pointer',
                    color: selected === n ? '#fff' : '#3F3F46',
                    background: selected === n ? '#1A1A1A' : 'transparent',
                    transition: 'all 0.12s',
                    userSelect: 'none',
                  }}>
                  C{n}
                </th>
              ))}
              <th style={{ textAlign: 'right', padding: '8px 16px', fontFamily: 'monospace', fontSize: '10px', color: '#3F3F46', fontWeight: 400 }}>TRAP 1</th>
              <th style={{ textAlign: 'right', padding: '8px 16px', fontFamily: 'monospace', fontSize: '10px', color: '#3F3F46', fontWeight: 400 }}>MAX</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, si) => {
              const colour = teamColour(s.team_colour)
              return (
                <tr key={s.driver_number} style={{
                  borderBottom: si < stats.length - 1 ? '1px solid #1A1A1A' : 'none',
                  transition: 'background 0.1s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#161616')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '3px', height: '16px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff', fontSize: '12px' }}>
                        {s.abbreviation}
                      </span>
                    </div>
                  </td>
                  {cornerNums.map(n => {
                    const corner    = s.corners?.find(c => c.corner_num === n)
                    const allSpeeds = stats.map(st => st.corners?.find(c => c.corner_num === n)?.min_speed_kmh ?? null)
                    const col       = corner ? rankColour(corner.min_speed_kmh, allSpeeds, true) : RANK_NONE
                    return (
                      <td key={n} style={{
                        textAlign: 'center', padding: '10px 8px',
                        background: selected === n ? '#161616' : 'transparent',
                      }}>
                        {corner ? (
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: col }}>
                            {corner.min_speed_kmh}
                          </span>
                        ) : (
                          <span style={{ color: '#2A2A2A', fontFamily: 'monospace' }}>—</span>
                        )}
                      </td>
                    )
                  })}
                  <td style={{ textAlign: 'right', padding: '10px 16px', fontFamily: 'monospace', color: '#71717A', fontSize: '11px' }}>
                    {s.speed_trap_1_kmh ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 16px', fontFamily: 'monospace', color: '#fff', fontWeight: 700, fontSize: '12px' }}>
                    {s.max_speed_kmh ?? '—'}
                  </td>
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

// ── Main Export ───────────────────────────────────────────────────────────────
export default function CornerAnalysis({ sessionKey, drivers, driverMap }: Props) {
  const [stats,   setStats]   = useState<DriverTelemetryStats[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!drivers.length) return
    setLoading(true)
    telemetryApi.stats(sessionKey, drivers)
      .then(setStats)
      .catch(() => setStats([]))
      .finally(() => setLoading(false))
  }, [sessionKey, drivers.join(',')])

  if (loading) return (
    <div style={{
      textAlign: 'center', padding: '48px',
      color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px',
    }}>
      Computing corner analysis...
    </div>
  )

  if (!stats.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
      <SectionDivider label="Corner Analysis" />
      <SummaryStats stats={stats} />
      <CornerTable stats={stats} />
    </div>
  )
}