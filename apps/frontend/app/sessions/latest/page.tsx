import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

import { api } from '@/lib/api'
import { getLatestWeekendOverviewRoute } from '@/lib/session-weekends'

export const revalidate = 60

export default async function LatestWeekendPage() {
  const { getToken } = await auth()
  const token = (await getToken()) ?? undefined
  const sessions = await api.sessions.list(true, token).catch(() => [])
  const route = getLatestWeekendOverviewRoute(sessions)

  redirect(route ?? '/sessions')
}
