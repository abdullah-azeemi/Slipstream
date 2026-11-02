import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import TelemetryLandingClient from '@/components/telemetry/TelemetryLandingClient'
import { api } from '@/lib/api'
import type { Session } from '@/types/f1'

export const metadata: Metadata = { title: 'Telemetry | Slipstream' }
export const revalidate = 300

export default async function TelemetryLandingPage() {
  const { getToken } = await auth()
  const token = (await getToken()) ?? undefined
  let sessions: Session[] = []
  let failed = false
  try {
    sessions = await api.sessions.list(true, token)
  } catch {
    failed = true
  }
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.date_start ?? 0).getTime() - new Date(a.date_start ?? 0).getTime(),
  )
  return <TelemetryLandingClient initialSessions={sorted} failed={failed} />
}
