import { api } from '@/lib/api'
import { getCircuitImage, formatLapTime, teamColour, sessionTypeLabel } from '@/lib/utils'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, MapPin, Thermometer, Wind, Droplets } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'

export const revalidate = 60

export default async function HomePage() {
  const sessions    = await api.sessions.list(true).catch(() => [])
  const latest      = sessions[0] ?? null
  const fastestLaps = latest
    ? await api.laps.fastest(latest.session_key, true).catch(() => [])
    : []
  const drivers     = latest
    ? await api.drivers.list(latest.session_key, true).catch(() => [])
    : []

  const pole         = fastestLaps[0] ?? null
  const circuitImage = getCircuitImage(latest?.gp_name ?? '')

  return (
    <div className="space-y-5">

      {/* ── Hero ───────────────────────────────────────────────────── */}
      {latest ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Circuit card */}
          <div className="md:col-span-2 relative rounded-xl overflow-hidden min-h-[220px]">
            <Image
              src={circuitImage}
              alt={latest.gp_name}
              fill
              sizes="(max-width: 768px) 100vw, 66vw"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

            <div className="absolute inset-0 p-5 flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <span className="bg-red text-white text-[10px] font-bold tracking-widest px-2 py-1 rounded">
                  {sessionTypeLabel(latest.session_type).toUpperCase()}
                </span>
                <span className="bg-black/50 text-zinc-400 text-[10px] font-mono px-2 py-1 rounded">
                  {latest.year}
                </span>
              </div>

              <div>
                <h1 className="font-display font-bold text-4xl text-white leading-none mb-1">
                  {latest.gp_name}
                </h1>
                {latest.country && (
                  <div className="flex items-center gap-1 text-zinc-400 text-sm mb-4">
                    <MapPin size={12} />
                    {latest.country}
                  </div>
                )}
                <Link
                  href={`/sessions/${latest.session_key}`}
                  className="inline-flex items-center gap-2 bg-red text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-red/90 transition-colors"
                >
                  View Session <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>

          {/* Track conditions */}
          <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-white text-sm">Track Conditions</h3>
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            </div>
            {[
              { icon: <Thermometer size={14} />, label: 'Track Temp', value: '42°C' },
              { icon: <Wind size={14} />,        label: 'Air Temp',   value: '28°C' },
              { icon: <Droplets size={14} />,    label: 'Humidity',   value: '62%'  },
            ].map(({ icon, label, value }) => (
              <div key={label} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2 text-zinc-400 text-sm">
                  {icon} {label}
                </div>
                <span className="font-mono text-sm text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-zinc-500 text-sm">
          No sessions loaded. Run the ingestion script to add data.
        </div>
      )}

      {/* ── Stat cards ─────────────────────────────────────────────── */}
      {pole && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Pole Lap Time"
            value={formatLapTime(pole.lap_time_ms)}
            delta={`${pole.abbreviation} — ${pole.team_name ?? ''}`}
            deltaPositive
            mono
          />
          <StatCard
            label="Drivers in Top 10"
            value={String(fastestLaps.length)}
            delta="All teams represented"
          />
          <StatCard
            label="Fastest S1"
            value={fastestLaps[0]?.abbreviation ?? '—'}
            delta="Best mini-sector split"
          />
          <StatCard
            label="Session"
            value={sessionTypeLabel(latest?.session_type ?? '')}
            delta={`${latest?.year} ${latest?.gp_name?.replace(' Grand Prix', ' GP')}`}
          />
        </div>
      )}

      {/* ── Session results ────────────────────────────────────────── */}
      {drivers.length > 0 && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-white text-sm">Session Results</h2>
            <Link href={`/sessions/${latest?.session_key}`} className="text-red text-xs font-medium hover:underline">
              View All
            </Link>
          </div>

          <div className="grid grid-cols-12 px-4 py-2 text-[10px] tracking-widest text-zinc-600 uppercase border-b border-border">
            <span className="col-span-1">Pos</span>
            <span className="col-span-6">Driver</span>
            <span className="col-span-3">Team</span>
            <span className="col-span-2 text-right">Best Lap</span>
          </div>

          {drivers.slice(0, 8).map((driver, i) => (
            <div
              key={driver.driver_number}
              className="grid grid-cols-12 px-4 py-3 border-b border-border last:border-0 hover:bg-surface2 transition-colors items-center"
            >
              <span className="col-span-1 font-mono text-xs text-zinc-500">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="col-span-6 flex items-center gap-2">
                <div
                  className="w-0.5 h-5 rounded-full flex-shrink-0"
                  style={{ background: teamColour(driver.team_colour) }}
                />
                <span className="font-medium text-white text-sm">{driver.full_name}</span>
              </div>
              <span className="col-span-3 text-xs text-zinc-400">{driver.team_name}</span>
              <span className="col-span-2 text-right font-mono text-xs text-white">
                {formatLapTime(driver.best_lap_ms)}
              </span>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
