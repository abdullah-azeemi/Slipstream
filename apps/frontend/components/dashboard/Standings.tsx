'use client'

import { useState } from 'react'

export interface DriverStanding {
  position: string | number
  code: string | null
  full_name: string
  team_name: string
  points: string | number
  wins: string | number
}
export interface ConstructorStanding {
  position: string | number
  team_name: string
  points: string | number
  wins: string | number
}

const COLOURS: Record<string, string> = {
  mercedes: '#27F4D2',
  'red bull': '#3671C6',
  ferrari: '#E8002D',
  mclaren: '#FF8000',
  'aston martin': '#229971',
  alpine: '#FF87BC',
  williams: '#64C4FF',
  haas: '#B6BABD',
  sauber: '#52E252',
  audi: '#B6BABD',
  cadillac: '#9AA0A6',
  rb: '#6692FF',
  racing: '#6692FF',
}

function colour(team: string): string {
  const n = team.toLowerCase()
  for (const [k, v] of Object.entries(COLOURS)) if (n.includes(k)) return v
  return '#9AA0A6'
}

export default function Standings({
  drivers,
  constructors,
  round,
  year,
}: {
  drivers: DriverStanding[]
  constructors: ConstructorStanding[]
  round: number | null
  year: number
}) {
  const [tab, setTab] = useState<'drivers' | 'constructors'>('drivers')
  const [all, setAll] = useState(false)

  const rows =
    tab === 'drivers'
      ? drivers.map(d => ({ pos: d.position, name: d.full_name, sub: d.team_name, code: d.code, pts: d.points, wins: d.wins, team: d.team_name }))
      : constructors.map(c => ({ pos: c.position, name: c.team_name, sub: '', code: null as string | null, pts: c.points, wins: c.wins, team: c.team_name }))
  const shown = all ? rows : rows.slice(0, 10)
  const lead = Number(rows[0]?.pts ?? 0)

  return (
    <div>
      <div className="standings-head">
        <div>
          <h2 className="heading-5">{year} standings</h2>
          <p className="body-6 muted">
            {round ? `After round ${round}` : 'Season not started'}
          </p>
        </div>
        <div className="tabs" role="tablist" aria-label="Standings type">
          {(['drivers', 'constructors'] as const).map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`tab button-sm ${tab === t ? 'on' : ''}`}
              onClick={() => { setTab(t); setAll(false) }}
            >
              {t === 'drivers' ? 'Drivers' : 'Constructors'}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <h3 className="heading-6">No standings yet</h3>
          <p className="body-6">Standings appear after the first race of the season.</p>
        </div>
      ) : (
        <>
          <ol className="standings-list">
            {shown.map(r => {
              const gap = lead - Number(r.pts)
              return (
                <li key={`${tab}-${r.name}`} className="standing-row">
                  <span className="pos title-4">{r.pos}</span>
                  <span className="bar" style={{ background: colour(r.team) }} aria-hidden="true" />
                  <span className="who">
                    <span className="title-3">{r.name}</span>
                    {r.sub ? <span className="caption-4 muted">{r.sub}</span> : null}
                  </span>
                  <span className="wins caption-4 muted">{Number(r.wins)} {Number(r.wins) === 1 ? 'win' : 'wins'}</span>
                  <span className="pts">
                    <span className="title-3">{r.pts}</span>
                    <span className="caption-4 muted">{gap > 0 ? `-${gap}` : 'Leader'}</span>
                  </span>
                </li>
              )
            })}
          </ol>
          {rows.length > 10 && (
            <button type="button" className="btn btn-outline button-md" style={{ marginTop: 'var(--sp-200)' }} onClick={() => setAll(a => !a)}>
              {all ? 'Show top 10' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
