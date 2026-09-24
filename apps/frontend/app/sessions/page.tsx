'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Radio,
  Flag,
  Clock3,
  Search,
} from 'lucide-react'
import { getSessionOverviewRoute, getSessionTelemetryRoute } from '@/lib/session-routing'
import { sessionTypeLabel } from '@/lib/utils'
import type { Session } from '@/types/f1'

const serif = "'Playfair Display', Georgia, serif"
const label = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#9CA3AF',
} as const

type SessionFilter = 'ALL' | 'FP1' | 'FP2' | 'FP3' | 'Q' | 'SQ' | 'R'
type ResultSession = Session & {
  circuit_short_name?: string
  pole_driver?: string
  pole_time?: string
  winner_driver?: string
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

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const SESSION_COLOUR: Record<string, string> = {
  FP1: '#3671C6',
  FP2: '#3671C6',
  FP3: '#3671C6',
  SQ: '#B45309',
  SS: '#B45309',
  Q: '#B45309',
  R: '#DC2626',
}

const FILTER_OPTIONS: { key: SessionFilter; label: string }[] = [
  { key: 'ALL', label: 'All Sessions' },
  { key: 'FP1', label: 'FP1' },
  { key: 'FP2', label: 'FP2' },
  { key: 'FP3', label: 'FP3' },
  { key: 'Q', label: 'Qualifying' },
  { key: 'SQ', label: 'Sprint' },
  { key: 'R', label: 'Grand Prix' },
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
  return `${startLabel} - ${endLabel} ${startDate.getFullYear()}`
}

function weekendStatus(group: WeekendGroup) {
  const isSprint = group.sessions.some(s => s.session_type === 'SQ' || s.session_type === 'SS')
  const expected = isSprint ? 6 : 5
  const complete = group.sessions.length >= expected
  return {
    isSprint,
    label: isSprint ? 'Sprint Weekend' : complete ? 'Verified' : 'Syncing',
    color: isSprint ? '#B45309' : complete ? '#15803D' : '#94A3B8',
    bg: isSprint ? 'rgba(180,83,9,0.08)' : complete ? 'rgba(21,128,61,0.08)' : 'rgba(148,163,184,0.12)',
    stateText: complete ? 'All Sessions Active' : `${group.sessions.length} Session${group.sessions.length === 1 ? '' : 's'} Synced`,
  }
}

function poleInfo(group: WeekendGroup) {
  const q = group.sessions.find(s => s.session_type === 'Q' || s.session_type === 'SQ')
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
  const [allYears, setAllYears] = useState<number[]>([])
  const [year, setYear] = useState<number | 'all'>('all')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('ALL')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    fetch(`${BASE}/api/v1/sessions`)
      .then(r => r.json())
      .then((data: ResultSession[] | { error?: string }) => {
        const rows = Array.isArray(data) ? data : []
        setSessions(rows)
        setAllYears([...new Set(rows.map(s => s.year))].sort((a, b) => b - a))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filteredByYear = year === 'all' ? sessions : sessions.filter(s => s.year === year)
  const filteredByType = sessionFilter === 'ALL'
    ? filteredByYear
    : filteredByYear.filter(s => s.session_type === sessionFilter || (sessionFilter === 'Q' && s.session_type === 'SQ'))

  const grouped = useMemo(() => groupSessions(filteredByType), [filteredByType])

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return grouped
    return grouped.filter(g =>
      g.gp_name.toLowerCase().includes(q) ||
      (g.country ?? '').toLowerCase().includes(q) ||
      (g.circuit ?? '').toLowerCase().includes(q) ||
      String(g.round).includes(q)
    )
  }, [grouped, search])

  const yearLabel = year === 'all' ? 'All Championships' : `${year} Championship`

  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF', color: '#111827', fontFamily: 'Inter, sans-serif' }}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '1160px', margin: '0 auto', padding: isMobile ? '24px 16px 56px' : '36px 32px 64px' }}>
        {/* ---------------- Hero ---------------- */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#DC2626', display: 'inline-block' }} />
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6B7280' }}>
              Session Archive
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ maxWidth: '640px' }}>
              <h1 style={{
                margin: 0, color: '#111827', fontSize: isMobile ? '2.4rem' : 'clamp(2.4rem, 4.6vw, 3.6rem)',
                lineHeight: 1.12, fontWeight: 400, fontFamily: serif, letterSpacing: '-0.02em',
              }}>
                Historical Archive
              </h1>
              <p style={{ margin: '14px 0 0', color: '#6B7280', fontSize: '14px', lineHeight: 1.7, fontFamily: 'Inter, sans-serif' }}>
                Complete telemetry streams, calibrated high-frequency session timelines, and engineered race analytics for every Grand Prix synchronized in the current global telemetry pool.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ padding: '14px 18px', borderRadius: '16px', background: '#F9FAFB', border: '1px solid #F3F4F6', minWidth: '110px' }}>
                <div style={{ ...label, marginBottom: '8px' }}>
                  Grand Prix
                </div>
                <div style={{ color: '#111827', fontSize: '24px', fontFamily: 'Inter, sans-serif', fontWeight: 700, lineHeight: 1 }}>{grouped.length}</div>
                <div style={{ fontSize: '10px', color: '#6B7280', fontFamily: 'Inter, sans-serif', marginTop: '6px' }}>Weekends in view</div>
              </div>

              <div style={{ padding: '14px 18px', borderRadius: '16px', background: '#F9FAFB', border: '1px solid #F3F4F6', minWidth: '110px' }}>
                <div style={{ ...label, marginBottom: '8px' }}>
                  Sessions
                </div>
                <div style={{ color: '#111827', fontSize: '24px', fontFamily: 'Inter, sans-serif', fontWeight: 700, lineHeight: 1 }}>{filteredByType.length}</div>
                <div style={{ fontSize: '10px', color: '#6B7280', fontFamily: 'Inter, sans-serif', marginTop: '6px' }}>FP1 → Race</div>
              </div>

              <div style={{ padding: '14px 18px', borderRadius: '16px', background: '#F9FAFB', border: '1px solid #F3F4F6', minWidth: '150px' }}>
                <div style={{ ...label, marginBottom: '8px' }}>
                  Scope
                </div>
                <div style={{ color: '#111827', fontSize: '18px', fontFamily: 'Inter, sans-serif', fontWeight: 700, lineHeight: 1 }}>
                  {year === 'all' ? 'All Seasons' : `${year} Season`}
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280', fontFamily: 'Inter, sans-serif', marginTop: '6px' }}>Full data set</div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- Filters + search ---------------- */}
        <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9CA3AF', fontWeight: 700, marginRight: '2px' }}>
              Filter:
            </span>
            {FILTER_OPTIONS.map(option => {
              const active = option.key === sessionFilter
              return (
                <button
                  key={option.key}
                  onClick={() => setSessionFilter(option.key)}
                  style={{
                    padding: '8px 15px',
                    borderRadius: '999px',
                    border: active ? '1px solid #111827' : '1px solid #E5E7EB',
                    background: active ? '#111827' : '#FFFFFF',
                    color: active ? '#FFFFFF' : '#6B7280',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search circuit, venue or round..."
                style={{
                  padding: '10px 14px 10px 34px',
                  borderRadius: '999px',
                  border: '1px solid #E5E7EB',
                  background: '#FFFFFF',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '12.5px',
                  color: '#111827',
                  width: isMobile ? '100%' : '230px',
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#111827',
                  fontSize: '12.5px', padding: '10px 14px', borderRadius: '999px', cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif', fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                {yearLabel}
                <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </button>
              {open && (
                <div style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                  background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '16px',
                  overflow: 'hidden', zIndex: 40, minWidth: '170px', boxShadow: '0 20px 48px rgba(17,24,39,0.12)',
                }}>
                  {(['all', ...allYears] as (number | 'all')[]).map(y => (
                    <button
                      key={y}
                      onClick={() => { setYear(y); setOpen(false) }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px',
                        fontSize: '12.5px', cursor: 'pointer',
                        background: year === y ? 'rgba(17,24,39,0.05)' : 'transparent',
                        color: year === y ? '#111827' : '#6B7280',
                        fontFamily: 'Inter, sans-serif', fontWeight: 600, border: 'none',
                        borderBottom: '1px solid #F3F4F6',
                      }}
                    >
                      {y === 'all' ? 'All Championships' : `${y} Championship`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ---------------- Rows ---------------- */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '64px 0', color: '#6B7280', fontFamily: 'Inter, sans-serif', fontSize: '13px' }}>
            Loading archive...
          </div>
        )}

        {!loading && visibleGroups.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 0', color: '#6B7280', fontFamily: 'Inter, sans-serif', fontSize: '13px' }}>
            No archive sessions match this filter.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {visibleGroups.map(group => {
            const status = weekendStatus(group)
            const pole = poleInfo(group)
            const race = raceInfo(group)

            return (
              <div
                key={group.key}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  borderRadius: '18px',
                  boxShadow: '0 2px 12px rgba(17,24,39,0.04)',
                  padding: isMobile ? '14px' : '16px 18px',
                }}
              >
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '44px 1fr 34px' : '52px 1.5fr 1fr 1fr auto 34px',
                  gap: isMobile ? '10px' : '16px',
                  alignItems: 'center',
                }}>
                  {/* Round badge */}
                  <div style={{
                    borderRadius: '10px', background: '#F3F4F6', border: '1px solid #F3F4F6',
                    padding: '8px 6px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '8px', color: '#9CA3AF', fontFamily: 'Inter, sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>Rnd</div>
                    <div style={{ color: '#111827', fontSize: isMobile ? '16px' : '20px', lineHeight: 1, fontFamily: 'Inter, sans-serif', fontWeight: 700, marginTop: '3px' }}>
                      {String(group.round).padStart(2, '0')}
                    </div>
                  </div>

                  {/* Name + meta */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                      <span style={{ fontSize: isMobile ? '15px' : '17px', color: '#111827', fontFamily: serif, fontWeight: 500 }}>
                        {group.gp_name}
                      </span>
                      <span style={{
                        padding: '3px 9px', borderRadius: '999px', background: status.bg, color: status.color,
                        fontSize: '9px', fontFamily: 'Inter, sans-serif', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                      }}>
                        {status.label}
                      </span>
                      {!isMobile && (
                        <span style={{
                          padding: '3px 9px', borderRadius: '999px', background: '#F9FAFB', color: '#6B7280',
                          fontSize: '9px', fontFamily: 'Inter, sans-serif', fontWeight: 600,
                        }}>
                          {group.sessions.length} Session{group.sessions.length === 1 ? '' : 's'} Logged
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', color: '#6B7280', fontSize: '11.5px', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
                      {group.circuit && <span>{group.circuit}</span>}
                      {group.country && <span>· {group.country}</span>}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={11} />
                        {formatDateRange(group.startDate, group.endDate)}
                      </span>
                    </div>
                  </div>

                  {/* Pole + Winner (desktop only) */}
                  {!isMobile && (
                    <div style={{ borderLeft: '1px solid #F3F4F6', paddingLeft: '14px' }}>
                      <div style={{ ...label, marginBottom: '5px' }}>
                        Qualifying Pole
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{ fontSize: '12.5px', color: '#111827', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>{pole.driver}</span>
                        <span style={{ fontSize: '10.5px', color: '#B45309', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{pole.time}</span>
                      </div>
                    </div>
                  )}

                  {!isMobile && (
                    <div style={{ borderLeft: '1px solid #F3F4F6', paddingLeft: '14px' }}>
                      <div style={{ ...label, marginBottom: '5px' }}>
                        Race Winner
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{ fontSize: '12.5px', color: '#111827', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>{race.driver}</span>
                        <span style={{ fontSize: '10.5px', color: '#DC2626', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{race.summary}</span>
                      </div>
                    </div>
                  )}

                  {/* Telemetry state (desktop only) */}
                  {!isMobile && (
                    <div style={{ borderLeft: '1px solid #F3F4F6', paddingLeft: '14px', minWidth: '130px' }}>
                      <div style={{ ...label, marginBottom: '5px' }}>
                        Archive State
                      </div>
                      <div style={{ fontSize: '12px', color: '#111827', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>
                        {status.stateText}
                      </div>
                    </div>
                  )}

                  {/* Chevron */}
                  <Link
                    href={getSessionOverviewRoute(group.sessions[group.sessions.length - 1].session_key)}
                    style={{
                      width: isMobile ? '30px' : '34px', height: isMobile ? '30px' : '34px', borderRadius: '50%',
                      background: '#F3F4F6', border: '1px solid #E5E7EB',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#111827', textDecoration: 'none',
                    }}
                  >
                    <ChevronRight size={15} />
                  </Link>
                </div>

                {/* Session chip row */}
                <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #F3F4F6' }}>
                  {group.sessions.map(session => {
                    const colour = SESSION_COLOUR[session.session_type] ?? '#94A3B8'
                    const isHighlight = session.session_type === 'Q' || session.session_type === 'SQ' || session.session_type === 'R'
                    const Icon = session.session_type === 'R' ? Flag : (session.session_type === 'Q' || session.session_type === 'SQ') ? Radio : Clock3
                    return (
                      <Link
                        key={session.session_key}
                        href={getSessionTelemetryRoute(session.session_key)}
                        style={{
                          textDecoration: 'none',
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          color: isHighlight ? colour : '#374151',
                          background: isHighlight ? `${colour}0f` : '#F9FAFB',
                          border: `1px solid ${isHighlight ? `${colour}26` : '#F3F4F6'}`,
                          borderRadius: '999px',
                          padding: '6px 12px',
                          fontSize: '11.5px',
                          fontFamily: 'Inter, sans-serif',
                          fontWeight: 600,
                        }}
                      >
                        <Icon size={11} />
                        {sessionTypeLabel(session.session_type)}
                        <span style={{ fontSize: '9.5px', opacity: 0.75 }}>{session.session_type}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* ---------------- Engineering spotlight (static showcase) ---------------- */}
        {!loading && visibleGroups.length > 0 && (
          <section style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: '28px',
            alignItems: 'center',
            marginTop: '24px',
          }}>
            <div style={{
              background: '#F3F4F6', borderRadius: '24px', padding: isMobile ? '20px 16px' : '40px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: '100%', maxWidth: '440px', background: '#FFFFFF', borderRadius: '16px', padding: '24px',
                border: '1px solid #E5E7EB', boxShadow: '0 10px 30px rgba(17,24,39,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#9CA3AF' }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
                    Generate Telemetry Overlay
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div style={{ background: '#F9FAFB', padding: '9px 11px', borderRadius: '10px', border: '1px solid #F3F4F6' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: '6px', textTransform: 'uppercase' }}>
                      Primary Driver
                    </div>
                    <div style={{ fontSize: '12px', fontFamily: 'Inter, sans-serif', fontWeight: 600, color: '#111827' }}>Driver A</div>
                  </div>
                  <div style={{ background: '#F9FAFB', padding: '9px 11px', borderRadius: '10px', border: '1px solid #F3F4F6' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: '6px', textTransform: 'uppercase' }}>
                      Comparison Car
                    </div>
                    <div style={{ fontSize: '12px', fontFamily: 'Inter, sans-serif', fontWeight: 600, color: '#111827' }}>Driver B</div>
                  </div>
                </div>

                <div style={{ background: '#111827', borderRadius: '14px', padding: '14px', height: '140px', position: 'relative', overflow: 'hidden' }}>
                  <svg viewBox="0 0 300 100" style={{ width: '100%', height: '100%' }} preserveAspectRatio="none">
                    <polyline points="0,70 40,55 80,60 120,30 160,45 200,25 240,50 300,35" fill="none" stroke="#F5A623" strokeWidth="2" />
                    <polyline points="0,75 40,65 80,50 120,45 160,60 200,40 240,55 300,45" fill="none" stroke="#DC2626" strokeWidth="2" />
                  </svg>
                </div>

                <button style={{
                  marginTop: '14px', width: '100%', padding: '11px', borderRadius: '999px', border: 'none',
                  background: '#111827', color: '#FFFFFF', fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '12.5px', cursor: 'pointer',
                }}>
                  Run Micro-Sector Matrix
                </button>
              </div>
            </div>

            <div>
              <div style={{ ...label, marginBottom: '10px' }}>
                Engineering Spotlight
              </div>
              <h2 style={{ margin: 0, fontSize: isMobile ? '1.5rem' : '1.9rem', fontWeight: 400, color: '#111827', fontFamily: serif, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                {visibleGroups[0].gp_name} Telemetry Breakdown
              </h2>
              <p style={{ margin: '12px 0 20px', color: '#6B7280', fontSize: '14px', lineHeight: 1.7, fontFamily: 'Inter, sans-serif' }}>
                A closer look at how session pace, tyre management, and sector deltas evolved across the {visibleGroups[0].gp_name} weekend — built from the synchronized session data above.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  ['Sessions Logged', `${visibleGroups[0].sessions.length}`],
                  ['Weekend Format', weekendStatus(visibleGroups[0]).isSprint ? 'Sprint Weekend' : 'Standard Weekend'],
                  ['Archive Status', weekendStatus(visibleGroups[0]).label],
                ].map(([labelText, value]) => (
                  <div key={labelText} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F3F4F6', paddingBottom: '8px' }}>
                    <span style={{ fontSize: '11.5px', color: '#6B7280', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{labelText}</span>
                    <span style={{ fontSize: '12.5px', color: '#111827', fontFamily: 'Inter, sans-serif', fontWeight: 700 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
