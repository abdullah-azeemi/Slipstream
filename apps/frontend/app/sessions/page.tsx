'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import { ToggleGroup } from '@/components/landing/Tabs'
import { getSessionRoute } from '@/lib/session-routing'
import { fetchWithAuth } from '@/lib/auth-token'
import { sessionTypeLabel } from '@/lib/utils'
import type { Session } from '@/types/f1'

type SessionFilter = 'ALL' | 'FP1' | 'FP2' | 'FP3' | 'Q' | 'SQ' | 'R'
type ResultSession = Session & {
  circuit_short_name?: string
  pole_time?: string
  winner_summary?: string
}

type WeekendGroup = {
  key: string
  year: number
  gp_name: string
  country?: string | null
  circuit?: string | null
  sessions: ResultSession[]
  startDate: string | null
  endDate: string | null
  round: number
}

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

const FILTER_OPTIONS: { key: SessionFilter; label: string }[] = [
  { key: 'ALL', label: 'All sessions' },
  { key: 'FP1', label: 'FP1' },
  { key: 'FP2', label: 'FP2' },
  { key: 'FP3', label: 'FP3' },
  { key: 'Q', label: 'Qualifying' },
  { key: 'SQ', label: 'Sprint' },
  { key: 'R', label: 'Race' },
]

// --- Helpers -----------------------------------------------------------------

function groupSessions(sessions: ResultSession[]): WeekendGroup[] {
  const map = new Map<string, ResultSession[]>()
  for (const s of sessions) {
    const key = `${s.year}__${s.gp_name}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }

  const typeOrder: Record<string, number> = { FP1: 0, FP2: 1, FP3: 2, SQ: 3, SS: 4, Q: 5, R: 6 }

  return Array.from(map.entries())
    .map(([key, rows]) => {
      const sortedRows = [...rows].sort((a, b) => {
        const timeDelta = new Date(a.date_start ?? 0).getTime() - new Date(b.date_start ?? 0).getTime()
        if (timeDelta !== 0) return timeDelta
        return (typeOrder[a.session_type] ?? 9) - (typeOrder[b.session_type] ?? 9)
      })

      const first = sortedRows[0]
      const start = sortedRows[0]?.date_start ?? null
      const end = sortedRows[sortedRows.length - 1]?.date_start ?? start

      return {
        key,
        year: first.year,
        gp_name: first.gp_name,
        country: first.country ?? null,
        circuit: first.circuit_short_name ?? null,
        sessions: sortedRows,
        startDate: start,
        endDate: end,
        round: 0,
      }
    })
    .sort((a, b) => new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime())
    .map((group, idx, arr) => ({
      ...group,
      round: arr.length - idx,
    }))
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start) return 'Date unavailable'
  const startDate = new Date(start)
  const endDate = end ? new Date(end) : startDate
  const sameMonth = startDate.toLocaleString('en-GB', { month: 'short' }) === endDate.toLocaleString('en-GB', { month: 'short' })
  const startLabel = startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const endLabel = endDate.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  return `${startLabel} to ${endLabel} ${startDate.getFullYear()}`
}

function weekendStatus(group: WeekendGroup) {
  const isSprint = group.sessions.some(s => s.session_type === 'SQ' || s.session_type === 'SS')
  const expected = isSprint ? 6 : 5
  const complete = group.sessions.length >= expected
  return {
    isSprint,
    complete,
    label: isSprint ? 'Sprint weekend' : complete ? 'Complete' : 'Syncing',
    detail: complete ? 'All sessions loaded' : `${group.sessions.length} of ${expected} sessions loaded`,
  }
}

function poleInfo(group: WeekendGroup) {
  // Prefer the Grand Prix qualifying (Q) pole; sprint weekends also have SQ.
  const q =
    group.sessions.find(s => s.session_type === 'Q') ??
    group.sessions.find(s => s.session_type === 'SQ')
  return {
    exists: Boolean(q),
    driver: q?.pole_driver ?? '—',
    time: q?.pole_time ?? (q ? 'Pending' : 'Not run'),
  }
}

function raceInfo(group: WeekendGroup) {
  const r = group.sessions.find(s => s.session_type === 'R')
  return {
    exists: Boolean(r),
    driver: r?.winner_driver ?? '—',
    summary: r?.winner_summary ?? (r ? 'Result pending' : 'Not run'),
  }
}

// --- Page -----------------------------------------------------------------

export default function SessionsPage() {
  const [sessions, setSessions] = useState<ResultSession[]>([])
  const [year, setYear] = useState<number | 'all'>('all')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('ALL')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchWithAuth(`${BASE}/api/v1/sessions`)
      .then(async r => {
        const data = await r.json().catch(() => null)
        if (!r.ok || !Array.isArray(data)) throw new Error(data?.error ?? `Sessions request failed (${r.status})`)
        setSessions(data as ResultSession[])
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Sessions could not be loaded'))
      .finally(() => setLoading(false))
  }, [])

  const allYears = useMemo(() => [...new Set(sessions.map(s => s.year))].sort((a, b) => b - a), [sessions])

  const grouped = useMemo(() => {
    const byYear = year === 'all' ? sessions : sessions.filter(s => s.year === year)
    const byType = sessionFilter === 'ALL'
      ? byYear
      : byYear.filter(s => s.session_type === sessionFilter || (sessionFilter === 'Q' && s.session_type === 'SQ'))
    return groupSessions(byType)
  }, [sessions, year, sessionFilter])

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return grouped
    return grouped.filter(g =>
      g.gp_name.toLowerCase().includes(q) ||
      (g.country ?? '').toLowerCase().includes(q) ||
      (g.circuit ?? '').toLowerCase().includes(q) ||
      String(g.round).includes(q),
    )
  }, [grouped, search])

  return (
    <div className={`lp ${geist.className}`}>
      <div className="dash">
        <div className="wrap">
          <header className="dash-head" style={{ maxWidth: 720 }}>
            <p className="caption-1 muted">Sessions</p>
            <h1 className="heading-3">Every race weekend, session by session</h1>
            <p className="body-3 muted" style={{ marginTop: 'var(--sp-100)' }}>
              Practice, qualifying and race data for each weekend. Open a session for results and analysis, or jump straight to its telemetry.
            </p>
          </header>

          <div className="tel-filters">
            <ToggleGroup
              label="Season"
              value={year}
              onChange={setYear}
              items={[{ key: 'all' as number | 'all', label: 'All seasons' }, ...allYears.map(y => ({ key: y as number | 'all', label: String(y) }))]}
            />
            <ToggleGroup
              label="Session type"
              value={sessionFilter}
              onChange={setSessionFilter}
              items={FILTER_OPTIONS.map(o => ({ key: o.key, label: o.label }))}
            />
            <label className="search">
              <MagnifyingGlass size={16} aria-hidden="true" />
              <span className="sr-only">Search Grand Prix, country or round</span>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search Grand Prix"
                className="body-5"
              />
            </label>
          </div>

          {loading ? (
            <div className="grid-3" aria-busy="true">
              {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className="skeleton" style={{ height: 220, borderRadius: 16 }} />)}
            </div>
          ) : error ? (
            <div className="inline-error" role="alert"><span className="body-6 muted">{error}</span></div>
          ) : visibleGroups.length === 0 ? (
            <div className="empty">
              <h2 className="heading-6">No sessions match</h2>
              <p className="body-6">Try another season, session type or search term.</p>
            </div>
          ) : (
            <>
              <p className="caption-1 muted" style={{ marginBottom: 'var(--sp-200)' }}>
                {visibleGroups.length} {visibleGroups.length === 1 ? 'weekend' : 'weekends'}
              </p>
              <div className="grid-3">
                {visibleGroups.map(group => {
                  const status = weekendStatus(group)
                  const pole = poleInfo(group)
                  const race = raceInfo(group)
                  return (
                    <article key={group.key} className="card">
                      <div className="post-meta caption-4">
                        <span className="tag">Round {group.round}</span>
                        <span className="tag">{status.label}</span>
                        <span>{group.year}</span>
                      </div>
                      <h2 className="heading-6">{group.gp_name}</h2>
                      <p className="body-6">
                        {[group.country, group.circuit].filter(Boolean).join(', ') || 'Circuit details pending'}
                        <br />
                        {formatDateRange(group.startDate, group.endDate)}
                      </p>

                      <ul className="result-list body-5" style={{ marginTop: 'var(--sp-75)' }}>
                        <li><span className="muted">Pole</span><span>{pole.driver}{pole.exists && pole.time !== 'Pending' ? `, ${pole.time}` : ''}</span></li>
                        <li><span className="muted">Winner</span><span>{race.driver}</span></li>
                      </ul>

                      <div className="chips" role="group" aria-label={`${group.gp_name} sessions`}>
                        {group.sessions.map(s => (
                          <Link key={s.session_key} href={getSessionRoute(s.session_key, s.session_type)} className="chip">
                            {s.session_type === 'SQ' ? 'Sprint quali' : s.session_type === 'S' ? 'Sprint' : s.session_type}
                            <span className="sr-only"> {sessionTypeLabel(s.session_type)}</span>
                          </Link>
                        ))}
                      </div>
                      <span className="caption-4 muted">{status.detail}</span>
                    </article>
                  )
                })}
              </div>
            </>
          )}
          {!loading && !error && (
            <p className="body-6 muted" style={{ marginTop: 'var(--sp-400)' }}>
              Select a session code to open it. Practice sessions open in telemetry; qualifying and races open the weekend overview.{' '}
              <Link href="/telemetry" style={{ textDecoration: 'underline' }}>Browse telemetry <ArrowRight size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /></Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
