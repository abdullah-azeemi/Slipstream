'use client'
import { useEffect, useState } from 'react'
import { telemetryApi } from '@/lib/api'
import { teamColour } from '@/lib/utils'
import type { DriverTelemetryStats, CornerStat } from '@/types/f1'

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  sessionKey: number
  drivers:    number[]     // selected driver numbers
  driverMap:  Record<number, { abbreviation: string; team_colour: string | null }>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fastest(vals: (number | null)[]): number {
  const valid = vals.filter((v): v is number => v !== null)
  return valid.length ? Math.min(...valid) : 0
}

function rankColour(val: number | null, vals: (number | null)[], higherIsBetter = false): string {
  if (val === null) return '#3F3F46'
  const valid = vals.filter((v): v is number => v !== null)
  if (valid.length < 2) return '#A1A1AA'
  const best  = higherIsBetter ? Math.max(...valid) : Math.min(...valid)
  const worst = higherIsBetter ? Math.min(...valid) : Math.max(...valid)
  if (val === best)  return '#B347FF'   // purple = best
  if (val === worst) return '#E8002D'   // red = worst
  return '#22C55E'                      // green = middle
}

// ── Corner Table ─────────────────────────────────────────────────────────────

function CornerTable({ stats }: { stats: DriverTelemetryStats[] }) {
  const [selected, setSelected] = useState<number | null>(null)

  // Build corner count — use driver with most corners as reference
  const maxCorners = Math.max(...stats.map(s => s.corners?.length ?? 0))
  if (maxCorners === 0) return null

  const cornerNums = Array.from({ length: maxCorners }, (_, i) => i + 1)

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Corner Analysis</div>
          <div className="text-xs text-zinc-500 mt-0.5">Apex speed · click a corner for detail</div>
        </div>
        <div className="flex items-center gap-3">
          {[
            { colour: '#B347FF', label: 'Fastest' },
            { colour: '#22C55E', label: 'Middle'  },
            { colour: '#E8002D', label: 'Slowest' },
          ].map(({ colour, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: colour }} />
              <span className="text-[9px] text-zinc-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2 text-zinc-600 font-mono text-[10px] uppercase tracking-widest w-16">
                Driver
              </th>
              {cornerNums.map(n => (
                <th key={n}
                  className={`text-center px-2 py-2 font-mono text-[10px] cursor-pointer transition-colors
                    ${selected === n ? 'text-white bg-surface2' : 'text-zinc-600 hover:text-zinc-400'}`}
                  onClick={() => setSelected(selected === n ? null : n)}>
                  C{n}
                </th>
              ))}
              <th className="text-right px-4 py-2 text-zinc-600 font-mono text-[10px] uppercase tracking-widest">
                Trap 1
              </th>
              <th className="text-right px-4 py-2 text-zinc-600 font-mono text-[10px] uppercase tracking-widest">
                Max
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map(s => {
              const colour = teamColour(s.team_colour)
              return (
                <tr key={s.driver_number}
                  className="border-b border-border last:border-0 hover:bg-surface2 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1 h-4 rounded-full" style={{ background: colour }} />
                      <span className="font-bold text-white">{s.abbreviation}</span>
                    </div>
                  </td>
                  {cornerNums.map(n => {
                    const corner = s.corners?.find(c => c.corner_num === n)
                    const allSpeeds = stats.map(st =>
                      st.corners?.find(c => c.corner_num === n)?.min_speed_kmh ?? null
                    )
                    const bg = corner
                      ? rankColour(corner.min_speed_kmh, allSpeeds, true)
                      : '#3F3F46'
                    return (
                      <td key={n}
                        className={`text-center px-2 py-2.5 transition-all
                          ${selected === n ? 'bg-surface2' : ''}`}>
                        {corner ? (
                          <span className="font-mono font-bold text-xs"
                            style={{ color: bg }}>
                            {corner.min_speed_kmh}
                          </span>
                        ) : (
                          <span className="text-zinc-700">—</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="text-right px-4 py-2.5 font-mono text-zinc-400">
                    {s.speed_trap_1_kmh ?? '—'}
                  </td>
                  <td className="text-right px-4 py-2.5 font-mono text-white font-bold">
                    {s.max_speed_kmh ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Corner detail panel */}
      {selected !== null && (
        <CornerDetail cornerNum={selected} stats={stats} />
      )}
    </div>
  )
}

// ── Corner Detail ─────────────────────────────────────────────────────────────

function CornerDetail({
  cornerNum,
  stats,
}: {
  cornerNum: number
  stats:     DriverTelemetryStats[]
}) {
  const corners = stats.map(s => ({
    ...s,
    corner: s.corners?.find(c => c.corner_num === cornerNum) ?? null,
  })).filter(s => s.corner !== null)

  if (!corners.length) return null

  const allEntry  = corners.map(s => s.corner!.entry_speed_kmh)
  const allApex   = corners.map(s => s.corner!.min_speed_kmh)
  const allExit   = corners.map(s => s.corner!.exit_speed_kmh)
  const allBrake  = corners.map(s => {
    const c = s.corner!
    return c.brake_point_m ? c.distance_m - c.brake_point_m : null
  })

  return (
    <div className="border-t border-border px-4 py-3 bg-surface2">
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">
        Corner {cornerNum} detail · {corners[0].corner!.distance_m.toFixed(0)}m into lap
      </div>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {['Entry', 'Apex', 'Exit', 'Brake dist'].map(label => (
          <div key={label} className="text-[9px] text-zinc-600 text-center uppercase tracking-widest">
            {label}
          </div>
        ))}
      </div>
      {corners.map(s => {
        const c      = s.corner!
        const colour = teamColour(s.team_colour)
        const brakeDist = c.brake_point_m ? c.distance_m - c.brake_point_m : null
        return (
          <div key={s.driver_number} className="grid grid-cols-4 gap-2 mb-2 items-center">
            <div className="flex items-center gap-1.5 col-span-1">
              {/* Reuse abbreviation as label */}
            </div>
            {/* Actually show 5 cols: driver + 4 stats */}
            <div key={s.driver_number}
              className="col-span-4 grid grid-cols-5 gap-2 items-center -mt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-3 rounded-full" style={{ background: colour }} />
                <span className="font-bold text-white text-xs">{s.abbreviation}</span>
              </div>
              <div className="text-center font-mono text-xs"
                style={{ color: rankColour(c.entry_speed_kmh, allEntry, true) }}>
                {c.entry_speed_kmh}
              </div>
              <div className="text-center font-mono text-xs font-bold"
                style={{ color: rankColour(c.min_speed_kmh, allApex, true) }}>
                {c.min_speed_kmh}
              </div>
              <div className="text-center font-mono text-xs"
                style={{ color: rankColour(c.exit_speed_kmh, allExit, true) }}>
                {c.exit_speed_kmh}
              </div>
              <div className="text-center font-mono text-xs"
                style={{ color: brakeDist ? rankColour(brakeDist, allBrake, true) : '#3F3F46' }}>
                {brakeDist ? `${brakeDist.toFixed(0)}m` : '—'}
              </div>
            </div>
          </div>
        )
      })}
      <div className="grid grid-cols-5 gap-2 mt-1">
        <div />
        {['entry km/h', 'apex km/h', 'exit km/h', 'late braking'].map(l => (
          <div key={l} className="text-center text-[9px] text-zinc-700">{l}</div>
        ))}
      </div>
    </div>
  )
}

// ── RPM + Braking Summary ─────────────────────────────────────────────────────

function SummaryStats({ stats }: { stats: DriverTelemetryStats[] }) {
  const allRpm   = stats.map(s => s.max_rpm)
  const allBrake = stats.map(s => s.avg_brake_point_pct)
  const allDrs   = stats.map(s => s.drs_open_pct)

  return (
    <div className="grid grid-cols-3 gap-3">

      {/* Max RPM */}
      <div className="bg-surface border border-border rounded-xl p-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">Max RPM</div>
        <div className="space-y-2">
          {[...stats].sort((a, b) => (b.max_rpm ?? 0) - (a.max_rpm ?? 0)).map(s => (
            <div key={s.driver_number} className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-zinc-500 w-7">{s.abbreviation}</span>
              <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                  style={{
                    width: `${((s.max_rpm ?? 0) / Math.max(...allRpm.filter(Boolean) as number[])) * 100}%`,
                    background: teamColour(s.team_colour),
                    opacity: 0.8,
                  }} />
              </div>
              <span className="font-mono text-[10px] text-zinc-400 w-12 text-right">
                {s.max_rpm?.toLocaleString() ?? '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Late braking index */}
      <div className="bg-surface border border-border rounded-xl p-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Late Braking</div>
        <div className="text-[9px] text-zinc-700 mb-2">avg metres before apex</div>
        <div className="space-y-2">
          {[...stats].sort((a, b) => (a.avg_brake_point_pct ?? 0) - (b.avg_brake_point_pct ?? 0))
            .map(s => {
              const maxBrake = Math.max(...allBrake.filter(Boolean) as number[])
              return (
                <div key={s.driver_number} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-500 w-7">{s.abbreviation}</span>
                  <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-red"
                      style={{
                        width: `${((s.avg_brake_point_pct ?? 0) / maxBrake) * 100}%`,
                        opacity: 0.7,
                      }} />
                  </div>
                  <span className="font-mono text-[10px] text-zinc-400 w-10 text-right">
                    {s.avg_brake_point_pct?.toFixed(1) ?? '—'}m
                  </span>
                </div>
              )
            })}
        </div>
      </div>

      {/* DRS usage */}
      <div className="bg-surface border border-border rounded-xl p-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">DRS Usage</div>
        <div className="text-[9px] text-zinc-700 mb-2">% of lap with DRS open</div>
        <div className="space-y-2">
          {[...stats].sort((a, b) => (b.drs_open_pct ?? 0) - (a.drs_open_pct ?? 0))
            .filter(s => (s.drs_open_pct ?? 0) < 50)  // filter out broken DRS data
            .map(s => {
              const maxDrs = Math.max(...allDrs.filter(v => v !== null && v < 50) as number[])
              return (
                <div key={s.driver_number} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-500 w-7">{s.abbreviation}</span>
                  <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-green-500"
                      style={{
                        width: `${((s.drs_open_pct ?? 0) / maxDrs) * 100}%`,
                        opacity: 0.7,
                      }} />
                  </div>
                  <span className="font-mono text-[10px] text-zinc-400 w-10 text-right">
                    {s.drs_open_pct?.toFixed(1) ?? '—'}%
                  </span>
                </div>
              )
            })}
        </div>
      </div>

    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

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
    <div className="text-center py-6 text-zinc-600 text-sm">Computing corner analysis...</div>
  )
  if (!stats.length) return null

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-2 px-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest px-2">
          Corner Analysis
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <SummaryStats stats={stats} />
      <CornerTable stats={stats} />
    </div>
  )
}