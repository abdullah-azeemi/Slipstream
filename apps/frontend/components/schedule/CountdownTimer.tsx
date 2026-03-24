'use client'

import React, { useState, useEffect } from 'react'

interface CountdownTimerProps {
  targetDate: string
  sessionName?: string
}

export default function CountdownTimer({ targetDate, sessionName }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState({
    days: '00', hours: '00', mins: '00', secs: '00'
  })
  const [isLive, setIsLive] = useState(false)

  useEffect(() => {
    if (!targetDate) return

    const updateTimer = () => {
      const targetTime = new Date(targetDate).getTime()
      const now = new Date().getTime()

      // Explicit conversion for clarity although JS handles it:
      // (Target UTC time - Current local time converted to UTC)
      const diff = targetTime - now

      if (diff <= 0) {
        // If it's within the window (e.g., sessions are roughly 2 hours)
        if (Math.abs(diff) < 2 * 60 * 60 * 1000) {
          setIsLive(true)
        } else {
          setIsLive(false)
        }
        setTimeLeft({ days: '00', hours: '00', mins: '00', secs: '00' })
        return
      }

      setIsLive(false)
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
  }, [targetDate])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
      {sessionName && (
        <span style={{ fontSize: '11px', color: '#A1A1AA', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '2px', fontFamily: 'monospace' }}>
          {isLive ? 'LIVE NOW — ' : 'NEXT — '}{sessionName.toUpperCase()} {isLive && '•'}
        </span>
      )}

      {isLive ? (
        <div style={{
          background: '#E8002D',
          color: '#fff',
          fontSize: '14px',
          fontWeight: 800,
          padding: '6px 14px',
          borderRadius: '8px',
          fontFamily: 'Rajdhani, sans-serif',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          letterSpacing: '0.05em',
          boxShadow: '0 0 15px rgba(232,0,45,0.4)'
        }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff' }} />
          SESSION LIVE
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { label: 'DAYS', value: timeLeft.days },
            { label: 'HRS', value: timeLeft.hours },
            { label: 'MIN', value: timeLeft.mins },
            { label: 'SEC', value: timeLeft.secs, isRed: true }
          ].map((unit, idx) => (
            <div key={idx} style={{
              background: 'rgba(21, 21, 24, 0.8)',
              backdropFilter: 'blur(4px)',
              borderRadius: '8px',
              padding: '8px 10px',
              minWidth: '54px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <span style={{
                fontSize: '18px',
                fontWeight: 800,
                fontFamily: 'Rajdhani, sans-serif',
                color: unit.isRed ? '#E80020' : '#FFFFFF',
                lineHeight: 1
              }}>
                {unit.value}
              </span>
              <span style={{
                fontSize: '8px',
                fontWeight: 600,
                color: '#A1A1AA',
                marginTop: '2px',
                letterSpacing: '0.05em'
              }}>
                {unit.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
