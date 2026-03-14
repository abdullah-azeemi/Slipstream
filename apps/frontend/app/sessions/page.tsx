'use client'
import { useEffect, useState } from 'react'
import { getCircuitImage, sessionTypeLabel } from '@/lib/utils'
import Link from 'next/link'
import Image from 'next/image'
import { Calendar, ChevronRight, ChevronDown } from 'lucide-react'
import type { Session } from '@/types/f1'

function groupSessions(sessions: Session[]) {
  const map = new Map<string, Session[]>()
  for (const s of sessions) {
    const key = `${s.year}__${s.gp_name}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  const typeOrder: Record<string, number> = { FP1: 0, FP2: 1, FP3: 2, SQ: 3, SS: 4, Q: 5, R: 6 }
  for (const [, arr] of map)
    arr.sort((a, b) => (typeOrder[a.session_type] ?? 9) - (typeOrder[b.session_type] ?? 9))
  return Array.from(map.entries())
}

const SESSION_COLOUR: Record<string, string> = {
  FP1: '#3671C6', FP2: '#3671C6', FP3: '#3671C6',
  SQ: '#FF8000', SS: '#FF8000', Q: '#FFD700', R: '#E8002D',
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [allYears, setAllYears] = useState<number[]>([])
  const [year,     setYear]     = useState<number | 'all'>('all')
  const [open,     setOpen]     = useState(false)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('http://localhost:8000/api/v1/sessions')
      .then(r => r.json())
      .then((data: Session[]) => {
        setSessions(data)
        setAllYears([...new Set(data.map(s => s.year))].sort((a, b) => b - a))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = year === 'all' ? sessions : sessions.filter(s => s.year === year)
  const sorted   = [...filtered].sort((a, b) =>
    new Date(b.date_start ?? 0).getTime() - new Date(a.date_start ?? 0).getTime()
  )
  const grouped = groupSessions(sorted)

  return (
    <div style={{ padding: '16px', maxWidth: '640px', margin: '0 auto' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
        <h1 style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '28px', color: '#fff', margin: 0 }}>
          Sessions
        </h1>

        {/* Year filter */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: '#111111', border: '1px solid #2A2A2A',
              color: '#fff', fontSize: '13px', padding: '6px 12px',
              borderRadius: '10px', cursor: 'pointer', fontFamily: 'monospace',
            }}
          >
            {year === 'all' ? 'All Years' : year}
            <ChevronDown size={13} style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
          </button>
          {open && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 4px)',
              background: '#161616', border: '1px solid #2A2A2A',
              borderRadius: '10px', overflow: 'hidden', zIndex: 50, minWidth: '120px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {(['all', ...allYears] as (number | 'all')[]).map(y => (
                <button
                  key={y}
                  onClick={() => { setYear(y); setOpen(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '9px 14px', fontSize: '13px', cursor: 'pointer',
                    background: year === y ? '#1E1E1E' : 'transparent',
                    color: year === y ? '#fff' : '#71717A',
                    fontFamily: 'monospace', border: 'none',
                    borderBottom: '1px solid #1A1A1A',
                  }}
                >
                  {y === 'all' ? 'All Years' : y}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p style={{ color: '#52525B', fontSize: '13px', marginBottom: '20px', fontFamily: 'monospace' }}>
        {grouped.length} Grand Prix{grouped.length !== 1 ? '' : ''} loaded
      </p>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px' }}>
          Loading sessions...
        </div>
      )}

      {/* Empty */}
      {!loading && grouped.length === 0 && (
        <div style={{ textAlign: 'center', padding: '64px 0', color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px' }}>
          No sessions available.
        </div>
      )}

      {/* GP cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {grouped.map(([groupKey, gpSessions]) => {
          const first = gpSessions[0]
          return (
            <div key={groupKey} style={{
              background: '#111111', border: '1px solid #1E1E1E',
              borderRadius: '16px', overflow: 'hidden',
            }}>
              {/* GP header — image left, info right, NO overlap */}
              <div style={{ display: 'flex', alignItems: 'stretch' }}>

                {/* Circuit image — fixed size, doesn't overlap text */}
                <div style={{ width: '88px', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
                  <Image
                    src={getCircuitImage(first.gp_name)}
                    alt={first.gp_name}
                    fill
                    sizes="88px"
                    style={{ objectFit: 'cover', opacity: 0.7 }}
                  />
                  {/* Gradient fade to the right */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to right, transparent 60%, #111111 100%)',
                  }} />
                </div>

                {/* GP info — in its own box, never overlapping image */}
                <div style={{ flex: 1, padding: '14px 16px 14px 12px' }}>
                  <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', marginBottom: '3px' }}>
                    {first.year}
                  </div>
                  <div style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '18px', color: '#fff', lineHeight: 1.1, marginBottom: '5px' }}>
                    {first.gp_name}
                  </div>
                  {first.date_start && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#52525B', fontSize: '11px', fontFamily: 'monospace' }}>
                      <Calendar size={10} />
                      {new Date(first.date_start).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Session rows */}
              <div style={{ borderTop: '1px solid #161616' }}>
                {gpSessions.map((session, si) => {
                  const colour  = SESSION_COLOUR[session.session_type] ?? '#71717A'
                  const isLast  = si === gpSessions.length - 1
                  const isRace  = session.session_type === 'R' || session.session_type === 'S'
                  const isQuali = session.session_type === 'Q' || session.session_type === 'SQ'
                  return (
                    <Link
                      key={session.session_key}
                      href={`/sessions/${session.session_key}`}
                      style={{ textDecoration: 'none' }}
                    >
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '11px 16px',
                        borderBottom: isLast ? 'none' : '1px solid #0F0F0F',
                        transition: 'background 0.12s',
                        cursor: 'pointer',
                      }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#161616')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        {/* Left: colour stripe + session name */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: '3px', height: '28px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: '13px', color: '#E4E4E7', fontWeight: 500 }}>
                              {sessionTypeLabel(session.session_type)}
                            </div>
                            {session.date_start && (
                              <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46', marginTop: '1px' }}>
                                {new Date(session.date_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: type badge + chevron */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            fontSize: '10px', fontFamily: 'monospace', fontWeight: 700,
                            padding: '2px 8px', borderRadius: '6px',
                            background: `${colour}18`,
                            color: colour,
                            border: `1px solid ${colour}33`,
                          }}>
                            {session.session_type}
                          </span>
                          <ChevronRight size={14} style={{ color: '#3F3F46' }} />
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}