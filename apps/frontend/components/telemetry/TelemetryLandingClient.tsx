'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, LayoutDashboard, Monitor } from 'lucide-react'
import type { Session } from '@/types/f1'

type Props = { initialSessions: Session[] }

export default function TelemetryLandingClient({ initialSessions }: Props) {
  const router = useRouter()
  const [selectedYear, setSelectedYear] = useState<number | null>(
    initialSessions[0]?.year ?? null,
  )

  const years = useMemo(
    () => Array.from(new Set(initialSessions.map(s => s.year))).sort((a, b) => b - a),
    [initialSessions],
  )

  const gpsForYear = useMemo(() => {
    if (!selectedYear) return []
    return initialSessions
      .filter(s => s.year === selectedYear)
      .sort((a, b) => new Date(a.date_start ?? 0).getTime() - new Date(b.date_start ?? 0).getTime())
  }, [initialSessions, selectedYear])

  const handleLaunch = (sessionKey: number) => router.push(`/sessions/${sessionKey}/telemetry`)

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 20px 80px' }}>

        {/* ── Hero ── */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: '#E8002D', color: '#FFF', marginBottom: 16 }}>
            <Monitor size={24} />
          </div>
          <h1 style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: 'clamp(32px, 5vw, 42px)',
            fontWeight: 700,
            color: '#111827',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: '0 0 12px',
          }}>
            Telemetry Console
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, margin: '0 auto', maxWidth: 480 }}>
            Deep dive into lap pace distribution, micro-sector trace comparisons, and decisive corner-entry telemetry across the entire F1 hybrid era.
          </p>
        </div>

        {/* ── Session Browser ── */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '24px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <LayoutDashboard size={14} color="#6B7280" />
            Select a Session to Analyze
          </div>

          {/* Year tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {years.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: selectedYear === y ? '1px solid #111827' : '1px solid #E5E7EB',
                  background: selectedYear === y ? '#111827' : 'transparent',
                  color: selectedYear === y ? '#FFFFFF' : '#6B7280',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 150ms'
                }}
              >
                {y}
              </button>
            ))}
          </div>

          {/* Sessions list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 500, overflowY: 'auto', paddingRight: 4 }}>
            {gpsForYear.map(s => (
              <button
                key={s.session_key}
                onClick={() => handleLaunch(s.session_key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid #F1F5F9',
                  background: '#F9FAFB',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 150ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F1F5F9'; e.currentTarget.style.borderColor = '#E5E7EB' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#F9FAFB'; e.currentTarget.style.borderColor = '#F1F5F9' }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{s.gp_name.replace(' Grand Prix', '')}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>
                    {s.year} · Qualifying &amp; Race
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#E8002D', opacity: 0.9 }}>Jump to Telemetry</span>
                  <ChevronRight size={16} color="#E8002D" />
                </div>
              </button>
            ))}
            {gpsForYear.length === 0 && (
              <div style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: '30px 0' }}>
                No sessions available for this year
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
