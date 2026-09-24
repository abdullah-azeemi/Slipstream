import { CalendarDays } from 'lucide-react'
import Image from 'next/image'
import React from 'react'

export const revalidate = 60

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const HERO_IMAGE = 'https://images.unsplash.com/photo-1699138346491-d6f4c7e04b85?q=80&w=2232&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D'

type Race = {
  round: number
  event_name: string
  event_date: string
  end_date?: string
  circuit?: string
  country?: string
  status?: string
  top_finishers?: string[]
  track_length_km?: number
  laps?: number
  pole_forecast?: string
  category?: string
}

type NextRaceResponse = { race?: Race | null }
type ScheduleResponse = { races?: Race[] }

type RaceStatus = 'past' | 'upcoming' | 'scheduled'

function formatRound(round?: number) {
  return typeof round === 'number' ? String(round).padStart(2, '0') : '--'
}

function parseDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(value?: string, options?: Intl.DateTimeFormatOptions) {
  const date = parseDate(value)
  return date ? new Intl.DateTimeFormat('en-US', options).format(date) : 'TBD'
}

function formatDateRange(race: Race) {
  const start = parseDate(race.event_date)
  const end = parseDate(race.end_date)
  if (!start) return 'DATE TBD'
  if (!end) return formatDate(race.event_date, { month: 'short', day: '2-digit' }).toUpperCase()

  const startLabel = formatDate(race.event_date, { month: 'short', day: '2-digit' }).toUpperCase()
  const endLabel = formatDate(race.end_date, { month: 'short', day: '2-digit' }).toUpperCase()
  return `${startLabel}–${endLabel}`
}

function formatLocation(race: Race) {
  return [race.circuit, race.country].filter(Boolean).join(' • ') || 'Circuit details pending'
}

function normalizeStatus(status?: string): RaceStatus {
  const normalized = status?.toLowerCase()
  if (normalized === 'past' || normalized === 'completed' || normalized === 'finished') return 'past'
  if (normalized === 'upcoming' || normalized === 'next') return 'upcoming'
  return 'scheduled'
}


function HeroNextRace({ race }: { race: Race }) {
  const dateLabel = formatDate(race.event_date, { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()

  return (
    <section className="calendar-hero" aria-label={`Next race: ${race.event_name}`}>
      <Image
        src={HERO_IMAGE}
        alt="Washed-out aerial view of a racing circuit"
        fill
        sizes="(max-width: 768px) 100vw, 1120px"
        className="calendar-hero-image"
        priority
      />
      <div className="calendar-hero-wash" aria-hidden="true" />
      <div className="calendar-hero-grid" aria-hidden="true" />
      <div className="calendar-hero-content">
        <div className="calendar-hero-heading">
          <div className="calendar-hero-kicker">
            ROUND {formatRound(race.round)} / SEASON • FIA FORMULA 1 WORLD CHAMPIONSHIP
          </div>
          <div className="calendar-hero-title-row">
            <div className="calendar-hero-title-group">
              <h1>{race.event_name}</h1>
              <p>{formatLocation(race)}</p>
            </div>
          </div>
        </div>
        <div className="calendar-hero-stats" aria-label="Race statistics">
          <div>
            <span>Race date</span>
            <strong className="calendar-stat-accent">{dateLabel}</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function RaceCard({ race, isNext }: { race: Race; isNext: boolean }) {
  const status = normalizeStatus(race.status)
  const isPast = status === 'past'

  return (
    <article className={`calendar-card${isPast ? ' calendar-card-past' : ''}${isNext ? ' calendar-card-active' : ''}`}>
      <div className="calendar-card-meta">ROUND {formatRound(race.round)} • {formatDateRange(race)}</div>
      <div className="calendar-card-number" aria-hidden="true">{formatRound(race.round)}</div>
      {isNext && <span className="calendar-next-badge">NEXT UP</span>}
      <h3>{race.event_name}</h3>
      <p>{formatLocation(race)}</p>
    </article>
  )
}

export default async function SchedulePage() {
  const [nextRaceResponse, fullScheduleResponse] = await Promise.all([
    fetch(`${BASE}/api/v1/schedule/next-race`, { next: { revalidate: 60 } })
      .then(response => response.ok ? response.json() as Promise<NextRaceResponse> : null)
      .catch(() => null),
    fetch(`${BASE}/api/v1/schedule/2026`, { next: { revalidate: 60 } })
      .then(response => response.ok ? response.json() as Promise<ScheduleResponse> : null)
      .catch(() => null),
  ])

  const nextRace = nextRaceResponse?.race ?? null
  const races = Array.isArray(fullScheduleResponse?.races) ? fullScheduleResponse.races : []

  return (
    <div className="calendar-page">
      <div className="calendar-container">
        {nextRace && <HeroNextRace race={nextRace} />}

        <header className="calendar-section-header">
          <div>
            <div className="calendar-eyebrow">{new Date().getFullYear()} CALENDAR ROUNDS</div>
            <h2>ALL {races.length} CHAMPIONSHIP ROUNDS</h2>
          </div>
        </header>

        {races.length > 0 ? (
          <section className="calendar-grid" aria-label={`${races.length} championship rounds`}>
            {races.map(race => (
              <RaceCard key={`${race.round}-${race.event_name}`} race={race} isNext={nextRace?.round === race.round} />
            ))}
          </section>
        ) : (
          <div className="calendar-empty" role="status">
            <CalendarDays aria-hidden="true" />
            <strong>Schedule unavailable</strong>
            <span>Race data will appear here when the calendar is available.</span>
          </div>
        )}
      </div>
    </div>
  )
}
