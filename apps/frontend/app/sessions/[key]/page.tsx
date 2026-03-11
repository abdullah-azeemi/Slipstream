import { api } from '@/lib/api'
import { formatLapTime, formatGap, teamColour, sessionTypeLabel } from '@/lib/utils'
import TyreChip from '@/components/ui/TyreChip'
import Link from 'next/link'
import { ArrowLeft, Database } from 'lucide-react'
import { notFound } from 'next/navigation'

export const revalidate = 60

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

async function getRaceResults(key: number) {
  const res = await fetch(`${BASE}/api/v1/sessions/${key}/race-results`, {
    next: { revalidate: 60 }
  })
  if (!res.ok) return []
  return res.json()
}

export default async function SessionPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: keyStr } = await params
  const key = parseInt(keyStr)

  const session = await api.sessions.get(key).catch(() => null)
  if (!session) notFound()

  const isRace = session.session_type === 'R' || session.session_type === 'S'

  // Use different data source depending on session type
  const [fastestData, raceData] = await Promise.all([
    isRace ? Promise.resolve({ laps: [] }) : api.laps.fastest(key).catch(() => ({ laps: [] })),
    isRace ? getRaceResults(key).catch(() => []) : Promise.resolve([]),
  ])

  const qualifyingLaps = fastestData.laps ?? []
  const hasData = isRace ? raceData.length > 0 : qualifyingLaps.length > 0

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">

      <Link href="/sessions"
        className="flex items-center gap-1.5 text-zinc-500 text-sm hover:text-white transition-colors">
        <ArrowLeft size={14} /> Sessions
      </Link>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] tracking-widest text-zinc-500 uppercase font-mono">
            {sessionTypeLabel(session.session_type)} Session
          </span>
          <span className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-medium ${
            hasData ? 'bg-green-500/10 text-green-400' : 'bg-zinc-700/30 text-zinc-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${hasData ? 'bg-green-400' : 'bg-zinc-600'}`} />
            {hasData ? 'DATA LOADED' : 'NO DATA'}
          </span>
        </div>
        <h1 className="font-display font-bold text-3xl text-white">
          {session.year} {session.gp_name}
        </h1>
      </div>

      {!hasData ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <Database size={32} className="text-zinc-700 mx-auto mb-3" />
          <div className="text-white font-semibold mb-1">No data ingested yet</div>
          <div className="text-zinc-500 text-sm mb-4">
            Run the ingestion script to load lap data for this session.
          </div>
          <code className="bg-surface2 border border-border text-zinc-300 text-xs px-3 py-2 rounded-lg font-mono block max-w-sm mx-auto text-left">
            uv run python -m ingestion.ingest_session \<br/>
            &nbsp;&nbsp;--year {session.year} \<br/>
            &nbsp;&nbsp;--gp &quot;{session.gp_name.replace(' Grand Prix', '')}&quot; \<br/>
            &nbsp;&nbsp;--session {session.session_type}
          </code>
        </div>
      ) : isRace ? (
        /* ── Race leaderboard ───────────────────────────────────────── */
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2.5 text-[10px] tracking-widest text-zinc-600 uppercase border-b border-border">
            <span className="col-span-1">POS</span>
            <span className="col-span-6">DRIVER / TEAM</span>
            <span className="col-span-5 text-right">LAPS / GAP</span>
          </div>

          {raceData.map((driver: any, i: number) => {
            const colour = teamColour(driver.team_colour)
            const isWinner = i === 0
            const lapsDown = driver.laps_down

            return (
              <div key={driver.driver_number}
                className={`grid grid-cols-12 px-4 py-3.5 border-b border-border last:border-0 items-center transition-colors
                  ${isWinner ? 'bg-surface2' : 'hover:bg-surface2'}`}>
                <div className="col-span-1 flex items-center gap-2">
                  <div className="w-0.5 h-8 rounded-full" style={{ background: colour }} />
                  <span className="font-mono text-sm text-zinc-400">{i + 1}</span>
                </div>
                <div className="col-span-6">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">{driver.abbreviation}</span>
                    <TyreChip compound={driver.compound} />
                  </div>
                  <span className="text-zinc-500 text-xs">{driver.team_name}</span>
                </div>
                <div className="col-span-5 text-right">
                  <div className="font-mono text-sm text-zinc-400">
                    {driver.total_laps} laps
                  </div>
                  <div className={`font-mono text-xs ${isWinner ? 'text-green-400 font-semibold' : 'text-zinc-500'}`}>
                    {isWinner
                      ? 'WINNER'
                      : lapsDown
                      ? `+${lapsDown} lap${lapsDown > 1 ? 's' : ''}`
                      : driver.gap_ms
                      ? formatGap(driver.gap_ms)
                      : '—'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ── Qualifying leaderboard ─────────────────────────────────── */
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2.5 text-[10px] tracking-widest text-zinc-600 uppercase border-b border-border">
            <span className="col-span-1">POS</span>
            <span className="col-span-6">DRIVER / TEAM</span>
            <span className="col-span-5 text-right">TIME / GAP</span>
          </div>

          {qualifyingLaps.map((lap: any, i: number) => {
            const colour = teamColour(lap.team_colour)
            const isFirst = i === 0
            const gap = isFirst ? null : lap.lap_time_ms - qualifyingLaps[0].lap_time_ms
            return (
              <div key={lap.driver_number}
                className={`grid grid-cols-12 px-4 py-3.5 border-b border-border last:border-0 items-center transition-colors
                  ${isFirst ? 'bg-surface2' : 'hover:bg-surface2'}`}>
                <div className="col-span-1 flex items-center gap-2">
                  <div className="w-0.5 h-8 rounded-full" style={{ background: colour }} />
                  <span className="font-mono text-sm text-zinc-400">{i + 1}</span>
                </div>
                <div className="col-span-6">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm">{lap.abbreviation}</span>
                    <TyreChip compound={lap.compound} />
                  </div>
                  <span className="text-zinc-500 text-xs">{lap.team_name}</span>
                </div>
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
      )}

      {/* Speed Traces — only when data exists */}
      {hasData && (
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Speed Traces</div>
            <div className="text-xs text-zinc-500 mt-0.5">Throttle · brake · DRS · mini sectors</div>
          </div>
          <Link href={`/sessions/${key}/telemetry`}
            className="bg-surface2 border border-border text-white text-sm font-semibold px-4 py-2 rounded-lg hover:border-zinc-500 transition-colors">
            Analyse →
          </Link>
        </div>
      )}

      {/* Tyre Strategy — race sessions with data only */}
      {isRace && hasData && (
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Tyre Strategy</div>
            <div className="text-xs text-zinc-500 mt-0.5">Stint diagram · pit stop analysis</div>
          </div>
          <Link href={`/sessions/${key}/strategy`}
            className="bg-surface2 border border-border text-white text-sm font-semibold px-4 py-2 rounded-lg hover:border-zinc-500 transition-colors">
            View →
          </Link>
        </div>
      )}

    </div>
  )
}
