'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { formatLapTime, formatGap, teamColour } from '@/lib/utils'
import type { Session, DriverComparison } from '@/types/f1'
import { X } from 'lucide-react'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

const PRESET_DRIVERS = [
  { num: 44, abbr: 'HAM' }, { num: 63, abbr: 'RUS' },
  { num: 1, abbr: 'VER' }, { num: 11, abbr: 'PER' },
  { num: 4, abbr: 'NOR' }, { num: 81, abbr: 'PIA' },
  { num: 16, abbr: 'LEC' }, { num: 55, abbr: 'SAI' },
]

export default function ComparePage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionKey, setSessionKey] = useState<number | null>(null)
  const [selected, setSelected] = useState<number[]>([44, 63])
  const [results, setResults] = useState<DriverComparison[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.sessions.list().then(s => {
      setSessions(s)
      if (s[0]) setSessionKey(s[0].session_key)
    })
  }, [])

  useEffect(() => {
    if (!sessionKey || selected.length < 2) return
    setLoading(true)
    api.drivers.compare(sessionKey, selected)
      .then(setResults)
      .finally(() => setLoading(false))
  }, [sessionKey, selected])

  const toggleDriver = (num: number) => {
    setSelected(prev =>
      prev.includes(num)
        ? prev.filter(n => n !== num)
        : prev.length < 4 ? [...prev, num] : prev
    )
  }

  return (
    <div className="px-4 pb-6 pt-4 max-w-2xl mx-auto">

      {/* ── Page Header ──────────────────────────────────────────── */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1 h-6 rounded-full" style={{ background: '#E8002D' }} />
          <h1
            className="font-bold text-2xl text-white tracking-tight"
            style={{ fontFamily: 'Rajdhani, sans-serif' }}
          >
            Driver Comparison
          </h1>
        </div>
        <p className="text-zinc-500 text-sm pl-3">Select up to 4 drivers to compare</p>
      </div>

      {/* ── Session picker ────────────────────────────────────────── */}
      <div className="mb-5">
        <div className="text-[9px] tracking-widest text-zinc-600 uppercase mb-1.5 font-mono">Session</div>
        <div className="relative">
          <select
            className="w-full text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none border appearance-none"
            style={{ background: '#1A1A1A', borderColor: '#2A2A2A' }}
            value={sessionKey ?? ''}
            onChange={e => setSessionKey(Number(e.target.value))}
          >
            {sessions.map(s => (
              <option key={s.session_key} value={s.session_key}>
                {s.year} {s.gp_name} — {s.session_name}
              </option>
            ))}
          </select>
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* ── Driver selector chips ─────────────────────────────────── */}
      <div className="mb-5">
        <div className="text-[9px] tracking-widest text-zinc-600 uppercase mb-2 font-mono">Drivers</div>
        <div className="flex flex-wrap gap-2">
          {PRESET_DRIVERS.map(({ num, abbr }) => {
            const active = selected.includes(num)
            const result = results.find(r => r.driver_number === num)
            const colour = teamColour(result?.team_colour)
            return (
              <button
                key={num}
                onClick={() => toggleDriver(num)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
                style={active
                  ? { background: colour, borderColor: 'transparent', color: '#000' }
                  : { background: '#111111', borderColor: '#2A2A2A', color: '#71717A' }
                }
              >
                {abbr}
                {active && <X size={10} />}
              </button>
            )
          })}
        </div>
        {selected.length < 2 && (
          <p className="text-zinc-600 text-xs mt-2 pl-0.5">Select at least 2 drivers to compare</p>
        )}
      </div>

      {/* ── Results ───────────────────────────────────────────────── */}
      {loading ? (
        <LoadingSpinner text="Comparing drivers..." />
      ) : results.length >= 2 ? (
        <div className="space-y-4">

          {/* Driver header cards */}
          <div className={`grid gap-3 ${results.length === 2 ? 'grid-cols-2' : results.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {results.map(d => {
              const colour = teamColour(d.team_colour)
              return (
                <div
                  key={d.driver_number}
                  className="rounded-xl p-4 text-center relative overflow-hidden border"
                  style={{ background: '#111111', borderColor: '#2A2A2A' }}
                >
                  {/* Left accent bar */}
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl" style={{ background: colour }} />
                  {/* Top accent */}
                  <div className="absolute top-0 left-4 right-0 h-px opacity-40" style={{ background: colour }} />

                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold text-sm mx-auto mb-2"
                    style={{ background: `${colour}18`, color: colour }}
                  >
                    {d.driver_number}
                  </div>
                  <div className="font-bold text-xl text-white" style={{ fontFamily: 'Rajdhani, sans-serif' }}>
                    {d.abbreviation}
                  </div>
                  <div className="text-zinc-500 text-xs mt-0.5 truncate">{d.team_name}</div>
                  <div
                    className="inline-block mt-2 text-[9px] px-2 py-0.5 rounded font-medium tracking-wider uppercase"
                    style={{ background: `${colour}18`, color: colour }}
                  >
                    {d.team_name?.split(' ')[0]}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Metric bars */}
          {[
            { label: 'BEST LAP TIME', key: 'best_lap_ms', fmt: formatLapTime },
            { label: 'THEORETICAL BEST', key: 'theoretical_best_ms', fmt: formatLapTime },
            { label: 'SECTOR 1', key: 'best_s1_ms', fmt: (v: number | null) => v ? `${(v / 1000).toFixed(3)}s` : '—' },
            { label: 'SECTOR 2', key: 'best_s2_ms', fmt: (v: number | null) => v ? `${(v / 1000).toFixed(3)}s` : '—' },
            { label: 'SECTOR 3', key: 'best_s3_ms', fmt: (v: number | null) => v ? `${(v / 1000).toFixed(3)}s` : '—' },
          ].map(({ label, key, fmt }) => {
            const values = results.map(r => (r as any)[key] as number | null)
            const valid = values.filter(Boolean) as number[]
            const min = valid.length ? Math.min(...valid) : 1
            const max = valid.length ? Math.max(...valid) : 1

            return (
              <div key={key} className="rounded-xl p-4 border" style={{ background: '#111111', borderColor: '#2A2A2A' }}>
                <div className="text-[9px] tracking-widest text-zinc-600 uppercase font-mono mb-3">{label}</div>
                <div className="space-y-2.5">
                  {results.map(d => {
                    const val = (d as any)[key] as number | null
                    const pct = val ? ((max - val) / (max - min || 1)) * 55 + 40 : 40
                    const isBest = val !== null && val === min
                    const colour = teamColour(d.team_colour)
                    return (
                      <div key={d.driver_number} className="flex items-center gap-3">
                        <span className="font-mono text-xs text-zinc-500 w-8">{d.abbreviation}</span>
                        <div className="flex-1 h-7 rounded-lg overflow-hidden flex items-center" style={{ background: '#1A1A1A' }}>
                          <div
                            className="h-full flex items-center justify-end pr-2.5 transition-all duration-500"
                            style={{ width: `${pct}%`, background: `${colour}${isBest ? 'FF' : '70'}` }}
                          >
                            <span className="font-mono text-[11px] font-bold" style={{ color: isBest ? '#fff' : '#ccc' }}>
                              {fmt(val)}
                            </span>
                          </div>
                        </div>
                        {isBest && (
                          <span className="text-[9px] font-mono tracking-wider" style={{ color: '#4ade80' }}>BEST</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Gap summary */}
          <div className="rounded-xl p-4 border" style={{ background: '#111111', borderColor: '#2A2A2A' }}>
            <div className="text-[9px] tracking-widest text-zinc-600 uppercase font-mono mb-3">GAP TO FASTEST</div>
            {results.map(d => (
              <div key={d.driver_number} className="flex items-center justify-between py-2.5 border-b border-zinc-800/70 last:border-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-0.5 h-5 rounded-full" style={{ background: teamColour(d.team_colour) }} />
                  <span className="font-mono text-sm text-white">{d.abbreviation}</span>
                  <span className="text-zinc-600 text-xs">{d.team_name}</span>
                </div>
                <span
                  className="font-mono text-sm font-bold"
                  style={{ color: d.gap_to_fastest_ms === 0 ? '#4ade80' : '#A1A1AA' }}
                >
                  {d.gap_to_fastest_ms === 0 ? 'FASTEST' : formatGap(d.gap_to_fastest_ms)}
                </span>
              </div>
            ))}
          </div>

        </div>
      ) : null}
    </div>
  )
}
