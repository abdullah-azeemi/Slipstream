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

      {/* ── Breadcrumb ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#52525B' }}>
        <span>Dashboard</span>
        <span>/</span>
        <span style={{ color: '#A1A1AA' }}>Schedule</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <h1 style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '40px', color: '#fff', margin: 0, lineHeight: 1 }}>
          RACING CALENDAR
        </h1>
        <span style={{ color: '#A1A1AA', fontSize: '14px' }}>
          {fullSchedule?.season ?? 2026} Season &middot; {fullSchedule?.total_rounds ?? 0} Rounds
        </span>
      </div>

      {nextRace && nextRace.race && (
        <NextRaceCard data={nextRace} />
      )}

      {/* ── Full Schedule Grid ─────────────────────────────────────── */}
      {fullSchedule && fullSchedule.races && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginTop: '16px' }}>
          {fullSchedule.races.map((race: { round: number, flag: string, event_name: string, status: string, circuit: string, event_date: string }, idx: number) => {
            const isPast = race.status === 'past'
            const isLive = race.status === 'live'

            return (
              <div key={idx} style={{
                background: '#111111',
                border: `1px solid ${isLive ? '#E8002D' : '#2A2A2A'}`,
                borderRadius: '16px',
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
                    <span style={{ fontSize: '11px', color: '#A1A1AA', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                      ROUND {race.round}
                    </span>
                    <span style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', textTransform: 'uppercase', color: '#fff', lineHeight: 1.1 }}>
                      {race.flag} {race.event_name}
                    </span>
                  </div>
                  {isLive && (
                    <span style={{ background: '#E8002D', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 700, letterSpacing: '0.05em' }}>
                      LIVE
                    </span>
                  )}
                  {isPast && (
                    <span style={{ background: '#2A2A2A', color: '#A1A1AA', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                      COMPLETED
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid #1A1A1A' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#D4D4D8', fontSize: '13px' }}>
                    <MapPin size={14} style={{ color: '#52525B' }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {race.circuit}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#D4D4D8', fontSize: '13px' }}>
                    <CalendarDays size={14} style={{ color: '#52525B' }} />
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
