'use client'
import { useEffect, useState } from 'react'
import { getCircuitImage, sessionTypeLabel } from '@/lib/utils'
import Link from 'next/link'
import Image from 'next/image'
import { Calendar, ChevronRight, ChevronDown } from 'lucide-react'
import type { Session } from '@/types/f1'

const API = typeof window !== 'undefined'
  ? (window.location.hostname === 'localhost' ? 'http://localhost:8000' : '')
  : 'http://localhost:8000'

function groupSessions(sessions: Session[]) {
  const map = new Map<string, Session[]>()
  for (const s of sessions) {
    const key = `${s.year}__${s.gp_name}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  const typeOrder: Record<string, number> = { FP1:0, FP2:1, FP3:2, SQ:3, SS:4, Q:5, R:6 }
  for (const [, arr] of map) {
    arr.sort((a,b) => (typeOrder[a.session_type]??9) - (typeOrder[b.session_type]??9))
  }
  return Array.from(map.entries())
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [allYears, setAllYears] = useState<number[]>([])
  const [year, setYear]         = useState<number | 'all'>('all')
  const [open, setOpen]         = useState(false)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch('http://localhost:8000/api/v1/sessions')
      .then(r => r.json())
      .then((data: Session[]) => {
        setSessions(data)
        const years = [...new Set(data.map(s => s.year))].sort((a,b) => b - a)
        setAllYears(years)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = year === 'all' ? sessions : sessions.filter(s => s.year === year)
  const sorted   = [...filtered].sort((a,b) => {
    if (!a.date_start || !b.date_start) return 0
    return new Date(b.date_start).getTime() - new Date(a.date_start).getTime()
  })
  const grouped = groupSessions(sorted)

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display font-bold text-2xl">Sessions</h1>
        <div className="relative">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 bg-surface border border-border text-white text-sm px-3 py-1.5 rounded-lg hover:border-zinc-500 transition-colors"
          >
            {year === 'all' ? 'All Years' : year}
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-1 bg-surface2 border border-border rounded-lg overflow-hidden z-10 min-w-[120px]">
              <button
                onClick={() => { setYear('all'); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface3 transition-colors ${year === 'all' ? 'text-red' : 'text-white'}`}
              >
                All Years
              </button>
              {allYears.map(y => (
                <button
                  key={y}
                  onClick={() => { setYear(y); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-surface3 transition-colors ${year === y ? 'text-red' : 'text-white'}`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-zinc-500 text-sm mb-5">All loaded F1 sessions</p>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-3 text-zinc-500">
          <div className="w-5 h-5 border-2 border-border border-t-red rounded-full animate-spin" />
          <span className="text-sm font-mono">Loading sessions...</span>
        </div>
      )}

      {!loading && grouped.length === 0 && (
        <div className="text-center py-16 text-zinc-600 text-sm">No sessions available.</div>
      )}

      <div className="space-y-3">
        {grouped.map(([groupKey, gpSessions]) => {
          const first = gpSessions[0]
          return (
            <div key={groupKey} className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="flex items-center gap-4">
                <div className="w-20 h-16 flex-shrink-0 relative">
                  <Image
                    src={getCircuitImage(first.gp_name)}
                    alt={first.gp_name}
                    fill sizes="80px"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-black/30" />
                </div>
                <div className="flex-1 py-3 pr-4">
                  <span className="text-zinc-600 text-xs font-mono">{first.year}</span>
                  <div className="font-semibold text-white text-sm">{first.gp_name}</div>
                  {first.date_start && (
                    <div className="flex items-center gap-1 text-zinc-500 text-xs mt-0.5">
                      <Calendar size={10} />
                      {new Date(first.date_start).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t border-border divide-y divide-border">
                {gpSessions.map(session => (
                  <Link
                    key={session.session_key}
                    href={`/sessions/${session.session_key}`}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-surface2 transition-colors group"
                  >
                    <span className="text-sm text-zinc-300 group-hover:text-white transition-colors">
                      {sessionTypeLabel(session.session_type)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        session.session_type === 'R'
                          ? 'bg-red/20 text-red'
                          : session.session_type === 'Q' || session.session_type === 'SQ'
                          ? 'bg-yellow-500/10 text-yellow-400'
                          : 'bg-zinc-700/40 text-zinc-400'
                      }`}>
                        {session.session_type}
                      </span>
                      <ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-300 transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}