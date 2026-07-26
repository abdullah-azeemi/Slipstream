import DriverProfile from '@/components/driver/DriverProfile'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

async function fetchDriverProfile(driverNumber: number) {
  try {
    const res = await fetch(`${BASE}/api/v1/drivers/${driverNumber}/profile?year=2024`, {
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
    const map: Record<number, string> = {}
    data.forEach((d: { driver_number: number; headshot_url: string }) => {
      if (d.driver_number && d.headshot_url) map[d.driver_number] = d.headshot_url
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

  const [profile, images] = await Promise.all([
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

  return (
    <DriverProfile
      profile={profile}
      headshotUrl={images[driverNumber] ?? null}
    />
  )
}
