'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

type DriverStanding = {
  position: number
  code: string
  full_name: string
  team_name: string
  points: number
  wins: number
}

type ConstructorStanding = {
  position: number
  team_name: string
  points: number
  wins: number
}

function constructorColour(name: string): string {
  const colours: Record<string, string> = {
    Mercedes: '#27F4D2',
    'Red Bull': '#3671C6',
    Ferrari: '#E8002D',
    McLaren: '#FF8000',
    'Aston Martin': '#229971',
    Alpine: '#FF87BC',
    Williams: '#64C4FF',
    'Haas F1 Team': '#B6BABD',
    'Kick Sauber': '#52E252',
    RB: '#6692FF',
    'Racing Bulls': '#6692FF',
    Cadillac: '#C8A217',
  }

  for (const [key, value] of Object.entries(colours)) {
    if (name?.includes(key) || key.includes(name ?? '')) return value
  }
  return '#666666'
}

function PosBadge({ pos }: { pos: number }) {
  const gold = pos === 1
  const silver = pos === 2
  const bronze = pos === 3
  const bg = gold ? '#FFD70022' : silver ? '#C0C0C022' : bronze ? '#CD7F3222' : 'transparent'
  const col = gold ? '#FFD700' : silver ? '#C0C0C0' : bronze ? '#CD7F32' : '#52525B'

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      borderRadius: '6px',
      background: bg,
      color: col,
      fontSize: '12px',
      fontFamily: 'monospace',
      fontWeight: 700,
      flexShrink: 0,
    }}>
      {pos}
    </span>
  )
}

function PtsBar({ pts, max, colour }: { pts: number; max: number; colour: string }) {
  const pct = max > 0 ? (pts / max) * 100 : 0
  return (
    <div style={{ flex: 1, height: '4px', background: '#1A1A1A', borderRadius: '2px', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: `${colour}AA`, borderRadius: '2px', transition: 'width 0.4s ease' }} />
    </div>
  )
}

function StandingsTableHeader({ title, subtitle, hrefLabel }: { title: string; subtitle: string; hrefLabel?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid rgba(152, 181, 211, 0.12)' }}>
      <div>
        <span style={{ fontWeight: 600, color: '#fff', fontSize: '18px', fontFamily: 'Rajdhani, sans-serif', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
        <span style={{ marginLeft: '10px', fontSize: '10px', fontFamily: 'monospace', color: '#5e7289' }}>{subtitle}</span>
      </div>
      {hrefLabel ? (
        <Link href="/sessions" style={{ color: '#f2c879', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  )
}

export default function ChampionshipStandings({
  drivers,
  constructors,
  currentYear,
  round,
}: {
  drivers: DriverStanding[]
  constructors: ConstructorStanding[]
  currentYear: number
  round: number
}) {
  const [showAllDrivers, setShowAllDrivers] = useState(false)
  const maxDriverPts = drivers[0]?.points ?? 1
  const maxConstructorPts = constructors[0]?.points ?? 1
  const visibleDrivers = useMemo(
    () => (showAllDrivers ? drivers : drivers.slice(0, 10)),
    [drivers, showAllDrivers],
  )

  return (
    <>
      {drivers.length > 0 && (
        <div className="panel" style={{ borderRadius: '28px', overflow: 'hidden' }}>
          <StandingsTableHeader
            title="Driver Championship"
            subtitle={`${currentYear} · ${round} race${round !== 1 ? 's' : ''}`}
            hrefLabel="All Sessions →"
          />

          <div className="driver-header" style={{ display: 'grid', gridTemplateColumns: '40px 28px 1fr 140px 60px 48px 48px', gap: '8px', padding: '8px 20px', fontSize: '9px', color: '#5e7289', fontFamily: 'monospace', letterSpacing: '0.1em', borderBottom: '1px solid rgba(152, 181, 211, 0.08)' }}>
            <span>POS</span><span></span><span>DRIVER</span><span className="driver-hide-mobile">TEAM</span><span className="driver-hide-mobile">PTS BAR</span><span style={{ textAlign: 'right' }}>PTS</span><span className="driver-hide-mobile driver-wins-col" style={{ textAlign: 'right' }}>W</span>
          </div>

          {visibleDrivers.map((driver) => {
            const colour = constructorColour(driver.team_name)
            return (
              <div key={`${driver.code}-${driver.position}`} className="driver-row" style={{ display: 'grid', gridTemplateColumns: '40px 28px 1fr 140px 60px 48px 48px', gap: '8px', padding: '12px 20px', borderBottom: '1px solid rgba(152, 181, 211, 0.08)', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#5e7289' }}>
                  {String(driver.position).padStart(2, '0')}
                </span>
                <PosBadge pos={driver.position} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{ width: '3px', height: '20px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {driver.full_name}
                    </div>
                    <div style={{ fontSize: '10px', color: '#5e7289', fontFamily: 'monospace' }}>{driver.code}</div>
                  </div>
                </div>
                <span className="driver-hide-mobile" style={{ fontSize: '12px', color: '#9fb2c6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{driver.team_name}</span>
                <span className="driver-hide-mobile"><PtsBar pts={driver.points} max={maxDriverPts} colour={colour} /></span>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontWeight: 700, textAlign: 'right' }}>{driver.points}</span>
                <span className="driver-hide-mobile driver-wins-col" style={{ fontFamily: 'monospace', fontSize: '12px', color: '#5e7289', textAlign: 'right' }}>{driver.wins}</span>
              </div>
            )
          })}

          {drivers.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAllDrivers(value => !value)}
              style={{
                width: '100%',
                padding: '14px 20px',
                fontSize: '11px',
                color: '#f2c879',
                fontFamily: 'monospace',
                textAlign: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {showAllDrivers ? 'Show top 10 only' : `+${drivers.length - 10} more drivers`}
            </button>
          )}
        </div>
      )}

      {constructors.length > 0 && (
        <div className="panel" style={{ borderRadius: '28px', overflow: 'hidden' }}>
          <StandingsTableHeader
            title="Constructor Championship"
            subtitle={`${currentYear} · teams`}
          />

          <div className="driver-header" style={{ display: 'grid', gridTemplateColumns: '40px 28px 1fr 140px 60px 48px 48px', gap: '8px', padding: '8px 20px', fontSize: '9px', color: '#5e7289', fontFamily: 'monospace', letterSpacing: '0.1em', borderBottom: '1px solid rgba(152, 181, 211, 0.08)' }}>
            <span>POS</span><span></span><span>TEAM</span><span className="driver-hide-mobile">NAME</span><span className="driver-hide-mobile">PTS BAR</span><span style={{ textAlign: 'right' }}>PTS</span><span className="driver-hide-mobile driver-wins-col" style={{ textAlign: 'right' }}>W</span>
          </div>

          {constructors.map((constructor) => {
            const colour = constructorColour(constructor.team_name)
            return (
              <div key={`${constructor.team_name}-${constructor.position}`} className="driver-row" style={{ display: 'grid', gridTemplateColumns: '40px 28px 1fr 140px 60px 48px 48px', gap: '8px', padding: '12px 20px', borderBottom: '1px solid rgba(152, 181, 211, 0.08)', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#5e7289' }}>
                  {String(constructor.position).padStart(2, '0')}
                </span>
                <PosBadge pos={constructor.position} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{ width: '3px', height: '20px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {constructor.team_name}
                    </div>
                    <div style={{ fontSize: '10px', color: '#5e7289', fontFamily: 'monospace' }}>
                      {constructor.team_name.split(' ')[0]}
                    </div>
                  </div>
                </div>
                <span className="driver-hide-mobile" style={{ fontSize: '12px', color: '#9fb2c6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{constructor.team_name}</span>
                <span className="driver-hide-mobile"><PtsBar pts={constructor.points} max={maxConstructorPts} colour={colour} /></span>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#fff', fontWeight: 700, textAlign: 'right' }}>{constructor.points}</span>
                <span className="driver-hide-mobile driver-wins-col" style={{ fontFamily: 'monospace', fontSize: '12px', color: '#5e7289', textAlign: 'right' }}>{constructor.wins}</span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
