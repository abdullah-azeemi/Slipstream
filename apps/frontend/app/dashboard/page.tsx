import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Trophy,
  Clock,
  Zap,
  Flag
} from 'lucide-react'
import CountdownTimer from '@/components/schedule/CountdownTimer'
import ChampionshipStandings from '@/components/home/ChampionshipStandings'

export const revalidate = 60

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchStandings(year: number) {
  try {
    const [d, c] = await Promise.all([
      fetch(`${BASE}/api/v1/standings/drivers?year=${year}`, { next: { revalidate: 300 } }).then(r => r.json()),
      fetch(`${BASE}/api/v1/standings/constructors?year=${year}`, { next: { revalidate: 300 } }).then(r => r.json()),
    ])
    return { drivers: d.standings ?? [], constructors: c.standings ?? [], round: d.round ?? 13 }
  } catch {
    return { drivers: [], constructors: [], round: 13 }
  }
}

async function fetchDriverImages() {
  try {
    const data = await fetch('https://api.openf1.org/v1/drivers?session_key=latest', { next: { revalidate: 3600 } }).then(r => r.json())
    if (!Array.isArray(data)) return { acronymMap: {}, numberMap: {} }

    const acronymMap: Record<string, string> = {}
    const numberMap: Record<number, { full_name: string; headshot_url: string }> = {}
    data.forEach((d: { name_acronym: string; headshot_url: string; driver_number: number; full_name: string }) => {
      if (d.name_acronym && d.headshot_url) acronymMap[d.name_acronym] = d.headshot_url
      if (d.driver_number) numberMap[d.driver_number] = d
    })
    return { acronymMap, numberMap }
  } catch {
    return { acronymMap: {}, numberMap: {} }
  }
}

async function fetchLastFinishedSession() {
  try {
    const now = new Date().toISOString()
    const sessions = await fetch('https://api.openf1.org/v1/sessions?year=2026').then(r => r.json())
    if (!Array.isArray(sessions)) return null
    return sessions.filter(s => s.date_end < now && !s.is_cancelled).slice(-1)[0] ?? null
  } catch { return null }
}

export default async function DashboardPage() {
  const currentYear = new Date().getFullYear()

  const [standings, nextRace, dData, lastSession] = await Promise.all([
    fetchStandings(currentYear),
    fetch(`${BASE}/api/v1/schedule/next-race`, { next: { revalidate: 300 } }).then(r => r.json()).catch(() => null),
    fetchDriverImages(),
    fetchLastFinishedSession()
  ])

  const { acronymMap: driverImages } = dData
  const heroRace = nextRace?.race
  const heroSession = nextRace?.next_session

  const heroImage = "/dashboard.png"

  const champLeader = standings.drivers[0] ?? { full_name: 'Andrea Kimi Antonelli', team_name: 'Mercedes', points: 267 }
  const constructorLeader = standings.constructors[0] ?? { team_name: 'Mercedes', points: 468 }

  const roundNum = heroRace?.round ?? 14
  const raceTitle = heroRace?.event_name ? `Round ${roundNum}: ${heroRace.event_name}` : 'Round 14: Spanish Grand Prix'
  const circuitSubtitle = heroRace?.circuit ? `${heroRace.circuit} • September 13, 2026. High-speed aerodynamic balance meets relentless tyre thermal management.` : 'Circuit de Barcelona-Catalunya • September 13, 2026. High-speed aerodynamic balance meets relentless tyre thermal management.'

  return (
    <div style={{ background: '#FFFFFF', color: '#111827', width: '100%', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>

      {/* Responsive Stylesheet matching Landing Page */}
      <style>{`
        @media (max-width: 1024px) {
          .dash-section { padding: 4px 20px 24px !important; }
        }

        @media (max-width: 768px) {
          .landing-header { padding: 0 16px !important; height: 52px !important; }
          .hidden-mobile { display: none !important; }
          .dash-title { font-size: 1.8rem !important; margin-bottom: 12px !important; line-height: 1.15 !important; }
          .dash-video-box { height: auto !important; aspect-ratio: 16 / 9 !important; border-radius: 16px !important; margin-bottom: 24px !important; }
          .dash-subtitle { font-size: 13.5px !important; margin-bottom: 40px !important; }
          .partners-band { padding: 16px 16px !important; margin-bottom: 48px !important; }
          .partners-grid { justify-content: center !important; gap: 16px 24px !important; }
          .landing-footer { flex-direction: column !important; text-align: center !important; gap: 16px !important; padding: 24px 16px !important; }
        }

        @media (max-width: 480px) {
          .hidden-xs { display: none !important; }
          .get-started-btn { padding: 7px 14px !important; font-size: 12px !important; }
        }
      `}</style>

      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      <main className="dash-section" style={{ maxWidth: 1040, margin: '0 auto', padding: '4px 24px 32px' }}>

        {/* Eyebrow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 8px #10B981' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#6B7280', textTransform: 'uppercase' }}>
            NEXT EVENT • ROUND {roundNum}
          </span>
        </div>

        {/* Title in Playfair Display Serif */}
        <h1 className="dash-title" style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 'clamp(2.2rem, 4vw, 3.4rem)',
          fontWeight: 400,
          letterSpacing: '-0.02em',
          color: '#111827',
          lineHeight: 1.15,
          marginBottom: 12,
        }}>
          {raceTitle}
        </h1>

        <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, maxWidth: 760, marginBottom: 28 }}>
          {circuitSubtitle}
        </p>

        {/* Hero Media Card */}
        <div className="dash-video-box" style={{
          position: 'relative',
          width: '100%',
          maxWidth: 1000,
          height: 'clamp(300px, 48vh, 460px)',
          borderRadius: 22,
          overflow: 'hidden',
          background: '#F3F4F6',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)',
          marginBottom: 28,
        }}>
          <Image
            src={heroImage}
            alt="F1 Race Action"
            fill
            style={{ objectFit: 'cover' }}
            priority
          />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%)'
          }} />

          {/* Red Session Badge Top Left */}
          <div style={{
            position: 'absolute', top: 20, left: 20,
            background: '#E8002D', color: '#FFFFFF',
            fontSize: 10, fontWeight: 800, padding: '5px 12px',
            borderRadius: 9999, letterSpacing: '0.08em', textTransform: 'uppercase'
          }}>
            NEXT SESSION
          </div>

          {/* Bottom Left Countdown Overlay */}
          <div style={{
            position: 'absolute', bottom: 20, left: 20,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            padding: '16px 20px', borderRadius: 16,
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF'
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: '#9CA3AF', marginBottom: 6, textTransform: 'uppercase' }}>
              COUNTDOWN TO FREE PRACTICE 1
            </div>
            {heroSession?.date_utc ? (
              <CountdownTimer targetDate={heroSession.date_utc} sessionName="" />
            ) : (
              <div style={{ display: 'flex', gap: 16, fontSize: 18, fontWeight: 800, fontFamily: 'Inter, sans-serif' }}>
                <span>00<span style={{ fontSize: 10, color: '#9CA3AF', display: 'block', fontWeight: 500 }}>DAYS</span></span>
                <span>15<span style={{ fontSize: 10, color: '#9CA3AF', display: 'block', fontWeight: 500 }}>HRS</span></span>
                <span>59<span style={{ fontSize: 10, color: '#9CA3AF', display: 'block', fontWeight: 500 }}>MINS</span></span>
                <span>11<span style={{ fontSize: 10, color: '#9CA3AF', display: 'block', fontWeight: 500 }}>SECS</span></span>
              </div>
            )}
          </div>

          {/* Bottom Right Track Spec Overlay */}
          <div style={{
            position: 'absolute', bottom: 20, right: 20,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            padding: '12px 18px', borderRadius: 14,
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#FFFFFF',
            display: 'flex', gap: 20, fontSize: 11
          }}>
            <div>
              <span style={{ fontSize: 9, color: '#9CA3AF', display: 'block', fontWeight: 700 }}>CIRCUIT LENGTH</span>
              <span style={{ fontWeight: 800 }}>4.657 km</span>
            </div>
            <div>
              <span style={{ fontSize: 9, color: '#9CA3AF', display: 'block', fontWeight: 700 }}>TOTAL LAPS</span>
              <span style={{ fontWeight: 800 }}>66 Laps</span>
            </div>
            <div>
              <span style={{ fontSize: 9, color: '#9CA3AF', display: 'block', fontWeight: 700 }}>LAP RECORD</span>
              <span style={{ fontWeight: 800 }}>1:18.149</span>
            </div>
          </div>
        </div>

        <p className="dash-subtitle" style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, maxWidth: 640, marginBottom: 56 }}>
          This comprehensive grand prix telemetry pipeline strips away unnecessary noise, isolating pure thermal degradation, apex delta, and aero slip efficiency across every sector.
        </p>
      </main>

      {/* ── CONSTRUCTORS MARQUEE BAND ───────────────────────────────────────── */}
      <section className="partners-band" style={{
        background: '#FAFAFA',
        borderTop: '1px solid #F3F4F6',
        borderBottom: '1px solid #F3F4F6',
        padding: '20px 5vw',
        marginBottom: 64,
      }}>
        <div className="partners-grid" style={{
          maxWidth: 1040,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
          opacity: 0.6,
        }}>
          {['MERCEDES-AMG F1', 'SCUDERIA FERRARI', 'MCLAREN FORMULA 1', 'ORACLE RED BULL RACING', 'ASTON MARTIN ARAMCO', 'ALPINE F1'].map((team, i) => (
            <span key={i} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: '#374151' }}>
              {team}
            </span>
          ))}
        </div>
      </section>

      {/* ── 4 STAT CARDS ROW ─────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1040, margin: '0 auto 80px', padding: '0 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>

          {/* Card 1 */}
          <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 20, border: '1px solid #F3F4F6', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em' }}>CHAMPIONSHIP LEADER</span>
              <Trophy size={14} color="#E8002D" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 8 }}>
              {champLeader.full_name}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280' }}>
              <span>{champLeader.team_name}</span>
              <span style={{ fontWeight: 700, color: '#111827' }}>{champLeader.points} PTS</span>
            </div>
          </div>

          {/* Card 2 */}
          <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 20, border: '1px solid #F3F4F6', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em' }}>QUICKEST PACE</span>
              <Clock size={14} color="#D97706" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 8 }}>
              No Live Data
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280' }}>
              <span>Fastest Lap: Monza</span>
              <span style={{ fontWeight: 600 }}>Session Rest</span>
            </div>
          </div>

          {/* Card 3 */}
          <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 20, border: '1px solid #F3F4F6', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em' }}>LEADING CONSTRUCTOR</span>
              <Zap size={14} color="#E8002D" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 8 }}>
              {constructorLeader.team_name}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280' }}>
              <span>Team Standings</span>
              <span style={{ fontWeight: 700, color: '#111827' }}>{constructorLeader.points} PTS</span>
            </div>
          </div>

          {/* Card 4 */}
          <div style={{ background: '#FFFFFF', borderRadius: 16, padding: 20, border: '1px solid #F3F4F6', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em' }}>RECENT SESSION</span>
              <Flag size={14} color="#4F46E5" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 8 }}>
              {lastSession?.circuit_short_name ?? 'Monza'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280' }}>
              <span>Official Result</span>
              <span style={{ fontWeight: 600 }}>Race Session</span>
            </div>
          </div>

        </div>
      </section>

      {/* ── 2026 STANDINGS SECTION ─────────────────────────────────────────── */}
      <section id="standings" style={{ maxWidth: 1040, margin: '0 auto 64px', padding: '0 24px' }}>
        <ChampionshipStandings
          drivers={standings.drivers}
          constructors={standings.constructors}
          currentYear={currentYear}
          round={standings.round}
          images={driverImages}
        />
      </section>

      {/* ── FOOTER (Identical to Landing Page) ────────────────────────────── */}
      <footer className="landing-footer" style={{
        borderTop: '1px solid #F3F4F6',
        padding: '32px 5vw',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 20,
        fontSize: 12,
        color: '#6B7280',
      }}>
        <div style={{ fontWeight: 700, color: '#111827', fontSize: 14 }}>
          Slipstream
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          {['Telemetry', 'Sessions', 'Schedule', 'Predictions', 'GitHub'].map(link => (
            <Link key={link} href={link === 'GitHub' ? 'https://github.com/abdullah-azeemi/Slipstream' : `/${link.toLowerCase()}`} style={{
              color: '#6B7280',
              textDecoration: 'none',
            }}>
              {link}
            </Link>
          ))}
        </div>

        <div>
          © 2026 Motorsport Platform. Built with intention.
        </div>
      </footer>

    </div>
  )
}
