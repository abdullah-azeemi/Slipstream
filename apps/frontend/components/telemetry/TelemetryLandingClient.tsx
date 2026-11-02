'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import { ToggleGroup } from '@/components/landing/Tabs'
import type { Session } from '@/types/f1'

type Props = { initialSessions: Session[]; failed?: boolean }
type Kind = 'Q' | 'R' | 'P'

const KINDS: { key: Kind; label: string }[] = [
  { key: 'Q', label: 'Qualifying' },
  { key: 'R', label: 'Race' },
  { key: 'P', label: 'Practice' },
]

function kindOf(type: string): Kind | null {
  if (type === 'Q' || type === 'SQ') return 'Q'
  if (type === 'R' || type === 'S' || type === 'SS') return 'R'
  if (type === 'FP1' || type === 'FP2' || type === 'FP3') return 'P'
  return null
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Date to be confirmed'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Date to be confirmed'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function SessionCard({ s }: { s: Session }) {
  return (
    <Link href={`/sessions/${s.session_key}/telemetry`} className="card">
      <div className="post-meta caption-4">
        <span className="tag">{s.session_name || s.session_type}</span>
        <time dateTime={s.date_start ?? undefined}>{fmtDate(s.date_start)}</time>
      </div>
      <h3 className="heading-6">{s.gp_name.replace(' Grand Prix', '')}</h3>
      {s.country ? <p className="body-6">{s.country}</p> : null}
      <span className="card-link button-sm">
        Open telemetry <ArrowRight size={16} weight="bold" aria-hidden="true" />
      </span>
    </Link>
  )
}

export default function TelemetryLandingClient({ initialSessions, failed = false }: Props) {
  // Hide sessions whose laps have not been loaded yet: their telemetry page would be empty.
  const usable = useMemo(
    () => initialSessions.filter(s => kindOf(s.session_type) !== null && s.has_laps !== false),
    [initialSessions],
  )
  const years = useMemo(() => Array.from(new Set(usable.map(s => s.year))).sort((a, b) => b - a), [usable])

  const [year, setYear] = useState<number | null>(years[0] ?? null)
  const [kind, setKind] = useState<Kind>(() => {
    const first = years[0]
    const order: Kind[] = ['Q', 'R', 'P']
    return order.find(k => usable.some(s => s.year === first && kindOf(s.session_type) === k)) ?? 'Q'
  })
  const [query, setQuery] = useState('')

  const latest = useMemo(
    () => usable.find(s => kindOf(s.session_type) === 'Q') ?? usable[0],
    [usable],
  )

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return usable
      .filter(s => (year ? s.year === year : true))
      .filter(s => kindOf(s.session_type) === kind)
      .filter(s => !q || `${s.gp_name} ${s.country ?? ''}`.toLowerCase().includes(q))
  }, [usable, year, kind, query])

  const counts = useMemo(() => {
    const c: Record<Kind, number> = { Q: 0, R: 0, P: 0 }
    usable.filter(s => (year ? s.year === year : true)).forEach(s => { const k = kindOf(s.session_type); if (k) c[k] += 1 })
    return c
  }, [usable, year])

  return (
    <div className={`lp ${geist.className}`}>
      <div id="main" className="dash">
        <div className="wrap">
          <header className="dash-head" style={{ maxWidth: 680 }}>
            <p className="caption-1 muted">Telemetry</p>
            <h1 className="heading-3">Pick a session to analyse</h1>
            <p className="body-3 muted" style={{ marginTop: 'var(--sp-100)' }}>
              Compare two drivers lap by lap, corner by corner. Choose a qualifying session, race or practice below.
            </p>
          </header>

          {failed ? (
            <div className="inline-error" role="status">
              <span className="body-6 muted">Sessions could not be loaded. Refresh the page in a moment.</span>
            </div>
          ) : usable.length === 0 ? (
            <div className="empty">
              <h2 className="heading-6">No sessions yet</h2>
              <p className="body-6">Sessions appear here once their data has been ingested.</p>
            </div>
          ) : (
            <>
              {latest && (
                <section className="panel" aria-labelledby="latest-title" style={{ marginBottom: 'var(--sp-500)' }}>
                  <p className="caption-1"><span className="live-dot" aria-hidden="true" /> Latest session</p>
                  <h2 id="latest-title" className="heading-4">{latest.gp_name.replace(' Grand Prix', '')}</h2>
                  <p className="body-3 muted">
                    {latest.session_name || latest.session_type}, {fmtDate(latest.date_start)}
                  </p>
                  <Link
                    href={`/sessions/${latest.session_key}/telemetry`}
                    className="btn btn-primary button-md"
                    style={{ marginTop: 'var(--sp-300)' }}
                  >
                    Open telemetry <ArrowRight size={16} weight="bold" aria-hidden="true" />
                  </Link>
                </section>
              )}

              <div className="tel-filters">
                <ToggleGroup
                  label="Season"
                  value={year}
                  onChange={setYear}
                  items={years.map(y => ({ key: y, label: String(y) }))}
                />
                <ToggleGroup
                  label="Session type"
                  value={kind}
                  onChange={setKind}
                  items={KINDS.map(k => ({ key: k.key, label: <>{k.label} <span className="muted">{counts[k.key]}</span></> }))}
                />
                <label className="search">
                  <MagnifyingGlass size={16} aria-hidden="true" />
                  <span className="sr-only">Search Grand Prix</span>
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search Grand Prix"
                    className="body-5"
                  />
                </label>
              </div>

              {list.length > 0 ? (
                <div className="grid-3">
                  {list.map(s => <SessionCard key={s.session_key} s={s} />)}
                </div>
              ) : (
                <div className="empty">
                  <h2 className="heading-6">No matching sessions</h2>
                  <p className="body-6">Try another season, session type or search term.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
