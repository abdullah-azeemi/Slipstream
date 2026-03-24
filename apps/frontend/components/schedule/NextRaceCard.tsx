'use client'

import React, { useState, useEffect } from 'react'

export interface Session {
  date_utc: string
  name: string
}

export interface NextRaceData {
  next_session: Session
  race: {
    circuit: string
    country: string
    event_date: string
    event_name: string
    flag: string
    round: number
    sessions: Session[]
  }
}

function formatDateToDayTime(isoString: string) {
  const date = new Date(isoString)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayName = days[date.getUTCDay()]
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${dayName} ${hours}:${minutes}`
}

function formatDateToDayMonthYear(dateString: string) {
  const date = new Date(dateString)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = months[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  return `${day} ${month} ${year}`
}

function formatDateForNextLabel(isoString: string) {
  const date = new Date(isoString)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = months[date.getUTCMonth()]
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month}, ${hours}:${minutes} UTC`
}

function parseSessionName(name: string) {
  if (name.includes('Practice 1')) return 'FP1'
  if (name.includes('Practice 2')) return 'FP2'
  if (name.includes('Practice 3')) return 'FP3'
  if (name.includes('Qualifying')) return 'Q'
  if (name.includes('Sprint Shootout')) return 'SS'
  if (name.includes('Sprint') && !name.includes('Shootout')) return 'Sprint'
  if (name.includes('Race')) return 'Race'
  return name.substring(0, 3).toUpperCase()
}

function getSessionStyles(name: string) {
  const parsed = parseSessionName(name)
  if (parsed.startsWith('FP')) {
    return { color: '#6692FF', border: '1px solid #6692FF44' } // blue
  }
  if (parsed.includes('Q') || parsed.includes('Sprint')) {
    return { color: '#FCD34D', border: '1px solid #FCD34D44' } // yellow
  }
  if (parsed === 'Race') {
    return { color: '#F87171', border: '1px solid #F8717144' } // red
  }
  return { color: '#A1A1AA', border: '1px solid #3F3F46' } // grey
}

export default function NextRaceCard({ data }: { data: NextRaceData }) {
  const [timeLeft, setTimeLeft] = useState({
    days: '00', hours: '00', mins: '00', secs: '00'
  })

  useEffect(() => {
    if (!data?.next_session?.date_utc) return

    const targetDate = new Date(data.next_session.date_utc).getTime()

    const updateTimer = () => {
      const now = new Date().getTime()
      const diff = targetDate - now

      if (diff <= 0) {
        setTimeLeft({ days: '00', hours: '00', mins: '00', secs: '00' })
        return
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24))
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const s = Math.floor((diff % (1000 * 60)) / 1000)

      setTimeLeft({
        days: String(d).padStart(2, '0'),
        hours: String(h).padStart(2, '0'),
        mins: String(m).padStart(2, '0'),
        secs: String(s).padStart(2, '0')
      })
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [data])

  if (!data || !data.race) return null

  const { race, next_session } = data

  return (
    <div style={{
      background: '#1D1D20', // Dark subtle shade like F1 website
      borderRadius: '8px',
      overflow: 'hidden',
      position: 'relative',
      borderRight: '1px solid #2A2A2E',
      borderTop: '1px solid #2A2A2E',
      borderBottom: '1px solid #2A2A2E',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
    }}>
      {/* Thick red left border like F1 */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: '6px', background: '#E80020'
      }} />

      <div style={{ padding: '24px 24px 24px 30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* Top Section: Title & Timer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#A1A1AA', letterSpacing: '0.05em', fontFamily: 'monospace' }}>
              NEXT UP — ROUND {race.round}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {race.flag && <span style={{ fontSize: '28px', lineHeight: 1 }}>{race.flag}</span>}
              <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#FFFFFF', margin: 0, letterSpacing: '0.02em', fontFamily: 'Rajdhani, sans-serif', textTransform: 'uppercase' }}>
                {race.event_name}
              </h2>
            </div>
            <span style={{ fontSize: '15px', color: '#D4D4D8' }}>
              {race.circuit} &middot; {formatDateToDayMonthYear(race.event_date)}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { label: 'DAYS', value: timeLeft.days },
              { label: 'HRS', value: timeLeft.hours },
              { label: 'MIN', value: timeLeft.mins },
              { label: 'SEC', value: timeLeft.secs, isRed: true }
            ].map((unit, idx) => (
              <div key={idx} style={{
                background: '#151518',
                borderRadius: '8px',
                padding: '12px',
                minWidth: '64px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #2A2A2D'
              }}>
                <span style={{ 
                  fontSize: '28px', 
                  fontWeight: 800, 
                  fontFamily: 'Rajdhani, sans-serif', 
                  color: unit.isRed ? '#E80020' : '#FFFFFF',
                  lineHeight: 1
                }}>
                  {unit.value}
                </span>
                <span style={{ 
                  fontSize: '10px', 
                  fontWeight: 600, 
                  color: '#A1A1AA', 
                  marginTop: '4px',
                  letterSpacing: '0.05em' 
                }}>
                  {unit.label}
                </span>
              </div>
            ))}
          </div>

        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: '#2A2A2E', margin: '8px 0' }} />

        {/* Sessions Section */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#A1A1AA', letterSpacing: '0.05em' }}>
            SESSIONS:
          </span>
          {race.sessions.map((session, idx) => {
            const parsedName = parseSessionName(session.name)
            const formattedTime = formatDateToDayTime(session.date_utc)
            const style = getSessionStyles(session.name)
            
            return (
              <div key={idx} style={{
                padding: '4px 12px',
                borderRadius: '16px',
                fontSize: '13px',
                fontFamily: 'monospace',
                background: '#151518',
                ...style
              }}>
                {parsedName} &middot; {formattedTime}
              </div>
            )
          })}
        </div>

        {/* Next Session indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <span style={{ color: '#2DD4BF', fontSize: '18px', lineHeight: 1 }}>&bull;</span>
          <span style={{ color: '#2DD4BF', fontSize: '14px', fontWeight: 500 }}>
            NEXT: {next_session.name} — {formatDateForNextLabel(next_session.date_utc)}
          </span>
        </div>

      </div>
    </div>
  )
}
