'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { formatLapTime, formatGap, teamColour } from '@/lib/utils'
import type { Session, Driver, DriverComparison } from '@/types/f1'
import { X } from 'lucide-react'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

export default function ComparePage() {
  const [sessions,    setSessions]    = useState<Session[]>([])
  const [sessionKey,  setSessionKey]  = useState<number | null>(null)
  const [drivers,     setDrivers]     = useState<Driver[]>([])
  const [selected,    setSelected]    = useState<number[]>([])
  const [results,     setResults]     = useState<DriverComparison[]>([])
  const [loading,     setLoading]     = useState(false)
  const [initDone,    setInitDone]    = useState(false)

  // Load session list once
  useEffect(() => {
    api.sessions.list().then(s => {
      setSessions(s)
      if (s[0]) setSessionKey(s[0].session_key)
    })
  }, [])

  // When session changes — load its drivers and default-select first two
  useEffect(() => {
    if (!sessionKey) return
    setSelected([])
    setResults([])
    api.drivers.list(sessionKey).then(d => {
      setDrivers(d)
      // Default: first two drivers in this session (ordered by best lap)
      const top2 = d.slice(0, 2).map(x => x.driver_number)
      setSelected(top2)
      setInitDone(true)
    })
  }, [sessionKey])

  // When selection changes — fetch comparison
  useEffect(() => {
    if (!sessionKey || selected.length < 2 || !initDone) return
    setLoading(true)
    api.drivers.compare(sessionKey, selected)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [sessionKey, selected, initDone])

  const toggleDriver = (num: number) => {
    setSelected(prev =>
      prev.includes(num)
        ? prev.filter(n => n !== num)
        : prev.length < 4 ? [...prev, num] : prev
    )
  }

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto">
      <h1 className="font-display font-bold text-2xl text-white mb-1">Driver Comparison</h1>
      <p className="text-zinc-500 text-sm mb-4">Select up to 4 drivers to compare</p>

      {/* Session picker */}
      <select
        className="w-full bg-surface border border-border text-white text-sm rounded-lg px-3 py-2.5 mb-4 focus:outline-none focus:border-zinc-500"
        value={sessionKey ?? ''}
        onChange={e => setSessionKey(Number(e.target.value))}
      >
        {sessions.map(s => (
          <option key={s.session_key} value={s.session_key}>
            {s.year} {s.gp_name} — {s.session_name}
          </option>
        ))}
      </select>

      {/* Selected driver tags */}
      <div className="flex flex-wrap gap-2 mb-3">
        {selected.map(num => {
          const d = drivers.find(x => x.driver_number === num)
          if (!d) return null
          return (
            <button key={num}
              onClick={() => toggleDriver(num)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{ background: teamColour(d.team_colour), color: '#000' }}
            >
              {d.abbreviation} <X size={10} />
            </button>
          )
        })}
      </div>

      {/* Available drivers from this session */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {drivers.filter(d => !selected.includes(d.driver_number)).map(d => (
          <button key={d.driver_number}
            onClick={() => toggleDriver(d.driver_number)}
            disabled={selected.length >= 4}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border border-border text-zinc-400 hover:border-zinc-500 disabled:opacity-40 transition-colors"
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: teamColour(d.team_colour) }} />
            {d.abbreviation}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <LoadingSpinner text="Comparing drivers..." />
      ) : results.length >= 2 ? (
        <div className="space-y-4">

          {/* Driver header cards */}
          <div className={`grid gap-3 ${
            results.length === 2 ? 'grid-cols-2' :
            results.length === 3 ? 'grid-cols-3' : 'grid-cols-4'
          }`}>
            {results.map(d => (
              <div key={d.driver_number}
                className="bg-surface border border-border rounded-xl p-4 text-center relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                  style={{ background: teamColour(d.team_colour) }} />
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold text-sm mx-auto mb-2"
                  style={{ background: teamColour(d.team_colour) + '22', color: teamColour(d.team_colour) }}>
                  {d.driver_number}
                </div>
                <div className="font-display font-bold text-xl text-white">{d.abbreviation}</div>
                <div className="text-zinc-500 text-xs mt-0.5">{d.team_name}</div>
              </div>
            ))}
          </div>

          {/* Metric comparison bars */}
          {[
            { label: 'BEST LAP TIME',    key: 'best_lap_ms',         fmt: formatLapTime },
            { label: 'THEORETICAL BEST', key: 'theoretical_best_ms', fmt: formatLapTime },
            { label: 'SECTOR 1',  key: 'best_s1_ms', fmt: (v: number|null) => v ? `${(v/1000).toFixed(3)}s` : '—' },
            { label: 'SECTOR 2',  key: 'best_s2_ms', fmt: (v: number|null) => v ? `${(v/1000).toFixed(3)}s` : '—' },
            { label: 'SECTOR 3',  key: 'best_s3_ms', fmt: (v: number|null) => v ? `${(v/1000).toFixed(3)}s` : '—' },
          ].map(({ label, key, fmt }) => {
            const values = results.map(r => (r as any)[key] as number | null)
            const valid  = values.filter(Boolean) as number[]
            const min    = valid.length ? Math.min(...valid) : 0
            const max    = valid.length ? Math.max(...valid) : 1

            return (
              <div key={key} className="bg-surface border border-border rounded-xl p-4">
                <div className="text-[10px] tracking-widest text-zinc-500 uppercase mb-3">{label}</div>
                <div className="space-y-2">
                  {results.map(d => {
                    const val  = (d as any)[key] as number | null
                    const pct  = val ? ((max - val) / (max - min || 1)) * 55 + 40 : 35
                    const best = val === min && val !== null
                    const col  = teamColour(d.team_colour)
                    return (
                      <div key={d.driver_number} className="flex items-center gap-3">
                        <span className="font-mono text-xs text-zinc-500 w-8">{d.abbreviation}</span>
                        <div className="flex-1 h-7 bg-surface2 rounded overflow-hidden flex items-center">
                          <div className="h-full flex items-center justify-end pr-2 rounded transition-all duration-500"
                            style={{ width: `${pct}%`, background: col + (best ? 'FF' : '66') }}>
                            <span className="font-mono text-xs font-bold"
                              style={{ color: best ? '#fff' : '#aaa' }}>
                              {fmt(val)}
                            </span>
                          </div>
                        </div>
                        {best && <span className="text-[10px] font-mono text-green-400 w-8">BEST</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Gap summary */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[10px] tracking-widest text-zinc-500 uppercase mb-3">GAP TO FASTEST</div>
            {results.map(d => (
              <div key={d.driver_number}
                className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 rounded" style={{ background: teamColour(d.team_colour) }} />
                  <span className="font-mono text-sm text-white">{d.abbreviation}</span>
                </div>
                <span className={`font-mono text-sm ${d.gap_to_fastest_ms === 0 ? 'text-green-400' : 'text-zinc-400'}`}>
                  {d.gap_to_fastest_ms === 0 ? 'FASTEST' : formatGap(d.gap_to_fastest_ms)}
                </span>
              </div>
            ))}
          </div>

        </div>
      ) : selected.length < 2 ? (
        <div className="text-center py-16 text-zinc-600 text-sm">
          Select at least 2 drivers above to compare
        </div>
      ) : null}
    </div>
  )
}
