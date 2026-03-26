import NextRaceCard from '@/components/schedule/NextRaceCard'
import { MapPin, CalendarDays } from 'lucide-react'

export const revalidate = 60

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function formatDateShort(dateString: string) {
  const date = new Date(dateString)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${String(date.getUTCDate()).padStart(2, '0')} ${months[date.getUTCMonth()]}`
}

export default async function SchedulePage() {
  const [nextRace, fullSchedule] = await Promise.all([
    fetch(`${BASE}/api/v1/schedule/next-race`, { next: { revalidate: 60 } }).then(r => r.json()).catch(() => null),
    fetch(`${BASE}/api/v1/schedule/2026`, { next: { revalidate: 3600 } }).then(r => r.json()).catch(() => null)
  ])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      <section className="panel fade-up" style={{ padding: '22px 22px 18px' }}>
        <div className="eyebrow" style={{ marginBottom: '10px' }}>Race Calendar</div>
        <h1 className="page-title" style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', margin: 0 }}>
          RACING CALENDAR
        </h1>
        <span className="page-subtitle" style={{ display: 'block', marginTop: '8px' }}>
          {fullSchedule?.season ?? 2026} Season &middot; {fullSchedule?.total_rounds ?? 0} Rounds
        </span>
        <div className="telemetry-chip-row" style={{ marginTop: '14px' }}>
          <div className="panel-soft" style={{ padding: '10px 12px', borderRadius: '16px', minWidth: '140px' }}>
            <div className="eyebrow" style={{ marginBottom: '6px' }}>Season</div>
            <div style={{ fontSize: '18px', color: '#fff', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>{fullSchedule?.season ?? 2026}</div>
          </div>
          <div className="panel-soft" style={{ padding: '10px 12px', borderRadius: '16px', minWidth: '140px' }}>
            <div className="eyebrow" style={{ marginBottom: '6px' }}>Rounds</div>
            <div style={{ fontSize: '18px', color: '#f2c879', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>{fullSchedule?.total_rounds ?? 0}</div>
          </div>
        </div>
      </section>

      {nextRace && nextRace.race && (
        <div className="fade-up-delay-1">
          <NextRaceCard data={nextRace} />
        </div>
      )}

      {/* ── Full Schedule Grid ─────────────────────────────────────── */}
      {fullSchedule && fullSchedule.races && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginTop: '8px' }}>
          {fullSchedule.races.map((race: { round: number, flag: string, event_name: string, status: string, circuit: string, event_date: string }, idx: number) => {
            const isPast = race.status === 'past'
            const isLive = race.status === 'live'

            return (
              <div key={idx} className="panel-soft interactive-card fade-up-delay-2" style={{
                border: `1px solid ${isLive ? '#E8002D55' : 'rgba(152,181,211,0.12)'}`,
                borderRadius: '22px',
                padding: '20px',
                opacity: isPast ? 0.6 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                transition: 'all 0.2s ease',
                cursor: 'default'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#9fb2c6', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                      ROUND {race.round}
                    </span>
                    <span style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', textTransform: 'uppercase', color: '#fff', lineHeight: 1.1 }}>
                      {race.flag} {race.event_name}
                    </span>
                  </div>
                  {isLive && (
                    <span style={{ background: '#E8002D', color: '#fff', fontSize: '10px', padding: '4px 8px', borderRadius: '999px', fontWeight: 700, letterSpacing: '0.05em' }}>
                      LIVE
                    </span>
                  )}
                  {isPast && (
                    <span style={{ background: 'rgba(255,255,255,0.05)', color: '#A1A1AA', fontSize: '10px', padding: '4px 8px', borderRadius: '999px', fontWeight: 600 }}>
                      COMPLETED
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid rgba(152,181,211,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#D4D4D8', fontSize: '13px' }}>
                    <MapPin size={14} style={{ color: '#5e7289' }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {race.circuit}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#D4D4D8', fontSize: '13px' }}>
                    <CalendarDays size={14} style={{ color: '#5e7289' }} />
                    <span>{formatDateShort(race.event_date)} {fullSchedule.season}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
