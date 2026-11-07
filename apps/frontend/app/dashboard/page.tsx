import type { Metadata } from 'next'
import Link from 'next/link'
import { auth, currentUser } from '@clerk/nextjs/server'
import {
  ArrowRight,
  CalendarBlank,
  Flag,
  Robot,
  Speedometer,
} from '@phosphor-icons/react/dist/ssr'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import LandingFooter from '@/components/landing/LandingFooter'
import SessionCountdown from '@/components/dashboard/SessionCountdown'
import Standings, { type ConstructorStanding, type DriverStanding } from '@/components/dashboard/Standings'
import type { ConversationSummary } from '@/types/agent'

export const metadata: Metadata = { title: 'Dashboard | Slipstream' }
export const dynamic = 'force-dynamic'

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

type Result<T> = { ok: true; data: T } | { ok: false; status?: number }

async function load<T>(path: string, token?: string, revalidate = 60): Promise<Result<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      next: { revalidate },
    })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false }
  }
}

interface NextRace {
  race: { event_name: string; circuit?: string; country?: string; round: number }
  next_session: { name: string; date_utc: string } | null
}
interface SessionRow {
  session_key: number
  year: number
  gp_name: string
  session_type: string
  date_start: string | null
  pole_driver?: string | null
  winner_driver?: string | null
}
interface StandingsPayload<T> { standings?: T[]; round?: number | string }

const QUICK = [
  { icon: Speedometer, title: 'Telemetry', body: 'Compare two drivers corner by corner.', href: '/telemetry' },
  { icon: Flag, title: 'Predictions', body: 'See the model call for the next session.', href: '/predictions' },
  { icon: Robot, title: 'Pitwall agent', body: 'Ask a question and get the evidence.', href: '/agent' },
  { icon: CalendarBlank, title: 'Schedule', body: 'Browse the full season calendar.', href: '/schedule' },
]

function ErrorNote({ what }: { what: string }) {
  return (
    <p className="body-6 muted" role="status">
      {what} could not be loaded. Refresh the page in a moment.
    </p>
  )
}

export default async function DashboardPage() {
  const year = new Date().getFullYear()
  const { getToken } = await auth()
  const token = (await getToken()) ?? undefined

  const [next, sessions, drivers, constructors, convos, user] = await Promise.all([
    load<NextRace>('/api/v1/schedule/next-race', undefined, 30),
    load<SessionRow[]>('/api/v1/sessions', token, 120),
    load<StandingsPayload<DriverStanding>>(`/api/v1/standings/drivers?year=${year}`, token, 300),
    load<StandingsPayload<ConstructorStanding>>(`/api/v1/standings/constructors?year=${year}`, token, 300),
    load<ConversationSummary[]>('/api/v1/agent/conversations', token, 0),
    currentUser().catch(() => null),
  ])

  const lastRace = sessions.ok
    ? sessions.data.find(s => s.session_type === 'R' && s.winner_driver && s.date_start && new Date(s.date_start) <= new Date())
    : undefined
  const lastPole = sessions.ok && lastRace
    ? sessions.data.find(s => s.year === lastRace.year && s.gp_name === lastRace.gp_name && s.pole_driver)?.pole_driver
    : undefined

  const roundOf = (r: Result<StandingsPayload<unknown>>) => (r.ok && r.data.round ? Number(r.data.round) : null)
  const standingsRound = roundOf(drivers) ?? roundOf(constructors)
  const recent = convos.ok ? convos.data.slice(0, 3) : []
  const name = user?.firstName

  return (
    <div className={`lp ${geist.className}`}>
      <div id="main" className="dash">
        <div className="wrap">
          <header className="dash-head">
            <p className="caption-1 muted">Dashboard</p>
            <h1 className="heading-3">{name ? `Welcome back, ${name}` : 'Welcome back'}</h1>
          </header>

          <div className="dash-grid">
            {/* Next session */}
            <section className="panel" aria-labelledby="next-title">
              <p className="caption-1">
                <span className="live-dot" aria-hidden="true" /> Next session
              </p>
              {next.ok && next.data.next_session ? (
                <>
                  <h2 id="next-title" className="heading-4">{next.data.next_session.name}</h2>
                  <p className="body-3 muted">
                    Round {next.data.race.round}, {next.data.race.event_name}
                    {next.data.race.circuit ? `, ${next.data.race.circuit}` : ''}
                  </p>
                  <SessionCountdown target={next.data.next_session.date_utc} />
                </>
              ) : next.ok ? (
                <>
                  <h2 id="next-title" className="heading-4">{next.data.race.event_name}</h2>
                  <p className="body-3 muted">
                    Round {next.data.race.round}
                    {next.data.race.circuit ? `, ${next.data.race.circuit}` : ''}. Session times are not available yet.
                  </p>
                </>
              ) : next.status === 404 ? (
                <>
                  <h2 id="next-title" className="heading-4">No upcoming race</h2>
                  <p className="body-3 muted">The calendar has no more races this season.</p>
                </>
              ) : (
                <>
                  <h2 id="next-title" className="heading-4">Next session</h2>
                  <ErrorNote what="The next session" />
                </>
              )}
            </section>

            {/* Last race */}
            <section className="panel" aria-labelledby="last-title">
              <p className="caption-1">Latest race</p>
              {lastRace ? (
                <>
                  <h2 id="last-title" className="heading-4">{lastRace.gp_name}</h2>
                  <ul className="result-list body-5">
                    <li><span className="muted">Winner</span><span>{lastRace.winner_driver}</span></li>
                    {lastPole ? <li><span className="muted">Pole</span><span>{lastPole}</span></li> : null}
                  </ul>
                  <Link href={`/sessions/${lastRace.session_key}`} className="btn btn-outline button-md" style={{ marginTop: 'var(--sp-300)' }}>
                    Open race analysis <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </Link>
                </>
              ) : sessions.ok ? (
                <>
                  <h2 id="last-title" className="heading-4">No races yet</h2>
                  <p className="body-3 muted">Finished races appear here once their data is ingested.</p>
                </>
              ) : (
                <>
                  <h2 id="last-title" className="heading-4">Latest race</h2>
                  <ErrorNote what="The latest race" />
                </>
              )}
            </section>
          </div>

          {/* Quick actions */}
          <div className="grid-4" style={{ marginTop: 'var(--sp-200)' }}>
            {QUICK.map(q => {
              const Icon = q.icon
              return (
                <Link key={q.href} href={q.href} className="card">
                  <span className="card-icon"><Icon size={20} aria-hidden="true" /></span>
                  <h3 className="heading-6">{q.title}</h3>
                  <p className="body-6">{q.body}</p>
                </Link>
              )
            })}
          </div>

          {/* Standings */}
          <section id="standings" className="dash-block" aria-label="Championship standings">
            {drivers.ok || constructors.ok ? (
              <Standings
                drivers={drivers.ok ? drivers.data.standings ?? [] : []}
                constructors={constructors.ok ? constructors.data.standings ?? [] : []}
                round={standingsRound}
                year={year}
                driversFailed={!drivers.ok}
                constructorsFailed={!constructors.ok}
              />
            ) : (
              <>
                <h2 className="heading-5">{year} standings</h2>
                <ErrorNote what="Standings" />
              </>
            )}
          </section>

          {/* Conversations */}
          <section className="dash-block" aria-labelledby="convo-title">
            <h2 id="convo-title" className="heading-5">Recent Pitwall conversations</h2>
            {recent.length > 0 ? (
              <ul className="convo-list">
                {recent.map(c => (
                  <li key={c.id}>
                    <Link href={`/agent?c=${c.id}`} className="card" style={{ height: '100%' }}>
                      <h3 className="title-3">{c.title ?? 'Untitled conversation'}</h3>
                      <p className="body-6">{c.last_message_preview ?? 'No messages yet.'}</p>
                      <span className="caption-4 muted">{c.message_count} messages</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : convos.ok ? (
              <div className="empty">
                <h3 className="heading-6">No conversations yet</h3>
                <p className="body-6">Ask Pitwall about a lap, a stint or a strategy call to get started.</p>
                <Link href="/agent" className="btn btn-primary button-md" style={{ marginTop: 'var(--sp-200)' }}>
                  Ask Pitwall <ArrowRight size={16} weight="bold" aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <ErrorNote what="Your conversations" />
            )}
          </section>
        </div>
      </div>
      <LandingFooter />
    </div>
  )
}
