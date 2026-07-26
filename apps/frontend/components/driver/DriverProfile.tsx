'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { ArrowLeftRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'

const DriverRadar = dynamic(() => import('./DriverRadar'), { ssr: false })
const DriverScatter = dynamic(() => import('./DriverScatter'), { ssr: false })
const CompoundViolin = dynamic(() => import('./CompoundViolin'), { ssr: false })
const PerformanceDrivers = dynamic(() => import('./PerformanceDrivers'), { ssr: false })

interface ProfileData {
  driver: {
    driver_number: number
    full_name: string
    abbreviation: string
    team_name: string | null
    team_colour: string | null
  }
  features: Record<string, number> | null
  embedding: {
    embedding: number[]
    pca_loadings: Record<string, { feature: string; weight: number }[]>
    axis_labels: Record<string, { label: string; top_features: { feature: string; weight: number }[] }>
    archetype: string | null
  } | null
  all_embeddings: Array<{
    driver_number: number
    embedding: number[]
    abbreviation: string
    full_name: string
    team_colour: string | null
    archetype: string | null
  }>
  compound_laps: Array<{
    driver_number: number
    compound: string
    lap_time_ms: number
  }>
  recent_results: Array<{
    gp_name: string
    position: number | null
    grid_position: number | null
    points: number | null
    status: string | null
  }>
}

export default function DriverProfile({
  profile,
  headshotUrl,
}: {
  profile: ProfileData
  headshotUrl: string | null
}) {
  const [imgError, setImgError] = useState(false)
  const { driver, features, embedding, all_embeddings, compound_laps, recent_results } = profile

  const tc = driver.team_colour?.startsWith('#') ? driver.team_colour : `#${driver.team_colour || '64748B'}`
  const showImage = headshotUrl && !imgError

  const wins = recent_results.filter(r => r.position === 1).length
  const podiums = recent_results.filter(r => r.position != null && r.position <= 3).length
  const totalPts = recent_results.reduce((s, r) => s + (r.points ?? 0), 0)
  const avgPos = recent_results.length > 0
    ? (recent_results.reduce((s, r) => s + (r.position ?? 20), 0) / recent_results.length).toFixed(1)
    : '—'

  const radarTraits = embedding?.axis_labels
    ? Object.values(embedding.axis_labels).map(a => a.label)
    : ['Pace', 'Consistency', 'Racecraft', 'Aggression', 'Tyres']

  const radarValues = embedding?.embedding
    ? embedding.embedding.map(v => Math.max(0, Math.min(1, (v + 2) / 4)))
    : [0.85, 0.92, 0.78, 0.88, 0.95]

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC' }}>
      {/* ─── HERO HEADER ──────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(145deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)`,
        position: 'relative', overflow: 'hidden',
        paddingBottom: 16,
      }}>
        {/* Team colour glow — large blur */}
        <div style={{
          position: 'absolute', top: -100, right: -40,
          width: 500, height: 500, borderRadius: '50%',
          background: `radial-gradient(circle, ${tc}25 0%, transparent 70%)`,
          filter: 'blur(40px)', pointerEvents: 'none',
        }} />
        {/* Secondary glow — bottom left */}
        <div style={{
          position: 'absolute', bottom: -80, left: '20%',
          width: 400, height: 250, borderRadius: '50%',
          background: `radial-gradient(ellipse, ${tc}15 0%, transparent 70%)`,
          filter: 'blur(60px)', pointerEvents: 'none',
        }} />

        {/* Watermark driver number */}
        <div className="driver-watermark-number" style={{
          position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)',
          fontSize: 200, fontWeight: 900, fontFamily: 'Inter, sans-serif',
          color: `${tc}08`, lineHeight: 1, pointerEvents: 'none',
          letterSpacing: '-0.06em', userSelect: 'none',
        }}>
          {String(driver.driver_number).padStart(2, '0')}
        </div>

        <div style={{
          maxWidth: 1100, margin: '0 auto', padding: '36px 24px 20px',
          display: 'flex', alignItems: 'center', gap: 28, position: 'relative',
          flexWrap: 'wrap',
        }} className="driver-hero-inner">
          {/* Headshot with glow ring */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {/* Glow behind */}
            <div style={{
              position: 'absolute', inset: -8,
              borderRadius: '50%',
              background: `${tc}30`,
              filter: 'blur(16px)',
              animation: 'driverGlowPulse 3s ease-in-out infinite',
            }} />
            <div style={{
              width: 130, height: 130, borderRadius: '50%', overflow: 'hidden',
              border: `3px solid ${tc}`,
              background: '#1E293B',
              position: 'relative', zIndex: 1,
              boxShadow: `0 0 24px ${tc}40, 0 0 48px ${tc}15`,
            }}>
              {showImage ? (
                <Image src={headshotUrl!} alt="" width={130} height={130} style={{ objectFit: 'cover' }} unoptimized onError={() => setImgError(true)} />
              ) : (
                <div style={{
                  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 36, fontWeight: 900, color: tc, fontFamily: 'Inter',
                }}>
                  {driver.abbreviation}
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
              <h1 className="fade-up" style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.25rem)', fontWeight: 900, color: '#fff',
                letterSpacing: '-0.03em', margin: 0, lineHeight: 1.1,
                fontFamily: 'Inter, sans-serif',
              }}>
                {driver.full_name}
              </h1>
              {embedding?.archetype && (
                <span className="fade-up-1" style={{
                  padding: '5px 14px', borderRadius: 8, fontSize: 10, fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: '#fff',
                  background: `linear-gradient(135deg, ${tc}50, ${tc}25)`,
                  border: `1px solid ${tc}60`,
                  backdropFilter: 'blur(8px)',
                }}>
                  {embedding.archetype}
                </span>
              )}
            </div>
            <div className="fade-up-1" style={{
              fontSize: 14, fontWeight: 600, color: '#94A3B8',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              fontFamily: 'Space Grotesk, sans-serif',
            }}>
              {driver.team_name || 'F1 Driver'} · <span style={{ color: tc }}>#{String(driver.driver_number).padStart(2, '0')}</span>
            </div>
          </div>

          {/* Stats — glassmorphic pills */}
          <div className="driver-stats-row fade-up-2" style={{ display: 'flex', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
            {[
              { label: 'Wins', value: wins, highlight: wins > 0 },
              { label: 'Podiums', value: podiums, highlight: false },
              { label: 'Points', value: totalPts, highlight: false },
              { label: 'Avg Pos', value: avgPos, highlight: false },
            ].map(s => (
              <div key={s.label} style={{
                textAlign: 'center', minWidth: 68,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: '10px 14px',
                backdropFilter: 'blur(8px)',
                transition: 'all 200ms ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = `${tc}15`
                  e.currentTarget.style.borderColor = `${tc}40`
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                }}
              >
                <div style={{
                  fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase',
                  letterSpacing: '0.1em', marginBottom: 4, fontFamily: 'Space Grotesk, sans-serif',
                }}>
                  {s.label}
                </div>
                <div style={{
                  fontSize: 26, fontWeight: 900,
                  color: s.highlight ? tc : '#F8FAFC',
                  fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.1,
                }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── CONTENT GRID ──────────────────────────────── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px 48px' }}>

        {/* Row 1: 3-col charts */}
        <div className="driver-grid-row1" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', gap: 16, marginBottom: 16 }}>
          <Card title="Driver DNA" teamColour={tc}>
            <DriverRadar traits={radarTraits} values={radarValues} colour={tc} />
          </Card>
          <Card title="Driver Map" teamColour={tc}>
            <DriverScatter allDrivers={all_embeddings} selectedDriver={driver.driver_number} colour={tc} />
          </Card>
          <Card title="Performance" teamColour={tc}>
            <PerformanceDrivers embedding={embedding} features={features} />
          </Card>
        </div>

        {/* Row 2: 2-col — tyre + something */}
        <div className="driver-grid-row2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <Card title="Tyre Performance" teamColour={tc}>
            <CompoundViolin laps={compound_laps} driverNumber={driver.driver_number} />
          </Card>
          <Card title="Feature Breakdown" teamColour={tc}>
            <PerformanceDrivers embedding={embedding} features={features} />
          </Card>
        </div>

        {/* Row 3: Full-width results table */}
        <Card
          title="Season Results"
          teamColour={tc}
          action={
            <button style={{
              background: 'transparent', color: '#94A3B8', border: '1px solid #E2E8F0',
              padding: '6px 14px', borderRadius: 8, fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, transition: 'all 180ms',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = tc; e.currentTarget.style.color = '#0F172A' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.color = '#94A3B8' }}
            >
              Compare <ArrowLeftRight size={12} />
            </button>
          }
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Grand Prix', 'Grid', 'Finish', '+/-', 'Pts'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Pts' ? 'right' : h === '+/-' ? 'center' : 'left',
                      padding: '10px 12px', fontSize: 10, fontWeight: 800, color: '#94A3B8',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      borderBottom: '2px solid #F1F5F9',
                      fontFamily: 'Space Grotesk, sans-serif',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent_results.map((r, i) => {
                  const gain = r.grid_position != null && r.position != null
                    ? r.grid_position - r.position
                    : null
                  const isDNF = r.status === 'DNF'
                  const isWin = r.position === 1
                  const isPodium = r.position != null && r.position <= 3

                  return (
                    <tr key={i} style={{
                      background: i % 2 === 0 ? 'transparent' : '#F8FAFC',
                      transition: 'background 150ms ease',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${tc}06` }}
                      onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#F8FAFC' }}
                    >
                      <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: '#1E293B', borderBottom: '1px solid #F1F5F9' }}>
                        {r.gp_name}
                      </td>
                      <td style={{
                        padding: '10px 12px', fontSize: 13, color: '#64748B',
                        fontFamily: 'JetBrains Mono', borderBottom: '1px solid #F1F5F9',
                      }}>
                        {r.grid_position != null ? `P${r.grid_position}` : '—'}
                      </td>
                      <td style={{
                        padding: '10px 12px', fontSize: 13, fontWeight: 800,
                        fontFamily: 'JetBrains Mono', borderBottom: '1px solid #F1F5F9',
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        {/* Position dot */}
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                          background: isDNF ? '#EF4444'
                            : isWin ? '#FFD700'
                            : r.position === 2 ? '#C0C0C0'
                            : r.position === 3 ? '#CD7F32'
                            : isPodium ? '#10B981'
                            : '#E2E8F0',
                          boxShadow: isWin ? '0 0 8px #FFD70060' : 'none',
                        }} />
                        <span style={{
                          color: isDNF ? '#EF4444'
                            : isWin ? '#B8860B'
                            : '#1E293B',
                        }}>
                          {isDNF ? 'DNF' : r.position != null ? `P${r.position}` : '—'}
                        </span>
                      </td>
                      <td style={{
                        padding: '10px 12px', fontSize: 12, fontWeight: 700,
                        textAlign: 'center', borderBottom: '1px solid #F1F5F9',
                        fontFamily: 'JetBrains Mono',
                      }}>
                        {isDNF ? (
                          <span style={{ color: '#EF4444', fontSize: 10 }}>RET</span>
                        ) : gain != null ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 2,
                            color: gain > 0 ? '#10B981' : gain < 0 ? '#EF4444' : '#94A3B8',
                          }}>
                            {gain > 0 ? <TrendingUp size={12} /> : gain < 0 ? <TrendingDown size={12} /> : <Minus size={10} />}
                            {gain !== 0 && Math.abs(gain)}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{
                        padding: '10px 12px', fontSize: 13, fontWeight: 800, textAlign: 'right',
                        fontFamily: 'JetBrains Mono',
                        color: (r.points ?? 0) > 0 ? tc : '#CBD5E1',
                        borderBottom: '1px solid #F1F5F9',
                      }}>
                        {r.points ?? 0}
                      </td>
                    </tr>
                  )
                })}
                {recent_results.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No results available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Keyframe animation for glow */}
      <style>{`
        @keyframes driverGlowPulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.08); }
        }
      `}</style>
    </div>
  )
}

function Card({ title, children, action, teamColour }: { title: string; children: React.ReactNode; action?: React.ReactNode; teamColour?: string }) {
  return (
    <div className="driver-card" style={{
      background: '#FFFFFF',
      border: '1px solid #E2E8F0',
      borderRadius: 16,
      padding: '18px 20px',
      display: 'flex', flexDirection: 'column',
      boxShadow: '0 1px 4px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.02)',
      position: 'relative', overflow: 'hidden',
      transition: 'box-shadow 250ms ease, transform 250ms ease, border-color 250ms ease',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 8px 32px rgba(15,23,42,0.08), 0 2px 8px rgba(15,23,42,0.04)'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.borderColor = '#CBD5E1'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.02)'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = '#E2E8F0'
      }}
    >
      {/* Team colour accent line */}
      {teamColour && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${teamColour}, ${teamColour}40)`,
          borderRadius: '16px 16px 0 0',
        }} />
      )}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid #F1F5F9',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase',
          letterSpacing: '0.1em', fontFamily: 'Space Grotesk, sans-serif',
        }}>
          {title}
        </span>
        {action}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
