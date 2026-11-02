'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

function parts(diff: number) {
  const s = Math.floor(diff / 1000)
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
  }
}

export default function SessionCountdown({ target }: { target: string }) {
  const router = useRouter()
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const t = new Date(target).getTime()

  // The API keeps a session as "next" until two hours after it starts, then returns the
  // following one. Ask the server for fresh data just after that window closes.
  useEffect(() => {
    if (Number.isNaN(t)) return
    const wait = t + 2 * 3600 * 1000 + 45000 - Date.now()
    if (wait <= 0) return
    const id = window.setTimeout(() => router.refresh(), Math.min(wait, 2 ** 31 - 1))
    return () => window.clearTimeout(id)
  }, [t, router])
  if (Number.isNaN(t)) return <p className="body-6 muted">Start time to be confirmed.</p>

  if (now === null) {
    return (
      <div className="countdown" aria-busy="true">
        {[0, 1, 2, 3].map(i => <span key={i} className="skeleton" style={{ height: 72 }} />)}
      </div>
    )
  }

  const diff = t - now
  if (diff <= 0) {
    return (
      <p className="live-pill title-3">
        <span className="live-dot" aria-hidden="true" />
        {diff > -2 * 3600 * 1000 ? 'Session is on track now' : 'Session has started'}
      </p>
    )
  }

  const p = parts(diff)
  const units: [string, number][] = [['Days', p.days], ['Hours', p.hours], ['Minutes', p.mins], ['Seconds', p.secs]]
  return (
    <>
      <div className="countdown" role="timer" aria-label="Time until the next session">
        {units.map(([label, v]) => (
          <div key={label} className="unit">
            <span className="num">{String(v).padStart(2, '0')}</span>
            <span className="caption-4 muted">{label}</span>
          </div>
        ))}
      </div>
      <p className="caption-4 muted" style={{ marginTop: 'var(--sp-100)' }}>
        {new Date(t).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
      </p>
    </>
  )
}
