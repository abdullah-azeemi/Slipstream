'use client'

import { useCallback, useEffect, useState } from 'react'

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

interface Stats {
  sessions: number
  seasons: number
  first_season: number | null
  last_season: number | null
  laps: number
}

interface NextRace {
  race: { event_name: string; country: string; flag: string; round: number }
  next_session: { name: string; date_utc: string } | null
}

type Status = 'loading' | 'ready' | 'error'

const nf = new Intl.NumberFormat('en-US')

function countdown(iso: string | undefined, now: number): string {
  if (!iso) return 'Date to be confirmed'
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return 'Date to be confirmed'
  const diff = target - now
  if (diff <= 0) return 'On track now'
  const mins = Math.floor(diff / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (days > 0) return `In ${days}d ${hours}h`
  if (hours > 0) return `In ${hours}h ${m}m`
  return `In ${m}m`
}

export default function LiveStats() {
  const [status, setStatus] = useState<Status>('loading')
  const [stats, setStats] = useState<Stats | null>(null)
  const [next, setNext] = useState<NextRace | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [sRes, nRes] = await Promise.all([
        fetch(`${BASE}/api/v1/stats`),
        fetch(`${BASE}/api/v1/schedule/next-race`).catch(() => null),
      ])
      if (!sRes.ok) throw new Error(`stats ${sRes.status}`)
      setStats((await sRes.json()) as Stats)
      setNext(nRes && nRes.ok ? ((await nRes.json()) as NextRace) : null)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(id)
  }, [])

  const seasonRange =
    stats && stats.first_season && stats.last_season
      ? stats.first_season === stats.last_season
        ? String(stats.first_season)
        : `${stats.first_season} to ${stats.last_season}`
      : null

  return (
    <section className="reveal" aria-labelledby="live-stats-title" style={{ paddingBottom: 'var(--sp-300)' }}>
      <div className="wrap">
        <div className="stats-head caption-1">
          <span className="live-dot" aria-hidden="true" />
          <h2 id="live-stats-title" className="caption-1">
            Live from the Slipstream database
          </h2>
        </div>

        {status === 'error' ? (
          <div className="inline-error" role="status">
            <span className="body-6 muted">
              Live numbers are unavailable right now. Try again in a moment.
            </span>
            <button type="button" className="btn btn-outline button-sm" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : (
          <div className="stats-grid" aria-busy={status === 'loading'}>
            <Stat
              loading={status === 'loading'}
              value={stats ? nf.format(stats.sessions) : ''}
              label="Sessions analysed"
            />
            <Stat
              loading={status === 'loading'}
              value={stats ? nf.format(stats.laps) : ''}
              label="Laps in the archive"
            />
            <Stat
              loading={status === 'loading'}
              value={seasonRange ?? (stats ? 'None yet' : '')}
              label="Seasons covered"
            />
            <Stat
              loading={status === 'loading'}
              value={next?.next_session ? countdown(next.next_session.date_utc, now) : 'Off season'}
              label={
                next
                  ? `${next.next_session?.name ?? 'Next session'}, ${next.race.event_name}`
                  : 'No upcoming session'
              }
            />
          </div>
        )}
      </div>
    </section>
  )
}

function Stat({ loading, value, label }: { loading: boolean; value: string; label: string }) {
  return (
    <div className="stat">
      {loading ? (
        <>
          <span className="skeleton" style={{ width: '60%', height: 40 }} />
          <span className="skeleton" style={{ width: '80%', height: 20, marginTop: 8 }} />
        </>
      ) : (
        <>
          <div className="value">{value}</div>
          <div className="label body-6">{label}</div>
        </>
      )}
    </div>
  )
}
