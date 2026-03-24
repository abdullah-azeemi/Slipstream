import { api } from '@/lib/api'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { formatLapTime, teamColour, sessionTypeLabel } from '@/lib/utils'
import Link from 'next/link'
import { MapPin, Thermometer, Wind, Droplets, Clock, Trophy, Zap, Flag } from 'lucide-react'
import CountdownTimer from '@/components/schedule/CountdownTimer'

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

// ── Team colour map for constructors (Ergast names → hex) ────────────────────

const CONSTRUCTOR_COLOURS: Record<string, string> = {
  'Mercedes': '27F4D2',
  'Red Bull': '3671C6',
  'Ferrari': 'E8002D',
  'McLaren': 'FF8000',
  'Aston Martin': '229971',
  'Alpine': 'FF87BC',
  'Williams': '64C4FF',
  'Haas F1 Team': 'B6BABD',
  'Kick Sauber': '52E252',
  'RB': '6692FF',
  'Racing Bulls': '6692FF',
  'Cadillac': 'C8A217',
}

function constructorColour(name: string): string {
  for (const [k, v] of Object.entries(CONSTRUCTOR_COLOURS)) {
    if (name?.includes(k) || k.includes(name ?? '')) return '#' + v
  }
  return '#666666'
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

// ── Position badge ────────────────────────────────────────────────────────────

function PosBadge({ pos }: { pos: number }) {
  const gold = pos === 1
  const silver = pos === 2
  const bronze = pos === 3
  const bg = gold ? '#FFD70022' : silver ? '#C0C0C022' : bronze ? '#CD7F3222' : 'transparent'
  const col = gold ? '#FFD700' : silver ? '#C0C0C0' : bronze ? '#CD7F32' : '#52525B'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '28px', height: '28px', borderRadius: '6px',
      background: bg, color: col,
      fontSize: '12px', fontFamily: 'monospace', fontWeight: 700,
      flexShrink: 0,
    }}>
      {pos}
    </span>
  )
}

// ── Points bar ────────────────────────────────────────────────────────────────

function PtsBar({ pts, max, colour }: { pts: number; max: number; colour: string }) {
  const pct = max > 0 ? (pts / max) * 100 : 0
  return (
    <div style={{ flex: 1, height: '4px', background: '#1A1A1A', borderRadius: '2px', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: colour + 'AA', borderRadius: '2px', transition: 'width 0.4s ease' }} />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const sessions = await api.sessions.list(true).catch(() => [])
  const latest = sessions[0] ?? null
  const currentYear = latest?.year ?? new Date().getFullYear()

  const [fastestLaps, standings, nextRace] = await Promise.all([
    latest ? api.laps.fastest(latest.session_key, true).catch(() => []) : Promise.resolve([]),
    fetchStandings(currentYear),
    fetch(`${BASE}/api/v1/schedule/next-race`, { next: { revalidate: 60 } }).then(r => r.json()).catch(() => null),
  ])

  const maxConPts = standings.constructors[0]?.points ?? 1
  const pole = (fastestLaps as { laps?: { lap_time_ms: number; abbreviation: string; team_name?: string }[] })?.laps?.[0] ?? null
  const maxDriverPts = standings.drivers[0]?.points ?? 1

  // Use nextRace as the Hero if available, otherwise latest session
  const heroRace = nextRace?.race
  const heroSession = nextRace?.next_session
  const heroImage = getCircuitImage(heroRace?.event_name ?? latest?.gp_name ?? '')

  function formatDateToDayMonthYear(dateString: string) {
    if (!dateString) return ''
    const date = new Date(dateString)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${String(date.getUTCDate()).padStart(2, '0')} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
  }



  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Breadcrumb ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#52525B' }}>
        <span>Dashboard</span>
        <span>/</span>
        <span style={{ color: '#A1A1AA' }}>Home</span>
      </div>

      {/* ── Hero + Track Conditions ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '16px', alignItems: 'stretch' }}>

        {/* Hero */}
        <div style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', height: '360px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroImage} alt={heroRace?.event_name || latest?.gp_name}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, rgba(0,0,0,0.2) 100%)' }} />

          {/* Top-left Indicator */}
          <div style={{ position: 'absolute', top: '24px', left: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {heroRace ? (
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#A1A1AA', letterSpacing: '0.08em', fontFamily: 'monospace', textTransform: 'uppercase' }}>
                NEXT UP — ROUND {heroRace.round}
              </span>
            ) : (
              latest && (
                <span style={{ background: '#E8002D', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', padding: '4px 10px', borderRadius: '4px', fontFamily: 'monospace' }}>
                  {sessionTypeLabel(latest.session_type).toUpperCase()}
                </span>
              )
            )}
          </div>

          {/* Bottom Content Layer */}
          <div style={{ position: 'absolute', inset: 0, padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>

              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  {heroRace?.flag && <span style={{ fontSize: '24px', lineHeight: 1 }}>{heroRace.flag}</span>}
                  <h1 style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '32px', color: '#fff', lineHeight: 1, margin: 0, textTransform: 'uppercase' }}>
                    {heroRace ? heroRace.event_name : (latest?.gp_name?.replace(' Grand Prix', '') + ' GP')}
                  </h1>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#D4D4D8', fontSize: '11px', marginBottom: '20px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><MapPin size={14} /> {heroRace ? heroRace.circuit : latest?.country}</span>
                  <span>·</span>
                  <span>{heroRace ? formatDateToDayMonthYear(heroRace.event_date) : latest?.year}</span>
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
        <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, color: '#fff', fontSize: '15px' }}>Track Conditions</span>
            {latest?.track_temp_c && (
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ade80' }} />
            )}
          </div>

          {[
            {
              Icon: Thermometer,
              label: 'Track Temp',
              value: latest?.track_temp_c != null ? `${latest.track_temp_c}°C` : '—',
              accent: '#f97316',
            },
            {
              Icon: Wind,
              label: 'Air Temp',
              value: latest?.air_temp_c != null ? `${latest.air_temp_c}°C` : '—',
              accent: '#60a5fa',
            },
            {
              Icon: Droplets,
              label: 'Humidity',
              value: latest?.humidity_pct != null ? `${latest.humidity_pct}%` : '—',
              accent: '#34d399',
            },
          ].map(({ Icon, label, value, accent }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1A1A1A', borderRadius: '12px', padding: '14px 16px', border: '1px solid #2A2A2A' }}>
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
          {latest?.rainfall != null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: latest.rainfall ? '#3671C622' : '#1A1A1A', borderRadius: '10px', border: `1px solid ${latest.rainfall ? '#3671C644' : '#2A2A2A'}` }}>
              <span style={{ fontSize: '16px' }}>{latest.rainfall ? '🌧' : '☀️'}</span>
              <span style={{ fontSize: '12px', fontFamily: 'monospace', color: latest.rainfall ? '#60a5fa' : '#71717A' }}>
                {latest.rainfall ? 'Wet conditions' : 'Dry conditions'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────── */}
      {pole && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {[
            { label: 'CHAMPIONSHIP LEADER', value: standings.drivers[0]?.code ?? '—', sub: `${standings.drivers[0]?.points ?? 0} pts · ${standings.drivers[0]?.team_name ?? ''}`, Icon: Trophy, valueColour: '#FFD700', mono: false },
            { label: 'POLE / FASTEST LAP', value: formatLapTime(pole.lap_time_ms), sub: `${pole.abbreviation} — ${pole.team_name ?? ''}`, Icon: Clock, valueColour: '#E8002D', mono: true },
            { label: 'LEADING CONSTRUCTOR', value: standings.constructors[0]?.team_name?.split(' ')[0] ?? '—', sub: `${standings.constructors[0]?.points ?? 0} pts`, Icon: Zap, valueColour: '#fff', mono: false },
            { label: 'SESSION', value: sessionTypeLabel(latest?.session_type ?? ''), sub: `${latest?.year} ${latest?.gp_name?.replace(' Grand Prix', ' GP')}`, Icon: Flag, valueColour: '#fff', mono: false },
          ].map(({ label, value, sub, Icon, valueColour, mono }) => (
            <div key={label} style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px', padding: '16px' }}>
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

      {/* ── Driver Championship Standings ──────────────────────────── */}
      {standings.drivers.length > 0 && (
        <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #2A2A2A' }}>
            <div>
              <span style={{ fontWeight: 600, color: '#fff', fontSize: '15px' }}>Driver Championship</span>
              <span style={{ marginLeft: '10px', fontSize: '10px', fontFamily: 'monospace', color: '#52525B' }}>
                {currentYear} · {standings.round} race{standings.round !== 1 ? 's' : ''}
              </span>
            </div>
            <Link href="/sessions" style={{ color: '#E8002D', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
              All Sessions →
            </Link>
          </div>

          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '40px 28px 1fr 140px 60px 48px 48px', gap: '8px', padding: '8px 20px', fontSize: '9px', color: '#3F3F46', fontFamily: 'monospace', letterSpacing: '0.1em', borderBottom: '1px solid #1A1A1A' }}>
            <span>POS</span><span></span><span>DRIVER</span><span>TEAM</span><span>PTS BAR</span><span style={{ textAlign: 'right' }}>PTS</span><span style={{ textAlign: 'right' }}>W</span>
          </div>

          {standings.drivers.slice(0, 10).map((driver: { position: number, code: string, full_name: string, team_name: string, points: number, wins: number }) => {
            const colour = constructorColour(driver.team_name)
            return (
              <div key={driver.code} style={{ display: 'grid', gridTemplateColumns: '40px 28px 1fr 140px 60px 48px 48px', gap: '8px', padding: '11px 20px', borderBottom: '1px solid #1A1A1A', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#52525B' }}>
                  {String(driver.position).padStart(2, '0')}
                </span>
                <PosBadge pos={driver.position} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{ width: '3px', height: '20px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {driver.full_name}
                    </div>
                    <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace' }}>{driver.code}</div>
                  </div>
                </div>
                <span style={{ fontSize: '12px', color: '#71717A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{driver.team_name}</span>
                <PtsBar pts={driver.points} max={maxDriverPts} colour={colour} />
                <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontWeight: 700, textAlign: 'right' }}>{driver.points}</span>
                <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#52525B', textAlign: 'right' }}>{driver.wins}</span>
              </div>
            )
          })}

          {standings.drivers.length > 10 && (
            <div style={{ padding: '12px 20px', fontSize: '11px', color: '#3F3F46', fontFamily: 'monospace', textAlign: 'center' }}>
              +{standings.drivers.length - 10} more drivers
            </div>
          )}
        </div>
      )}

      {/* ── Constructor Championship ────────────────────────────────── */}
      {standings.constructors.length > 0 && (
        <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #2A2A2A' }}>
            <span style={{ fontWeight: 600, color: '#fff', fontSize: '15px' }}>Constructor Championship</span>
            <span style={{ marginLeft: '10px', fontSize: '10px', fontFamily: 'monospace', color: '#52525B' }}>
              {currentYear}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1px', background: '#1A1A1A' }}>
            {standings.constructors.map((con: { position: number, team_name: string, points: number, wins: number }) => {
              const colour = constructorColour(con.team_name)
              return (
                <div key={con.team_name} style={{ background: '#111111', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <PosBadge pos={con.position} />
                  <div style={{ width: '3px', height: '32px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {con.team_name}
                    </div>
                    <PtsBar pts={con.points} max={maxConPts} colour={colour} />
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 700, color: '#fff' }}>{con.points}</div>
                    <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>{con.wins}W</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}