'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, ChevronRight } from 'lucide-react'
import type { Session } from '@/types/f1'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function TelemetryLandingPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [selectedGp, setSelectedGp] = useState<string>('')

  useEffect(() => {
    fetch(`${BASE}/api/v1/sessions`)
      .then(r => r.json())
      .then((all: Session[] | { error?: string }) => {
        const rows = Array.isArray(all) ? all : []
        const qualiSessions = rows
          .filter(session => session.session_type === 'Q')
          .sort((a, b) => new Date(b.date_start ?? 0).getTime() - new Date(a.date_start ?? 0).getTime())

        setSessions(qualiSessions)
        if (qualiSessions.length) {
          setSelectedYear(qualiSessions[0].year)
          setSelectedGp(qualiSessions[0].gp_name)
        }
      })
      .catch(() => setSessions([]))
  }, [])

  const years = useMemo(
    () => Array.from(new Set(sessions.map(session => session.year))).sort((a, b) => b - a),
    [sessions],
  )

  const gpOptions = useMemo(
    () => Array.from(new Set(
      sessions
        .filter(session => selectedYear == null || session.year === selectedYear)
        .map(session => session.gp_name),
    )),
    [sessions, selectedYear],
  )

  const activeGp = useMemo(
    () => (selectedGp && gpOptions.includes(selectedGp) ? selectedGp : (gpOptions[0] ?? '')),
    [gpOptions, selectedGp],
  )

  const matchingSession = useMemo(
    () => sessions.find(session => session.year === selectedYear && session.gp_name === activeGp) ?? null,
    [activeGp, selectedYear, sessions],
  )

  const recentSessions = useMemo(() => sessions.slice(0, 6), [sessions])

  const openTelemetry = (sessionKey: number) => {
    router.push(`/sessions/${sessionKey}/telemetry`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '960px', margin: '0 auto' }}>
      <section className="panel fade-up" style={{ padding: '22px', overflow: 'visible' }}>
        <div className="eyebrow" style={{ marginBottom: '10px' }}>Direct Access</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#E8002D18', border: '1px solid #E8002D33', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity size={18} style={{ color: '#E8002D' }} />
          </div>
          <h1 className="page-title" style={{ margin: 0 }}>Telemetry</h1>
        </div>
        <p className="page-subtitle" style={{ margin: 0 }}>
          Pick a year and Grand Prix, then jump straight into qualifying speed traces without going through Sessions first.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '18px' }}>
          <div className="panel-soft" style={{ padding: '14px', overflow: 'visible' }}>
            <div className="eyebrow" style={{ marginBottom: '8px' }}>Year</div>
            <select
              value={selectedYear ?? ''}
              onChange={e => setSelectedYear(Number(e.target.value))}
              style={{
                width: '100%',
                background: 'rgba(7,17,27,0.72)',
                border: '1px solid rgba(152, 181, 211, 0.16)',
                borderRadius: '14px',
                color: '#fff',
                padding: '12px 14px',
                fontSize: '14px',
              }}
            >
              {years.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div className="panel-soft" style={{ padding: '14px', overflow: 'visible' }}>
            <div className="eyebrow" style={{ marginBottom: '8px' }}>Grand Prix</div>
            <select
              value={activeGp}
              onChange={e => setSelectedGp(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(7,17,27,0.72)',
                border: '1px solid rgba(152, 181, 211, 0.16)',
                borderRadius: '14px',
                color: '#fff',
                padding: '12px 14px',
                fontSize: '14px',
              }}
            >
              {gpOptions.map(gp => (
                <option key={gp} value={gp}>{gp.replace(' Grand Prix', '')}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="telemetry-chip-row" style={{ marginTop: '14px' }}>
          <button
            type="button"
            disabled={!matchingSession}
            onClick={() => matchingSession && openTelemetry(matchingSession.session_key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              minWidth: '190px',
              border: matchingSession ? '1px solid rgba(242, 200, 121, 0.28)' : '1px solid rgba(152, 181, 211, 0.1)',
              borderRadius: '999px',
              background: matchingSession
                ? 'linear-gradient(180deg, rgba(23, 40, 58, 0.96) 0%, rgba(14, 25, 37, 0.96) 100%)'
                : 'rgba(255,255,255,0.04)',
              boxShadow: matchingSession ? '0 10px 24px rgba(0, 0, 0, 0.22)' : 'none',
              color: matchingSession ? '#F4F7FB' : '#718397',
              padding: '10px 14px',
              fontWeight: 600,
              fontSize: '12px',
              fontFamily: 'JetBrains Mono, monospace',
              cursor: matchingSession ? 'pointer' : 'not-allowed',
            }}
          >
            <span>Open Telemetry</span>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              borderRadius: '999px',
              background: matchingSession ? 'rgba(242, 200, 121, 0.14)' : 'rgba(255,255,255,0.05)',
              color: matchingSession ? '#f2c879' : '#5e7289',
            }}>
              <ChevronRight size={14} />
            </span>
          </button>
          {matchingSession && (
            <div className="panel-soft" style={{ padding: '10px 12px', borderRadius: '16px' }}>
              <div className="eyebrow" style={{ marginBottom: '6px' }}>Session</div>
              <div style={{ fontSize: '16px', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, color: '#fff' }}>
                {matchingSession.gp_name.replace(' Grand Prix', '')} {matchingSession.year} Q
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel-soft fade-up-delay-1" style={{ padding: '16px' }}>
        <div className="eyebrow" style={{ marginBottom: '10px' }}>Recent Telemetry Sessions</div>
        <div style={{ display: 'grid', gap: '10px' }}>
          {recentSessions.map(session => (
            <button
              key={session.session_key}
              type="button"
              onClick={() => openTelemetry(session.session_key)}
              className="interactive-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                width: '100%',
                padding: '14px 16px',
                borderRadius: '18px',
                border: '1px solid rgba(152, 181, 211, 0.1)',
                background: 'rgba(10,20,31,0.76)',
                color: '#fff',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div>
                <div style={{ fontSize: '18px', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>
                  {session.gp_name.replace(' Grand Prix', '')}
                </div>
                <div style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: '#71717A' }}>
                  {session.year} · Qualifying
                </div>
              </div>
              <ChevronRight size={16} style={{ color: '#9fb2c6' }} />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
