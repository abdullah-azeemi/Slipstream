import { api } from '@/lib/api'
import { getCircuitImage, formatLapTime, teamColour, sessionTypeLabel } from '@/lib/utils'
import Link from 'next/link'
import { ArrowRight, MapPin, Thermometer, Wind, Droplets, Clock, Users, Zap, Flag } from 'lucide-react'

export const revalidate = 60

export default async function HomePage() {
  const sessions    = await api.sessions.list(true).catch(() => [])
  const latest      = sessions[0] ?? null
  const fastestLaps = latest
    ? await api.laps.fastest(latest.session_key, true).catch(() => [])
    : []
  const drivers     = latest
    ? await api.drivers.list(latest.session_key, true).catch(() => [])
    : []

  const pole         = fastestLaps[0] ?? null
  const circuitImage = getCircuitImage(latest?.gp_name ?? '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Breadcrumb ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#52525B' }}>
        <span>Dashboard</span>
        <span>/</span>
        <span style={{ color: '#A1A1AA' }}>Home</span>
      </div>

      {/* ── Hero + Track Conditions ──────────────────────────────────── */}
      {latest ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '16px', alignItems: 'stretch' }}>

          {/* Hero image */}
          <div style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', height: '320px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={circuitImage}
              alt={latest.gp_name}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Gradient */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.1) 100%)'
            }} />

            {/* Content overlay */}
            <div style={{ position: 'absolute', inset: 0, padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <span style={{
                  background: '#E8002D', color: '#fff',
                  fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em',
                  padding: '4px 10px', borderRadius: '4px', fontFamily: 'monospace'
                }}>
                  {sessionTypeLabel(latest.session_type).toUpperCase()}
                </span>
                <span style={{
                  background: 'rgba(0,0,0,0.5)', color: '#A1A1AA',
                  fontSize: '10px', fontFamily: 'monospace',
                  padding: '4px 8px', borderRadius: '4px'
                }}>
                  {latest.year}
                </span>
              </div>

              {/* Bottom — title + CTA */}
              <div>
                <p style={{ color: '#A1A1AA', fontSize: '11px', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: '4px', textTransform: 'uppercase' }}>
                  {latest.year} Season
                </p>
                <h1 style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '48px', color: '#fff', lineHeight: 1, marginBottom: '8px' }}>
                  {latest.gp_name.replace(' Grand Prix', '')} GP
                </h1>
                {latest.country && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#A1A1AA', fontSize: '13px', marginBottom: '20px' }}>
                    <MapPin size={13} />
                    {latest.country}
                  </div>
                )}
                <Link
                  href={`/sessions/${latest.session_key}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    background: '#E8002D', color: '#fff',
                    fontSize: '14px', fontWeight: 700,
                    padding: '12px 20px', borderRadius: '10px',
                    textDecoration: 'none'
                  }}
                >
                  View Session Info <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          </div>

          {/* Track Conditions */}
          <div style={{
            background: '#111111', border: '1px solid #2A2A2A',
            borderRadius: '16px', padding: '20px',
            display: 'flex', flexDirection: 'column', gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, color: '#fff', fontSize: '15px' }}>Track Conditions</span>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
            </div>

            {[
              { Icon: Thermometer, label: 'Track Temp', value: '42°C',  accent: '#f97316' },
              { Icon: Wind,        label: 'Air Temp',   value: '28°C',  accent: '#60a5fa' },
              { Icon: Droplets,    label: 'Humidity',   value: '62%',   accent: '#34d399' },
            ].map(({ Icon, label, value, accent }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#1A1A1A', borderRadius: '12px',
                padding: '14px 16px', border: '1px solid #2A2A2A'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '8px',
                    background: `${accent}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Icon size={18} style={{ color: accent }} />
                  </div>
                  <span style={{ color: '#A1A1AA', fontSize: '14px' }}>{label}</span>
                </div>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#fff', fontSize: '18px' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{
          background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px',
          padding: '40px', textAlign: 'center', color: '#52525B', fontSize: '14px'
        }}>
          No sessions loaded. Run the ingestion script to add data.
        </div>
      )}

      {/* ── Stat Cards ───────────────────────────────────────────────── */}
      {pole && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>

          {[
            {
              label: 'POLE LAP TIME',
              value: formatLapTime(pole.lap_time_ms),
              sub: `${pole.abbreviation} — ${pole.team_name ?? ''}`,
              Icon: Clock,
              valueColour: '#E8002D',
              mono: true,
            },
            {
              label: 'DRIVERS IN TOP 10',
              value: String(fastestLaps.length),
              sub: 'All teams represented',
              Icon: Users,
              valueColour: '#fff',
              mono: true,
            },
            {
              label: 'FASTEST S1',
              value: fastestLaps[0]?.abbreviation ?? '—',
              sub: 'Best mini-sector split',
              Icon: Zap,
              valueColour: '#fff',
              mono: false,
            },
            {
              label: 'SESSION',
              value: sessionTypeLabel(latest?.session_type ?? ''),
              sub: `${latest?.year} ${latest?.gp_name?.replace(' Grand Prix', ' GP')}`,
              Icon: Flag,
              valueColour: '#fff',
              mono: false,
            },
          ].map(({ label, value, sub, Icon, valueColour, mono }) => (
            <div key={label} style={{
              background: '#111111', border: '1px solid #2A2A2A',
              borderRadius: '16px', padding: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {label}
                </span>
                <Icon size={14} style={{ color: '#3F3F46' }} />
              </div>
              <div style={{
                fontSize: '26px', fontWeight: 700, color: valueColour,
                fontFamily: mono ? 'monospace' : 'Rajdhani, sans-serif',
                lineHeight: 1, marginBottom: '6px'
              }}>
                {value}
              </div>
              <div style={{ fontSize: '12px', color: '#71717A' }}>{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Driver Standings ─────────────────────────────────────────── */}
      {drivers.length > 0 && (
        <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #2A2A2A' }}>
            <span style={{ fontWeight: 600, color: '#fff', fontSize: '15px' }}>Driver Standings</span>
            <Link href={`/sessions/${latest?.session_key}`} style={{ color: '#E8002D', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
              View All
            </Link>
          </div>

          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '48px 1fr 200px 120px',
            padding: '10px 20px', borderBottom: '1px solid #2A2A2A',
            fontSize: '10px', color: '#52525B', fontFamily: 'monospace',
            letterSpacing: '0.1em', textTransform: 'uppercase'
          }}>
            <span>POS</span>
            <span>DRIVER</span>
            <span>TEAM</span>
            <span style={{ textAlign: 'right' }}>BEST LAP</span>
          </div>

          {drivers.slice(0, 8).map((driver, i) => (
            <div key={driver.driver_number} style={{
              display: 'grid', gridTemplateColumns: '48px 1fr 200px 120px',
              padding: '14px 20px', borderBottom: '1px solid #2A2A2A',
              alignItems: 'center', cursor: 'default'
            }}>
              <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#71717A', fontWeight: 700 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '4px', height: '24px', borderRadius: '2px', flexShrink: 0,
                  background: teamColour(driver.team_colour)
                }} />
                <span style={{ fontWeight: 600, color: '#fff', fontSize: '14px' }}>{driver.full_name}</span>
              </div>
              <span style={{ fontSize: '13px', color: '#A1A1AA' }}>{driver.team_name}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#fff', textAlign: 'right' }}>
                {formatLapTime(driver.best_lap_ms)}
              </span>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}