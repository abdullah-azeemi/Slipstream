import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'

import { ArrowLeft, ArrowRight } from '@phosphor-icons/react/dist/ssr'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import CardSection from '@/components/race/CardSection'
import RacePacePanel from '@/components/race/RacePacePanel'
import type { ChartDriver, PitWindow } from '@/components/race/LapEvolutionChart'
import type { Session } from '@/types/f1'
import {
  findWeekendBySessionKey,
  getWeekendRoundForSeason,
  groupSessionsIntoWeekends,
  sortWeekendSessions,
} from '@/lib/session-weekends'
import { getSessionTelemetryRoute } from '@/lib/session-routing'
import {
  COMPOUND_COLOURS,
  formatGap,
  formatLapTime,
  getCircuitName,
  teamColour,
} from '@/lib/utils'

export const revalidate = 60

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const RACE_LIKE = ['R', 'S'] as const
const QUALI_LIKE = ['Q', 'SQ'] as const
const PALETTE = ['#0D9488', '#DC2626', '#1D4ED8', '#64748B']
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

type LocalSession = Session & {
  track_temp_c?: number | null
  air_temp_c?: number | null
  humidity_pct?: number | null
  rainfall?: boolean | null
  wind_speed_ms?: number | null
}

type RaceResult = {
  driver_number: number
  full_name: string
  abbreviation: string
  team_name: string
  team_colour: string
  total_laps: number
  finish_pos: number | null
  best_lap_ms: number | null
  gap_ms: number | null
  laps_down: number
  compound: string | null
}

type StintPace = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  stint: number
  compound: string
  start_lap: number
  end_lap: number
  clean_laps: number
  avg_ms: string
  best_ms: number
  deg_ms_per_lap: string
}

type FastestLapRow = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  lap_number: number
  lap_time_ms: number
  compound: string | null
  tyre_life_laps: number | null
  position_on_lap: number | null
}

type SectorLap = {
  lap_number: number
  lap_time_ms: number | null
  s1_ms: number | null
  s2_ms: number | null
  s3_ms: number | null
  compound: string | null
  stint: number | null
  position: number | null
}

type EvolutionDriver = {
  driver_number: number
  abbreviation: string
  team_name: string
  laps: SectorLap[]
}

type LapEvolutionResponse = {
  drivers: Record<string, EvolutionDriver>
}

type SessionRef = {
  effective: LocalSession | null
  source: 'current' | 'reference' | 'none'
}


async function fetchJson<T>(path: string, revalidateSeconds = 60, token?: string): Promise<T | null> {
  try {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    const response = await fetch(`${BASE}${path}`, { headers, next: { revalidate: revalidateSeconds } })
    if (!response.ok) return null
    return response.json() as Promise<T>
  } catch {
    return null
  }
}

function findByTypes(sessions: LocalSession[], types: readonly string[]): LocalSession | null {
  for (const t of types) {
    const match = sessions.find(s => s.session_type === t)
    if (match) return match
  }
  return null
}

function resolveRef(current: LocalSession[], prev: LocalSession[], types: readonly string[]): SessionRef {
  const cur = findByTypes(current, types)
  if (cur) return { effective: cur, source: 'current' }
  const ref = findByTypes(prev, types)
  return { effective: ref, source: ref ? 'reference' : 'none' }
}

function pointsForPosition(position: number): number {
  return POINTS[position - 1] ?? 0
}

function formatGapLike(result: RaceResult, index: number): string {
  if (index === 0) return 'Winner'
  if (result.laps_down > 0) return `+${result.laps_down} lap${result.laps_down === 1 ? '' : 's'}`
  if (result.gap_ms == null) return '—'
  return formatGap(result.gap_ms)
}

function theoreticalOptimum(laps: SectorLap[]): { ms: number | null; s1: number | null; s2: number | null; s3: number | null } {
  const valid = laps.filter(l => l.s1_ms != null && l.s2_ms != null && l.s3_ms != null)
  if (!valid.length) return { ms: null, s1: null, s2: null, s3: null }
  const s1Best = valid.reduce((a, b) => (a.s1_ms! < b.s1_ms! ? a : b))
  const s2Best = valid.reduce((a, b) => (a.s2_ms! < b.s2_ms! ? a : b))
  const s3Best = valid.reduce((a, b) => (a.s3_ms! < b.s3_ms! ? a : b))
  return { ms: s1Best.s1_ms! + s2Best.s2_ms! + s3Best.s3_ms!, s1: s1Best.lap_number, s2: s2Best.lap_number, s3: s3Best.lap_number }
}

function cleanEvolutionDrivers(evo: Record<string, EvolutionDriver>): EvolutionDriver[] {
  return Object.values(evo).map(d => {
    const perStint = new Map<string, number[]>()
    for (const lap of d.laps) {
      if (lap.lap_time_ms == null) continue
      const key = `${lap.stint ?? 0}`
      const arr = perStint.get(key) ?? []
      arr.push(lap.lap_time_ms)
      perStint.set(key, arr)
    }
    const cleaned = d.laps.map(lap => {
      if (lap.lap_time_ms == null) return lap
      const arr = perStint.get(`${lap.stint ?? 0}`)
      if (!arr || !arr.length) return lap
      const sorted = [...arr].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      if (lap.lap_time_ms > median * 1.2) return { ...lap, lap_time_ms: null }
      return lap
    })
    return { ...d, laps: cleaned }
  })
}

function buildPitWindows(drivers: ChartDriver[]): PitWindow[] {
  const ranges: Array<{ min: number; max: number }> = []
  for (const d of drivers) {
    for (let i = 1; i < d.laps.length; i += 1) {
      if (d.laps[i].stint !== d.laps[i - 1].stint) {
        ranges.push({ min: d.laps[i].lap_number - 1, max: d.laps[i].lap_number })
      }
    }
  }
  if (!ranges.length) return []
  ranges.sort((a, b) => a.min - b.min)
  const merged: Array<{ min: number; max: number }> = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.min <= last.max + 1) {
      last.max = Math.max(last.max, r.max)
    } else {
      merged.push({ ...r })
    }
  }
  return merged.slice(0, 3).map(r => ({ start: r.min, end: r.max, label: 'PIT' }))
}

function Empty({ message }: { message: string }) {
  return (
    <div className="empty">
      <p className="body-6">{message}</p>
    </div>
  )
}

function EnvCard({ session, round }: { session: LocalSession | null; round: number }) {
  const rows: Array<[string, string]> = [
    ['Track temperature', session?.track_temp_c != null ? `${session.track_temp_c}°C` : '—'],
    ['Air temperature', session?.air_temp_c != null ? `${session.air_temp_c}°C` : '—'],
    ['Humidity', session?.humidity_pct != null ? `${session.humidity_pct}%` : '—'],
    ['Surface', session?.rainfall != null ? (session.rainfall ? 'Wet' : 'Dry') : '—'],
    ['Wind', session?.wind_speed_ms != null ? `${session.wind_speed_ms} m/s` : '—'],
    ['Round', String(round).padStart(2, '0')],
  ]
  return (
    <section className="panel" aria-label="Session conditions">
      <p className="caption-1" style={{ justifyContent: 'space-between' }}>
        <span>Session conditions</span>
        <span className="tag">{session ? 'Classified' : 'Waiting for data'}</span>
      </p>
      <div className="metric-grid" style={{ marginTop: 'var(--sp-100)' }}>
        {rows.map(([label, value]) => (
          <div key={label} className="metric">
            <div className="v">{value}</div>
            <div className="l">{label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function PodiumCard({ position, result, index, winnerBest }: {
  position: 'P1' | 'P2' | 'P3'
  result?: RaceResult
  index: number
  winnerBest: number | null
}) {
  if (!result) {
    return (
      <div className="card" style={{ flex: 1, minWidth: 160 }}>
        <div className="caption-4 muted">{position}, {POINTS[index]} points</div>
        <div className="body-6 muted">Waiting for data</div>
      </div>
    )
  }
  const accent = teamColour(result.team_colour, result.team_name)
  const gap = index === 0 ? null : formatGapLike(result, index)
  return (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div className="caption-4 muted">{position}, {POINTS[index]} points</div>
      <div className="heading-5" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-100)' }}>
        <span style={{ width: 4, height: 24, borderRadius: 2, background: accent }} aria-hidden="true" />
        {result.abbreviation}
      </div>
      <div className="body-6">{result.team_name}</div>
      {gap != null && <div className="body-5" style={{ fontVariantNumeric: 'tabular-nums' }}>{gap}</div>}
      <div className="caption-4 muted" style={{ fontVariantNumeric: 'tabular-nums' }}>Best lap {formatLapTime(result.best_lap_ms ?? winnerBest)}</div>
    </div>
  )
}

function BenchmarkRow({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '12px 0', borderBottom: '1px solid var(--lp-border)' }}>
      <span className="body-5 muted">{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span className="title-3" style={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        <span className="caption-4 muted" style={{ display: 'block' }}>{caption}</span>
      </span>
    </div>
  )
}

type RaceTableRow = RaceResult & {
  displayGap: string
  tyreFlags: string[]
  points: number
}

function ClassificationTable({ rows }: { rows: RaceTableRow[] }) {
  return (
    <div className="viz-scroll">
      <table className="data-table" style={{ minWidth: 700 }}>
        <thead>
          <tr>
            {['Pos', 'Driver', 'Team', 'Laps', 'Gap', 'Best lap', 'Tyres', 'Points'].map(h => (
              <th key={h} style={{ textAlign: ['Laps', 'Gap', 'Best lap', 'Points'].includes(h) ? 'right' : 'left' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const accent = teamColour(r.team_colour, r.team_name)
            return (
              <tr key={r.driver_number}>
                <td><strong>{r.finish_pos ?? '—'}</strong></td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    <span style={{ width: 4, height: 16, borderRadius: 2, background: accent }} aria-hidden="true" />
                    {r.abbreviation}
                  </span>
                </td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{r.team_name}</td>
                <td style={{ textAlign: 'right' }}>{r.total_laps}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.displayGap}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{formatLapTime(r.best_lap_ms)}</td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    {r.tyreFlags.length ? r.tyreFlags.map(t => (
                      <span key={t} title={t} aria-label={t} style={{ width: 16, height: 16, borderRadius: 999, border: '1px solid var(--lp-border)', background: COMPOUND_COLOURS[t] ?? '#CBD5E1', display: 'inline-block' }} />
                    )) : <span className="muted">—</span>}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>{r.points || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default async function UnifiedRacePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const sessionKey = Number(key)
  const { getToken } = await auth()
  const token = (await getToken()) ?? undefined
  const [sessionsRes, results, stintPace, fastestLaps] = await Promise.all([
    fetchJson<LocalSession[]>('/api/v1/sessions', 60, token),
    fetchJson<RaceResult[]>(`/api/v1/sessions/${sessionKey}/race-results`, 120, token),
    fetchJson<StintPace[]>(`/api/v1/sessions/${sessionKey}/analysis/stint-pace`, 120),
    fetchJson<FastestLapRow[]>(`/api/v1/sessions/${sessionKey}/analysis/fastest-lap`, 120),
  ])

  const sessions = sessionsRes ?? []
  if (!sessions.length) notFound()

  const weekend = findWeekendBySessionKey(sessions, sessionKey)
  if (!weekend) notFound()

  const allWeekendSessions = sortWeekendSessions(weekend.sessions)
  if (!allWeekendSessions.length) notFound()

  const pastWeekend = groupSessionsIntoWeekends(sessions).find(
    w => w.year === weekend.year - 1 && w.gp_name === weekend.gp_name,
  )
  const referenceSessions = pastWeekend ? sortWeekendSessions(pastWeekend.sessions) : []

  const raceRef = resolveRef(allWeekendSessions, referenceSessions, RACE_LIKE)
  const qualiRef = resolveRef(allWeekendSessions, referenceSessions, QUALI_LIKE)
  const activeSession = allWeekendSessions.find(s => s.session_type === 'R') ?? allWeekendSessions[allWeekendSessions.length - 1]

  const raceKey = activeSession.session_key
  const raceResults = sessionKey === raceKey ? results : null
  const raceStints = sessionKey === raceKey ? stintPace : null
  const raceFastest = sessionKey === raceKey ? fastestLaps : null

  const round = getWeekendRoundForSeason(weekend, sessions)
  const circuitName = getCircuitName(weekend.gp_name)

  const evoWrap = raceFastest?.length
    ? await fetchJson<LapEvolutionResponse>(`/api/v1/sessions/${sessionKey}/analysis/lap-evolution`, 120)
    : null
  const evo = evoWrap?.drivers ?? null

  const qualiFastest = qualiRef.effective
    ? await fetchJson<FastestLapRow[]>(`/api/v1/sessions/${qualiRef.effective.session_key}/analysis/fastest-lap`, 120)
    : null

  const podiumResults = raceResults ? [...raceResults].sort((a, b) => (a.finish_pos ?? 99) - (b.finish_pos ?? 99)).slice(0, 3) : []
  const rankOrder = raceResults ? [...raceResults].sort((a, b) => (a.finish_pos ?? 99) - (b.finish_pos ?? 99)) : []
  const winnerBest = podiumResults[0]?.best_lap_ms ?? null
  const envSession = raceRef.effective ?? qualiRef.effective ?? activeSession

  const chart = evo ? cleanEvolutionDrivers(evo) : null
  const sortedChart = chart
    ? [...chart].sort((a, b) => {
        const aIdx = rankOrder.findIndex(r => r.driver_number === a.driver_number)
        const bIdx = rankOrder.findIndex(r => r.driver_number === b.driver_number)
        return (aIdx < 0 ? 99 : aIdx) - (bIdx < 0 ? 99 : bIdx)
      })
    : []
  const chartDrivers: ChartDriver[] = sortedChart.map(d => ({
    driver_number: d.driver_number,
    abbreviation: d.abbreviation,
    team_name: d.team_name,
    laps: d.laps.map(l => ({
      lap_number: l.lap_number,
      lap_time_ms: l.lap_time_ms,
      compound: l.compound,
      stint: l.stint,
      position: l.position,
    })),
  }))
  const chartColors = Object.fromEntries(chartDrivers.map((d, i) => [d.abbreviation, PALETTE[i % PALETTE.length]]))
  const maxLap = chart ? Math.max(...chart.slice(0, 4).flatMap(d => d.laps.map(l => l.lap_number)), 1) : 1
  const pitWindows = buildPitWindows(chartDrivers)

  const winnerLaps = chart?.find(c => c.driver_number === podiumResults[0]?.driver_number)?.laps ?? []
  const theo = theoreticalOptimum(winnerLaps)

  const tableRows: RaceTableRow[] = rankOrder.map(r => {
    const driverStints = (raceStints ?? []).filter(s => s.driver_number === r.driver_number).sort((a, b) => a.start_lap - b.start_lap)
    const tyreFlags = [...new Set(driverStints.map(s => s.compound).filter(Boolean))] as string[]
    return {
      ...r,
      displayGap: formatGapLike(r, rankOrder.indexOf(r)),
      points: pointsForPosition(r.finish_pos ?? 99),
      tyreFlags,
    }
  })

  return (
    <div className={`lp ${geist.className}`}>
      <div className="dash">
        <div className="wrap">
          <header className="dash-head">
            <Link href="/sessions" className="back body-5">
              <ArrowLeft size={16} weight="bold" aria-hidden="true" /> All sessions
            </Link>
            <p className="caption-1 muted" style={{ marginTop: 'var(--sp-200)' }}>
              Formula 1 {weekend.year}, round {String(round).padStart(2, '0')}
            </p>
            <h1 className="heading-3">{circuitName}</h1>
            <p className="body-3 muted" style={{ marginTop: 'var(--sp-100)', maxWidth: 620 }}>
              Race classification, benchmarks and lap analysis for the full race distance of {maxLap} laps.
            </p>
          </header>

          <EnvCard session={envSession} round={round} />

          <div className="dash-grid" style={{ marginTop: 'var(--sp-200)' }}>
            <CardSection eyebrowLabel="Podium" title="Podium" subtitle="Highest classified finishers and the championship points they earn.">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <PodiumCard position="P1" result={podiumResults[0]} index={0} winnerBest={winnerBest} />
                <PodiumCard position="P2" result={podiumResults[1]} index={1} winnerBest={winnerBest} />
                <PodiumCard position="P3" result={podiumResults[2]} index={2} winnerBest={winnerBest} />
              </div>
            </CardSection>

            <CardSection eyebrowLabel="Benchmarks" title="Benchmarks" subtitle="Best whole lap and sector performance in this weekend.">
              <BenchmarkRow label="Fastest lap" value={raceFastest?.[0] ? formatLapTime(raceFastest[0].lap_time_ms) : '—'} caption={raceFastest?.[0] ? `${raceFastest[0].abbreviation} ${raceFastest[0].compound ?? ''} on lap ${raceFastest[0].lap_number}` : 'Waiting for race data'} />
              <BenchmarkRow label="Theoretical best lap" value={theo.ms ? formatLapTime(theo.ms) : '—'} caption={theo.ms ? `S1 lap ${theo.s1}, S2 lap ${theo.s2}, S3 lap ${theo.s3}` : 'Waiting for sector data'} />
              <BenchmarkRow label="Pole position" value={qualiFastest?.[0] ? formatLapTime(qualiFastest[0].lap_time_ms) : '—'} caption={qualiFastest?.[0] ? `${qualiFastest[0].abbreviation} ${qualiFastest[0].compound ?? ''}`.trim() : 'Waiting for qualifying data'} />
              <BenchmarkRow label="Winner's best lap" value={winnerBest != null ? formatLapTime(winnerBest) : '—'} caption={raceResults?.[0]?.abbreviation ?? 'Waiting for race data'} />
            </CardSection>
          </div>

          <div style={{ marginTop: 'var(--sp-200)' }}>
            <RacePacePanel
              drivers={chartDrivers}
              colors={chartColors}
              pitWindows={pitWindows}
              maxLap={maxLap === 1 ? 78 : maxLap}
              stints={raceStints ?? []}
              results={rankOrder}
              sessions={allWeekendSessions}
              currentKey={raceKey}
            />
          </div>

          <div style={{ marginTop: 'var(--sp-200)' }}>
            <CardSection
              eyebrowLabel="Classification"
              title="Full race classification"
              subtitle="Official classified order with laps completed, gap to the leader, fastest lap and tyres used."
            >
              {tableRows.length ? <ClassificationTable rows={tableRows} /> : <Empty message="Race results have not been classified yet." />}
            </CardSection>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 'var(--sp-500)' }}>
            <p className="body-6 muted">Data refreshes every minute. Classification may change after the race.</p>
            <Link href={getSessionTelemetryRoute(raceKey)} prefetch={false} className="btn btn-primary button-md">
              Open telemetry <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
