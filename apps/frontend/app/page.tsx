import { api } from '@/lib/api'
import Image from 'next/image'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { formatLapTime, teamColour, sessionTypeLabel } from '@/lib/utils'
import { MapPin, Thermometer, Wind, Droplets, Clock, Trophy, Zap, Flag } from 'lucide-react'
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
    return { drivers: d.standings ?? [], constructors: c.standings ?? [], round: d.round ?? 0 }
  } catch {
    return { drivers: [], constructors: [], round: 0 }
  }
}

// ── Circuit image map ─────────────────────────────────────────────────────────

function getCircuitImage(gpName: string): string {
  const name = gpName?.toLowerCase() ?? ''
  if (name.includes('australian') || name.includes('melbourne'))
    return 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=1200&q=80'
  if (name.includes('monaco'))
    return 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=1200&q=80'
  if (name.includes('british') || name.includes('silverstone'))
    return 'https://images.unsplash.com/photo-1541447271487-09612b3f49f7?w=1200&q=80'
  if (name.includes('italian') || name.includes('monza'))
    return 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&q=80'
  return 'https://images.unsplash.com/photo-1541447271487-09612b3f49f7?w=1200&q=80'
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const sessions = await api.sessions.list(true).catch(() => [])
  const latestListed = sessions[0] ?? null
  const latestWeekendRace = latestListed
    ? sessions.find(
      s => s.year === latestListed.year
        && s.gp_name === latestListed.gp_name
        && s.session_type === 'R',
    ) ?? null
    : null
  const featuredSession = latestWeekendRace ?? latestListed
  const currentYear = featuredSession?.year ?? new Date().getFullYear()

  const [fastestLaps, standings, nextRace] = await Promise.all([
    featuredSession ? api.laps.fastest(featuredSession.session_key, true).catch(() => []) : Promise.resolve([]),
    fetchStandings(currentYear),
    fetch(`${BASE}/api/v1/schedule/next-race`, { next: { revalidate: 300 } }).then(r => r.json()).catch(() => null),
  ])

  const pole = (fastestLaps as { laps?: { lap_time_ms: number; abbreviation: string; team_name?: string }[] })?.laps?.[0] ?? null

  // Use nextRace as the Hero if available, otherwise latest session
  const heroRace = nextRace?.race
  const heroSession = nextRace?.next_session
  const heroImage = getCircuitImage(heroRace?.event_name ?? featuredSession?.gp_name ?? '')

  function formatDateToDayMonthYear(dateString: string) {
    if (!dateString) return ''
    const date = new Date(dateString)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${String(date.getUTCDate()).padStart(2, '0')} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
  }



  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

      {/* ── Hero + Track Conditions ────────────────────────────────── */}
      <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '16px', alignItems: 'stretch' }}>

        {/* Hero */}
        <div className="hero-card panel" style={{ position: 'relative', borderRadius: '28px', overflow: 'hidden', height: '390px' }}>
          <Image
            src={heroImage}
            alt={heroRace?.event_name || featuredSession?.gp_name || 'Slipstream hero circuit'}
            fill
            priority
            sizes="(max-width: 900px) 100vw, 900px"
            style={{ objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(4,10,18,0.28) 0%, rgba(5,14,22,0.58) 38%, rgba(6,12,20,0.96) 100%)' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at top right, rgba(133,215,255,0.22), transparent 28%), radial-gradient(circle at bottom left, rgba(232,0,45,0.16), transparent 26%)' }} />

          {/* Top-left Indicator */}
          <div className="hero-kicker" style={{ position: 'absolute', top: '24px', left: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {heroRace ? (
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#d4e3f1', letterSpacing: '0.14em', fontFamily: 'monospace', textTransform: 'uppercase', background: 'rgba(7,17,27,0.48)', border: '1px solid rgba(255,255,255,0.08)', width: 'fit-content', padding: '8px 12px', borderRadius: '999px', backdropFilter: 'blur(10px)' }}>
                NEXT UP — ROUND {heroRace.round}
              </span>
            ) : (
              featuredSession && (
                <span style={{ background: '#E8002D', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', padding: '7px 12px', borderRadius: '999px', fontFamily: 'monospace', boxShadow: '0 0 18px rgba(232,0,45,0.35)' }}>
                  {sessionTypeLabel(featuredSession.session_type).toUpperCase()}
                </span>
              )
            )}
          </div>

          {/* Bottom Content Layer */}
          <div style={{ position: 'absolute', inset: 0, padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <div className="hero-bottom-content" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>

              <div style={{ flex: 1 }}>
                <div className="hero-title-row" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  {heroRace?.flag && <span style={{ fontSize: '24px', lineHeight: 1 }}>{heroRace.flag}</span>}
                  <h1 className="hero-title" style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '36px', color: '#fff', lineHeight: 0.95, margin: 0, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {heroRace ? heroRace.event_name : (featuredSession?.gp_name?.replace(' Grand Prix', '') + ' GP')}
                  </h1>
                </div>

                <div className="hero-meta" style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#d4e3f1', fontSize: '11px', marginBottom: '20px', fontFamily: 'JetBrains Mono, monospace' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><MapPin size={14} /> {heroRace ? heroRace.circuit : featuredSession?.country}</span>
                  <span>·</span>
                  <span>{heroRace ? formatDateToDayMonthYear(heroRace.event_date) : featuredSession?.year}</span>
                </div>

                <div className="telemetry-chip-row hero-chip-grid">
                  <div className="panel-soft hero-chip-card" style={{ padding: '10px 12px', borderRadius: '16px', background: 'rgba(7,17,27,0.38)' }}>
                    <div className="eyebrow" style={{ marginBottom: '6px' }}>Weekend Status</div>
                    <div style={{ fontSize: '14px', color: '#fff', fontWeight: 700 }}>
                      {heroSession?.name ?? featuredSession?.session_name ?? 'Live'}
                    </div>
                  </div>
                  <div className="panel-soft hero-chip-card" style={{ padding: '10px 12px', borderRadius: '16px', background: 'rgba(7,17,27,0.38)' }}>
                    <div className="eyebrow" style={{ marginBottom: '6px' }}>Track Focus</div>
                    <div style={{ fontSize: '14px', color: '#fff', fontWeight: 700 }}>
                      {heroRace?.circuit ?? featuredSession?.gp_name ?? 'Analysis'}
                    </div>
                  </div>
                </div>


              </div>

              {/* Timer in bottom right */}
              {heroSession?.date_utc && (
                <div style={{ marginBottom: '8px' }}>
                  <CountdownTimer targetDate={heroSession.date_utc} sessionName={heroSession.name} />
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Track conditions — real data from DB */}
        <div className="panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', borderRadius: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, color: '#fff', fontSize: '15px' }}>Track Conditions</span>
            {featuredSession?.track_temp_c && (
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80' }} />
            )}
          </div>

          {[
            {
              Icon: Thermometer,
              label: 'Track Temp',
              value: featuredSession?.track_temp_c != null ? `${featuredSession.track_temp_c}°C` : '—',
              accent: '#f97316',
            },
            {
              Icon: Wind,
              label: 'Air Temp',
              value: featuredSession?.air_temp_c != null ? `${featuredSession.air_temp_c}°C` : '—',
              accent: '#60a5fa',
            },
            {
              Icon: Droplets,
              label: 'Humidity',
              value: featuredSession?.humidity_pct != null ? `${featuredSession.humidity_pct}%` : '—',
              accent: '#34d399',
            },
          ].map(({ Icon, label, value, accent }) => (
            <div key={label} className="panel-soft" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '18px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: `${accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={18} style={{ color: accent }} />
                </div>
                <span style={{ color: '#A1A1AA', fontSize: '14px' }}>{label}</span>
              </div>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: value === '—' ? '#3F3F46' : '#fff', fontSize: '18px' }}>{value}</span>
            </div>
          ))}

          {/* Rainfall indicator */}
          {featuredSession?.rainfall != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: featuredSession.rainfall ? '#3671C622' : '#1A1A1A', borderRadius: '10px', border: `1px solid ${featuredSession.rainfall ? '#3671C644' : '#2A2A2A'}` }}>
              <span style={{ fontSize: '16px' }}>{featuredSession.rainfall ? '🌧' : '☀️'}</span>
              <span style={{ fontSize: '12px', fontFamily: 'monospace', color: featuredSession.rainfall ? '#60a5fa' : '#71717A' }}>
                {featuredSession.rainfall ? 'Wet conditions' : 'Dry conditions'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────── */}
      {pole && (
        <div className="stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {[
            { label: 'CHAMPIONSHIP LEADER', value: standings.drivers[0]?.code ?? '—', sub: `${standings.drivers[0]?.points ?? 0} pts · ${standings.drivers[0]?.team_name ?? ''}`, Icon: Trophy, valueColour: '#FFD700', mono: false },
            { label: featuredSession?.session_type === 'R' ? 'RACE FASTEST LAP' : 'POLE / FASTEST LAP', value: formatLapTime(pole.lap_time_ms), sub: `${pole.abbreviation} — ${pole.team_name ?? ''}`, Icon: Clock, valueColour: '#E8002D', mono: true },
            { label: 'LEADING CONSTRUCTOR', value: standings.constructors[0]?.team_name?.split(' ')[0] ?? '—', sub: `${standings.constructors[0]?.points ?? 0} pts`, Icon: Zap, valueColour: '#fff', mono: false },
            { label: 'SESSION', value: sessionTypeLabel(featuredSession?.session_type ?? ''), sub: `${featuredSession?.year} ${featuredSession?.gp_name?.replace(' Grand Prix', ' GP')}`, Icon: Flag, valueColour: '#fff', mono: false },
          ].map(({ label, value, sub, Icon, valueColour, mono }) => (
            <div key={label} className="panel-soft" style={{ borderRadius: '22px', padding: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
                <Icon size={14} style={{ color: '#3F3F46' }} />
              </div>
              <div style={{ fontSize: '26px', fontWeight: 700, color: valueColour, fontFamily: mono ? 'monospace' : 'Rajdhani, sans-serif', lineHeight: 1, marginBottom: '6px' }}>
                {value}
              </div>
              <div style={{ fontSize: '12px', color: '#71717A' }}>{sub}</div>
            </div>
          ))}
        </div>
      )}

      <ChampionshipStandings
        drivers={standings.drivers}
        constructors={standings.constructors}
        currentYear={currentYear}
        round={standings.round}
      />

    </div>
  )
}
