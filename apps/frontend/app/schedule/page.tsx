import type { Metadata } from 'next'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import SessionCountdown from '@/components/dashboard/SessionCountdown'
import LocalTime from '@/components/dashboard/LocalTime'

export const metadata: Metadata = { title: 'Schedule | Slipstream' }
export const revalidate = 60

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

type SessionTime = { name: string; date_utc: string | null }
type Race = {
  round: number
  event_name: string
  event_date: string
  circuit?: string
  country?: string
  flag?: string
  status?: string
  top_finishers?: string[]
  sessions?: SessionTime[]
}
type NextRaceResponse = { race?: Race | null; next_session?: { name: string; date_utc: string } | null }
type ScheduleResponse = { races?: Race[] }

function parseDate(value?: string) {
  if (!value) return null
  const d = new Date(String(value).split(' ')[0])
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtDate(value?: string) {
  const d = parseDate(value)
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Date to be confirmed'
}

function location(r: Race) {
  return [r.circuit, r.country].filter(Boolean).join(', ') || 'Circuit details pending'
}

const STATUS_LABEL: Record<string, string> = { past: 'Completed', live: 'This weekend', upcoming: 'Upcoming' }

export default async function SchedulePage() {
  const [next, schedule] = await Promise.all([
    fetch(`${BASE}/api/v1/schedule/next-race`, { next: { revalidate: 30 } })
      .then(r => (r.ok ? (r.json() as Promise<NextRaceResponse>) : null))
      .catch(() => null),
    fetch(`${BASE}/api/v1/schedule/current`, { next: { revalidate: 60 } })
      .then(r => (r.ok ? (r.json() as Promise<ScheduleResponse>) : null))
      .catch(() => null),
  ])

  const nextRace = next?.race ?? null
  const races = Array.isArray(schedule?.races) ? schedule.races : []
  const year = new Date().getFullYear()

  return (
    <div className={`lp ${geist.className}`}>
      <div className="dash">
        <div className="wrap">
          <header className="dash-head" style={{ maxWidth: 720 }}>
            <p className="caption-1 muted">Schedule</p>
            <h1 className="heading-3">{year} season calendar</h1>
            <p className="body-3 muted" style={{ marginTop: 'var(--sp-100)' }}>
              Every round of the championship, with session times shown in your own timezone.
            </p>
          </header>

          {nextRace && (
            <section className="panel" aria-labelledby="next-up" style={{ marginBottom: 'var(--sp-300)' }}>
              <div className="pred-grid">
                <div>
                  <p className="caption-1"><span className="live-dot" aria-hidden="true" /> Next up</p>
                  <h2 id="next-up" className="heading-4">
                    {nextRace.flag ? <span aria-hidden="true">{nextRace.flag} </span> : null}{nextRace.event_name}
                  </h2>
                  <p className="body-3 muted">Round {nextRace.round}, {location(nextRace)}</p>
                  {next?.next_session?.date_utc ? (
                    <>
                      <p className="body-5" style={{ marginTop: 'var(--sp-200)' }}>{next.next_session.name} starts in</p>
                      <SessionCountdown target={next.next_session.date_utc} />
                    </>
                  ) : (
                    <p className="body-6 muted" style={{ marginTop: 'var(--sp-200)' }}>Session times are not available yet.</p>
                  )}
                </div>
                {nextRace.sessions && nextRace.sessions.length > 0 && (
                  <div>
                    <h3 className="title-3">Weekend schedule</h3>
                    <ul className="result-list body-5">
                      {nextRace.sessions.map(s => (
                        <li key={s.name}>
                          <span>{s.name}</span>
                          {s.date_utc ? <LocalTime iso={s.date_utc} className="muted" /> : <span className="muted">To be confirmed</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {races.length > 0 ? (
            <section aria-label={`${races.length} championship rounds`}>
              <p className="caption-1 muted" style={{ marginBottom: 'var(--sp-200)' }}>{races.length} rounds</p>
              <div className="grid-3">
                {races.map(r => {
                  const isNext = nextRace?.round === r.round
                  const label = isNext ? 'Next up' : STATUS_LABEL[r.status ?? ''] ?? 'Upcoming'
                  return (
                    <article key={`${r.round}-${r.event_name}`} className="card" style={isNext ? { borderColor: 'var(--lp-text)', borderWidth: 2 } : undefined}>
                      <div className="post-meta caption-4">
                        <span className="tag">Round {r.round}</span>
                        <span className="tag">{label}</span>
                      </div>
                      <h2 className="heading-6">{r.flag ? <span aria-hidden="true">{r.flag} </span> : null}{r.event_name}</h2>
                      <p className="body-6">{location(r)}<br />{fmtDate(r.event_date)}</p>
                      {r.top_finishers && r.top_finishers.length > 0 && (
                        <p className="body-5" style={{ marginTop: 'var(--sp-75)' }}>
                          <span className="muted">Podium </span>{r.top_finishers.join(', ')}
                        </p>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : (
            <div className="empty" role="status">
              <h2 className="heading-6">Schedule unavailable</h2>
              <p className="body-6">The calendar could not be loaded. Refresh the page in a moment.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
