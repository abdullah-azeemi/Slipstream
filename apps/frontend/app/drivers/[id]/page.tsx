import DriverProfile from '@/components/driver/DriverProfile'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

async function fetchDriverProfile(driverNumber: number) {
  const currentYear = new Date().getFullYear()
  try {
    const res = await fetch(`${BASE}/api/v1/drivers/${driverNumber}/profile?year=${currentYear}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function fetchDriverImages() {
  try {
    const data = await fetch('https://api.openf1.org/v1/drivers?session_key=latest', {
      next: { revalidate: 3600 },
    }).then(r => r.json())
    if (!Array.isArray(data)) return {}
    const map: Record<number, { headshot_url: string; team_name: string | null; team_colour: string | null }> = {}
    data.forEach((d: { driver_number: number; headshot_url: string; team_name: string | null; team_colour: string | null }) => {
      if (d.driver_number) {
        map[d.driver_number] = {
          headshot_url: d.headshot_url ?? null,
          team_name: d.team_name ?? null,
          team_colour: d.team_colour ?? null,
        }
      }
    })
    return map
  } catch {
    return {}
  }
}

export default async function DriverPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const driverNumber = parseInt(id, 10)

  if (isNaN(driverNumber)) {
    return (
      <div className="layout-wrapper">
        <p style={{ color: 'var(--text-3)' }}>Invalid driver number.</p>
      </div>
    )
  }

  const [profile, latestDrivers] = await Promise.all([
    fetchDriverProfile(driverNumber),
    fetchDriverImages(),
  ])

  if (!profile?.driver) {
    return (
      <div className="layout-wrapper">
        <p style={{ color: 'var(--text-3)' }}>Driver not found.</p>
      </div>
    )
  }

  // Override team info with latest OpenF1 data if available
  const latestInfo = latestDrivers[driverNumber]
  if (latestInfo) {
    if (latestInfo.team_name) profile.driver.team_name = latestInfo.team_name
    if (latestInfo.team_colour) profile.driver.team_colour = latestInfo.team_colour
  }

  return (
    <DriverProfile
      profile={profile}
      headshotUrl={latestInfo?.headshot_url ?? null}
    />
  )
}
