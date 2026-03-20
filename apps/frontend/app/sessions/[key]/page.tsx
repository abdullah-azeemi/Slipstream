'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { formatLapTime, formatGap, teamColour, sessionTypeLabel } from '@/lib/utils'
import TyreChip from '@/components/ui/TyreChip'
import Link from 'next/link'
import { ArrowLeft, Database, Activity, GitBranch } from 'lucide-react'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Types ─────────────────────────────────────────────────────────────────────

type Session = {
  session_key: number
  year: number
  gp_name: string
  session_type: string
  session_name: string
  date_start: string
}

// ── Session type config ───────────────────────────────────────────────────────

const SESSION_TYPE_ORDER = ['FP1', 'FP2', 'FP3', 'SQ', 'Q', 'S', 'R']

const SESSION_META: Record<string, { label: string; color: string; desc: string }> = {
  FP1: { label: 'Practice 1',   color: '#3671C6', desc: 'Installation & long runs' },
  FP2: { label: 'Practice 2',   color: '#3671C6', desc: 'Race simulation day' },
  FP3: { label: 'Practice 3',   color: '#3671C6', desc: 'Qualifying prep' },
  SQ:  { label: 'Sprint Quali', color: '#FF8000', desc: 'Sprint qualifying' },
  Q:   { label: 'Qualifying',   color: '#FFD700', desc: 'Grid positions' },
  S:   { label: 'Sprint',       color: '#FF8000', desc: 'Sprint race' },
  R:   { label: 'Race',         color: '#E8002D', desc: 'Grand Prix' },
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SessionPage() {
  const params     = useParams()
  const keyStr     = Array.isArray(params.key) ? params.key[0] : (params.key ?? '')
  const sessionKey = parseInt(keyStr)

  const [session,     setSession]     = useState<Session | null>(null)
  const [siblings,    setSiblings]    = useState<Session[]>([])
  const [raceData,    setRaceData]    = useState<any[]>([])
  const [qualiLaps,   setQualiLaps]   = useState<any[]>([])
  const [loading,     setLoading]     = useState(true)
  const [dataLoading, setDataLoading] = useState(false)

  // Step 1: load current session
  useEffect(() => {
    setLoading(true)
    fetch(`${BASE}/api/v1/sessions/${sessionKey}`)
      .then(r => r.json())
      .then(s => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [sessionKey])

  // Step 2: load all sessions to find siblings (same GP + year)
  useEffect(() => {
    if (!session) return
    fetch(`${BASE}/api/v1/sessions`)
      .then(r => r.json())
      .then((all: Session[]) => {
        const sibs = all
          .filter(s => s.gp_name === session.gp_name && s.year === session.year)
          .sort((a, b) =>
            SESSION_TYPE_ORDER.indexOf(a.session_type) - SESSION_TYPE_ORDER.indexOf(b.session_type)
          )
        setSiblings(sibs)
      })
      .catch(() => {})
  }, [session?.session_key])

  // Step 3: load leaderboard data
  useEffect(() => {
    if (!session?.session_type) return
    const type  = session.session_type
    const isR   = type === 'R' || type === 'S'
    const isFP  = type.startsWith('FP')
    if (isFP) return  // FP has no leaderboard

    setDataLoading(true)
    const url = isR
      ? `${BASE}/api/v1/sessions/${sessionKey}/race-results`
      : `${BASE}/api/v1/sessions/${sessionKey}/fastest`

    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (isR) setRaceData(Array.isArray(d) ? d : [])
        else     setQualiLaps(Array.isArray(d) ? d : (d.laps ?? []))
      })
      .catch(() => {})
      .finally(() => setDataLoading(false))
  }, [session?.session_key, session?.session_type])

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px' }}>
        Loading...
      </div>
    )
  }

  if (!session) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#E8002D', fontFamily: 'monospace' }}>
        Session not found
      </div>
    )
  }

  // ── Derived values — all null-safe ────────────────────────────────────────

  const type    = session.session_type ?? ''
  const isRace  = type === 'R' || type === 'S'
  const isFP    = type.startsWith('FP')
  const isQuali = !isRace && !isFP
  const meta    = SESSION_META[type] ?? { label: session.session_name ?? type, color: '#71717A', desc: '' }

  const hasData = isRace
    ? raceData.length > 0
    : isFP
    ? true
    : qualiLaps.length > 0

  return (
    <div style={{ padding: '16px', maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Back */}
      <Link href="/sessions" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#52525B', fontSize: '13px', textDecoration: 'none' }}>
        <ArrowLeft size={14} /> All Sessions
      </Link>

      {/* GP name */}
      <div>
        <div style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.14em', marginBottom: '3px' }}>
          {session.year} · FORMULA 1
        </div>
        <h1 style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '32px', color: '#fff', lineHeight: 1, margin: 0 }}>
          {session.gp_name}
        </h1>
      </div>

      {/* ── Session switcher tabs ─────────────────────────────────────── */}
      {siblings.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {siblings.map(sib => {
            const isActive = sib.session_key === sessionKey
            const sibMeta  = SESSION_META[sib.session_type] ?? { color: '#71717A', desc: '' }
            return (
              <Link
                key={sib.session_key}
                href={`/sessions/${sib.session_key}`}
                style={{ textDecoration: 'none' }}
              >
                <div style={{
                  display:       'flex',
                  flexDirection: 'column',
                  alignItems:    'center',
                  padding:       '8px 16px',
                  borderRadius:  '12px',
                  cursor:        'pointer',
                  transition:    'all 0.15s',
                  border:        isActive ? `1.5px solid ${sibMeta.color}` : '1.5px solid #2A2A2A',
                  background:    isActive ? `${sibMeta.color}18` : '#111111',
                  minWidth:      '58px',
                  textAlign:     'center',
                }}>
                  <span style={{
                    fontSize: '15px', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700,
                    color: isActive ? sibMeta.color : '#71717A',
                    letterSpacing: '0.02em',
                  }}>
                    {sib.session_type}
                  </span>
                  <span style={{
                    fontSize: '8px', fontFamily: 'monospace',
                    color: isActive ? sibMeta.color + 'AA' : '#3F3F46',
                    marginTop: '2px',
                  }}>
                    {sibMeta.desc}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Current session label + data status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ padding: '4px 12px', borderRadius: '20px', background: `${meta.color}18`, border: `1px solid ${meta.color}44` }}>
          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: meta.color, fontWeight: 700 }}>
            {meta.label.toUpperCase()}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', background: hasData ? '#2CF4C518' : '#1A1A1A', border: `1px solid ${hasData ? '#2CF4C544' : '#2A2A2A'}` }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: hasData ? '#2CF4C5' : '#3F3F46' }} />
          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: hasData ? '#2CF4C5' : '#52525B' }}>
            {hasData ? 'DATA LOADED' : 'NO DATA'}
          </span>
        </div>
      </div>

      {/* ── No data state ─────────────────────────────────────────────── */}
      {!hasData && !isFP && (
        <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px', padding: '32px', textAlign: 'center' }}>
          <Database size={32} style={{ color: '#3F3F46', margin: '0 auto 12px' }} />
          <div style={{ color: '#fff', fontWeight: 600, fontSize: '15px', marginBottom: '6px' }}>No data ingested yet</div>
          <div style={{ color: '#52525B', fontSize: '13px', marginBottom: '16px' }}>
            Run the ingestion script to load lap data for this session.
          </div>
          <code style={{
            display: 'block', background: '#0D0D0D', border: '1px solid #2A2A2A',
            color: '#A1A1AA', fontSize: '11px', padding: '12px 16px', borderRadius: '10px',
            fontFamily: 'monospace', textAlign: 'left', maxWidth: '380px', margin: '0 auto',
          }}>
            uv run python -m ingestion.ingest_session \<br />
            &nbsp;&nbsp;--year {session.year} \<br />
            &nbsp;&nbsp;--gp &quot;{session.gp_name.replace(' Grand Prix', '')}&quot; \<br />
            &nbsp;&nbsp;--session {type}
          </code>
        </div>
      )}

      {/* ── Race leaderboard ──────────────────────────────────────────── */}
      {isRace && hasData && !dataLoading && (
        <div style={{ background: '#111111', border: '1px solid #1E1E1E', borderRadius: '16px', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', padding: '10px 16px', borderBottom: '1px solid #161616' }}>
            {['POS', 'DRIVER', 'LAPS / GAP'].map((h, i) => (
              <span key={h} style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', letterSpacing: '0.12em', textAlign: i === 2 ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>
          {raceData.map((driver: any, i: number) => {
            const colour   = teamColour(driver.team_colour, driver.team_name)
            const isWinner = i === 0
            return (
              <div key={driver.driver_number} style={{
                display: 'grid', gridTemplateColumns: '44px 1fr auto',
                padding: '12px 16px', alignItems: 'center',
                borderBottom: i < raceData.length - 1 ? '1px solid #0D0D0D' : 'none',
                background: isWinner ? '#141414' : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div style={{ width: '3px', height: '30px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: isWinner ? '#FFD700' : '#52525B', fontWeight: isWinner ? 700 : 400 }}>
                    {i + 1}
                  </span>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{driver.abbreviation}</span>
                    {driver.compound && <TyreChip compound={driver.compound} />}
                    {isWinner && (
                      <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#FFD700', background: '#FFD70018', padding: '1px 6px', borderRadius: '4px', border: '1px solid #FFD70033' }}>
                        WINNER
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: '#52525B' }}>{driver.team_name}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', fontFamily: 'monospace', color: '#71717A' }}>{driver.total_laps} laps</div>
                  <div style={{ fontSize: '11px', fontFamily: 'monospace', color: isWinner ? '#2CF4C5' : '#3F3F46', marginTop: '1px' }}>
                    {isWinner ? '—' : driver.laps_down ? `+${driver.laps_down} lap${driver.laps_down > 1 ? 's' : ''}` : driver.gap_ms ? formatGap(driver.gap_ms) : '—'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Qualifying leaderboard ────────────────────────────────────── */}
      {isQuali && hasData && !dataLoading && (
        <div style={{ background: '#111111', border: '1px solid #1E1E1E', borderRadius: '16px', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', padding: '10px 16px', borderBottom: '1px solid #161616' }}>
            {['POS', 'DRIVER', 'TIME / GAP'].map((h, i) => (
              <span key={h} style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', letterSpacing: '0.12em', textAlign: i === 2 ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>
          {qualiLaps.map((lap: any, i: number) => {
            const colour  = teamColour(lap.team_colour, lap.team_name)
            const isFirst = i === 0
            const gap     = isFirst ? null : lap.lap_time_ms - qualiLaps[0].lap_time_ms
            return (
              <div key={lap.driver_number} style={{
                display: 'grid', gridTemplateColumns: '44px 1fr auto',
                padding: '12px 16px', alignItems: 'center',
                borderBottom: i < qualiLaps.length - 1 ? '1px solid #0D0D0D' : 'none',
                background: isFirst ? '#141414' : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <div style={{ width: '3px', height: '30px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: isFirst ? '#FFD700' : '#52525B', fontWeight: isFirst ? 700 : 400 }}>
                    {i + 1}
                  </span>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{lap.abbreviation}</span>
                    {lap.compound && <TyreChip compound={lap.compound} />}
                    {isFirst && (
                      <span style={{ fontSize: '9px', fontFamily: 'monospace', color: '#FFD700', background: '#FFD70018', padding: '1px 6px', borderRadius: '4px', border: '1px solid #FFD70033' }}>
                        POLE
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: '#52525B' }}>{lap.team_name}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '13px', fontFamily: 'monospace', color: isFirst ? '#fff' : '#A1A1AA', fontWeight: isFirst ? 700 : 400 }}>
                    {formatLapTime(lap.lap_time_ms)}
                  </div>
                  <div style={{ fontSize: '11px', fontFamily: 'monospace', color: isFirst ? '#FFD700' : '#3F3F46', marginTop: '1px' }}>
                    {isFirst ? 'POLE' : formatGap(gap)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── FP info panel ─────────────────────────────────────────────── */}
      {isFP && (
        <div style={{ background: '#111111', border: '1px solid #1E1E1E', borderRadius: '16px', padding: '20px' }}>
          <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#3671C6', fontWeight: 700, letterSpacing: '0.1em', marginBottom: '6px' }}>
            {meta.label.toUpperCase()}
          </div>
          <div style={{ fontSize: '13px', color: '#A1A1AA', lineHeight: 1.6 }}>
            {type === 'FP2'
              ? 'Race simulation data · tyre degradation · compound strategy reveals'
              : type === 'FP3'
              ? 'Final qualifying prep · sector time improvements · low-fuel runs'
              : 'Installation laps · initial setup · long run programmes'}
          </div>
        </div>
      )}

      {/* ── Loading ───────────────────────────────────────────────────── */}
      {dataLoading && (
        <div style={{ textAlign: 'center', padding: '32px', color: '#3F3F46', fontFamily: 'monospace', fontSize: '12px' }}>
          Loading session data...
        </div>
      )}

      {/* ── Analysis links ────────────────────────────────────────────── */}
      {hasData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Link href={`/sessions/${sessionKey}/telemetry`} style={{ textDecoration: 'none' }}>
            <div
              style={{ background: '#111111', border: '1px solid #1E1E1E', borderRadius: '14px', padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#2A2A2A')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#1E1E1E')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: `${meta.color}18`, border: `1px solid ${meta.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Activity size={18} style={{ color: meta.color }} />
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '2px' }}>
                    {isFP ? 'Practice Analysis' : isRace ? 'Race Analysis' : 'Speed Traces'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#52525B' }}>
                    {isFP
                      ? 'Long runs · race sim · compound strategy · sector progression'
                      : isRace
                      ? 'Lap evolution · gap to leader · stint pace · undercut analysis'
                      : 'Throttle · brake · speed delta · sector times · track map'}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: '20px', color: '#3F3F46', marginLeft: '8px' }}>→</span>
            </div>
          </Link>

          {isRace && (
            <Link href={`/sessions/${sessionKey}/strategy`} style={{ textDecoration: 'none' }}>
              <div
                style={{ background: '#111111', border: '1px solid #1E1E1E', borderRadius: '14px', padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#2A2A2A')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#1E1E1E')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#2CF4C518', border: '1px solid #2CF4C533', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <GitBranch size={18} style={{ color: '#2CF4C5' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '2px' }}>Tyre Strategy</div>
                    <div style={{ fontSize: '11px', color: '#52525B' }}>Stint diagram · pit stop timing · compound choices</div>
                  </div>
                </div>
                <span style={{ fontSize: '20px', color: '#3F3F46', marginLeft: '8px' }}>→</span>
              </div>
            </Link>
          )}
        </div>
      )}
    </div>
  )
}