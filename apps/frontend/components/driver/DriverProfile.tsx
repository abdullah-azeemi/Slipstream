'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { ArrowLeftRight } from 'lucide-react'

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
    <div style={{ minHeight: '100vh' }}>
      {/* ─── HEADER ──────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, #0F172A 0%, #1E293B 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Subtle team-colour accent */}
        <div style={{
          position: 'absolute', top: -60, right: -60,
          width: 300, height: 300, borderRadius: '50%',
          background: `${tc}12`, filter: 'blur(60px)',
        }} />

        <div style={{
          maxWidth: 1100, margin: '0 auto', padding: '24px 24px',
          display: 'flex', alignItems: 'center', gap: 20, position: 'relative',
        }}>
          {/* Photo */}
          <div style={{
            width: 110, height: 110, borderRadius: '50%', overflow: 'hidden',
            border: `3px solid ${tc}`, flexShrink: 0,
            background: '#1E293B',
          }}>
            {showImage ? (
              <Image src={headshotUrl!} alt="" width={110} height={110} style={{ objectFit: 'cover' }} unoptimized onError={() => setImgError(true)} />
            ) : (
              <div style={{
                width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, fontWeight: 900, color: tc, fontFamily: 'Inter',
              }}>
                {driver.abbreviation}
              </div>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{
                fontSize: 28, fontWeight: 900, color: '#fff',
                letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1,
              }}>
                {driver.full_name}
              </h1>
              {embedding?.archetype && (
                <span style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 10, fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: '#fff', background: `${tc}30`, border: `1px solid ${tc}50`,
                }}>
                  {embedding.archetype}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 13, fontWeight: 600, color: '#94A3B8',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {driver.team_name || 'F1 Driver'} · <span style={{ color: tc }}>#{String(driver.driver_number).padStart(2, '0')}</span>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 24, flexShrink: 0 }}>
            {[
              { label: 'Wins', value: wins, highlight: wins > 0 },
              { label: 'Podiums', value: podiums, highlight: false },
              { label: 'Points', value: totalPts, highlight: false },
              { label: 'Avg Pos', value: avgPos, highlight: false },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center', minWidth: 56 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
                  {s.label}
                </div>
                <div style={{
                  fontSize: 24, fontWeight: 900,
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
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 24px 48px' }}>
        {/* Row 1: 3-col */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 10, marginBottom: 10 }}>
          <Card title="Driver DNA">
            <DriverRadar traits={radarTraits} values={radarValues} colour={tc} />
          </Card>
          <Card title="Driver Map">
            <DriverScatter allDrivers={all_embeddings} selectedDriver={driver.driver_number} colour={tc} />
          </Card>
          <Card title="Performance">
            <PerformanceDrivers embedding={embedding} features={features} />
          </Card>
        </div>

        {/* Row 2: 2-col */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Card title="Tyre Performance">
            <CompoundViolin laps={compound_laps} driverNumber={driver.driver_number} />
          </Card>
          <Card
            title="Results"
            action={
              <button style={{
                background: 'transparent', color: '#94A3B8', border: '1px solid #334155',
                padding: '5px 12px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5, transition: 'all 150ms',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = tc; e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.color = '#94A3B8' }}
              >
                Compare <ArrowLeftRight size={11} />
              </button>
            }
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Grand Prix', 'Grid', 'Finish', 'Pts'].map(h => (
                      <th key={h} style={{
                        textAlign: h === 'Pts' ? 'right' : 'left',
                        padding: '6px 10px', fontSize: 9, fontWeight: 800, color: '#64748B',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        borderBottom: '1px solid #1E293B',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent_results.map((r, i) => (
                    <tr key={i} style={{
                      background: i % 2 === 0 ? 'transparent' : '#F8FAFC08',
                    }}>
                      <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 600, color: '#E2E8F0', borderBottom: '1px solid #F1F5F9' }}>
                        {r.gp_name}
                      </td>
                      <td style={{ padding: '7px 10px', fontSize: 12, color: '#94A3B8', fontFamily: 'JetBrains Mono', borderBottom: '1px solid #F1F5F9' }}>
                        {r.grid_position != null ? `P${r.grid_position}` : '—'}
                      </td>
                      <td style={{
                        padding: '7px 10px', fontSize: 12, fontWeight: 800, fontFamily: 'JetBrains Mono',
                        color: r.position === 1 ? '#FFD700' : r.status === 'DNF' ? '#64748B' : '#E2E8F0',
                        borderBottom: '1px solid #F1F5F9',
                      }}>
                        {r.status === 'DNF' ? 'DNF' : r.position != null ? `P${r.position}` : '—'}
                      </td>
                      <td style={{
                        padding: '7px 10px', fontSize: 12, fontWeight: 800, textAlign: 'right', fontFamily: 'JetBrains Mono',
                        color: (r.points ?? 0) > 0 ? tc : '#64748B', borderBottom: '1px solid #F1F5F9',
                      }}>
                        {r.points ?? 0}
                      </td>
                    </tr>
                  ))}
                  {recent_results.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#64748B', fontSize: 12 }}>No results</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
      padding: '14px 16px', display: 'flex', flexDirection: 'column',
      boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingBottom: 8, marginBottom: 10, borderBottom: '1px solid #F1F5F9',
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {title}
        </span>
        {action}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
