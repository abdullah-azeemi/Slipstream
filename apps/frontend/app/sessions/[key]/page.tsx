import { api } from '@/lib/api'
import { formatLapTime, formatGap, teamColour, sessionTypeLabel } from '@/lib/utils'
import TyreChip from '@/components/ui/TyreChip'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'

export const revalidate = 60

export default async function SessionPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: keyStr } = await params
  const key = parseInt(keyStr)

  const [session, fastestLaps] = await Promise.all([
    api.sessions.get(key).catch(() => null),
    api.laps.fastest(key).catch(() => []),
  ])

  if (!session) notFound()

  const pole = fastestLaps[0]

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">

      {/* Back */}
      <Link href="/sessions"
        className="flex items-center gap-1.5 text-zinc-500 text-sm hover:text-white transition-colors">
        <ArrowLeft size={14} /> Sessions
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] tracking-widest text-zinc-500 uppercase font-mono">
            {sessionTypeLabel(session.session_type)} Session
          </span>
          <span className="flex items-center gap-1.5 bg-green-500/10 text-green-400 text-[10px] px-2 py-0.5 rounded-full font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            DATA LOADED
          </span>
        </div>
        <h1 className="font-display font-bold text-3xl text-white">
          {session.year} {session.gp_name}
        </h1>
      </div>

      {/* Leaderboard */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2.5 text-[10px] tracking-widest text-zinc-600 uppercase border-b border-border">
          <span className="col-span-1">POS</span>
          <span className="col-span-6">DRIVER / TEAM</span>
          <span className="col-span-5 text-right">TIME / GAP</span>
        </div>

        {fastestLaps.map((lap, i) => {
          const colour  = teamColour(lap.team_colour)
          const isFirst = i === 0
          const gap     = isFirst ? null : lap.lap_time_ms - pole!.lap_time_ms

          return (
            <div
              key={lap.driver_number}
              className={`grid grid-cols-12 px-4 py-3.5 border-b border-border last:border-0 items-center transition-colors
                ${isFirst ? 'bg-surface2' : 'hover:bg-surface2'}`}
            >
              {/* Position + team colour bar */}
              <div className="col-span-1 flex items-center gap-2">
                <div className="w-0.5 h-8 rounded-full" style={{ background: colour }} />
                <span className="font-mono text-sm text-zinc-400">{i + 1}</span>
              </div>

              {/* Driver */}
              <div className="col-span-6">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">{lap.abbreviation}</span>
                  <TyreChip compound={lap.compound} />
                </div>
                <span className="text-zinc-500 text-xs">{lap.team_name}</span>
              </div>

              {/* Time */}
              <div className="col-span-5 text-right">
                <div className="font-mono text-sm text-white">{formatLapTime(lap.lap_time_ms)}</div>
                <div className={`font-mono text-xs ${isFirst ? 'text-green-400 font-semibold' : 'text-zinc-500'}`}>
                  {isFirst ? 'POLE' : formatGap(gap)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Compare CTA */}
      <div className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Compare Drivers</div>
          <div className="text-xs text-zinc-500 mt-0.5">Head-to-head sector analysis</div>
        </div>
        <Link
          href={`/compare?session=${key}`}
          className="bg-red text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-red/90 transition-colors"
        >
          Compare →
        </Link>
      </div>

      {/* Strategy CTA — race sessions only */}
      {session.session_type === 'R' && (
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Tyre Strategy</div>
            <div className="text-xs text-zinc-500 mt-0.5">Stint diagram · pit stop analysis</div>
          </div>
          <Link
            href={`/sessions/${session.session_key}/strategy`}
            className="bg-surface2 border border-border text-white text-sm font-semibold px-4 py-2 rounded-lg hover:border-zinc-500 transition-colors"
          >
            View →
          </Link>
        </div>
      )}

      {/* Telemetry CTA — links to deep dive */}
      <div className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Speed Traces</div>
          <div className="text-xs text-zinc-500 mt-0.5">Throttle · brake · DRS · mini sectors</div>
        </div>
        <Link
          href={`/sessions/${key}/telemetry`}
          className="bg-surface2 border border-border text-white text-sm font-semibold px-4 py-2 rounded-lg hover:border-zinc-500 transition-colors"
        >
          Analyse →
        </Link>
      </div>

    </div>
  )
}