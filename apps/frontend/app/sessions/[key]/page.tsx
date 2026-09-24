import Link from 'next/link'
import { notFound } from 'next/navigation'

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
const SERIF = "'Playfair Display', Georgia, serif"
const MONO = 'JetBrains Mono, monospace'
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

const eyebrow = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#9CA3AF',
} as const

async function fetchJson<T>(path: string, revalidateSeconds = 60): Promise<T | null> {
  try {
    const response = await fetch(`${BASE}${path}`, { next: { revalidate: revalidateSeconds } })
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
    <div style={{ border: '1px dashed #D1D5DB', borderRadius: 16, padding: '28px 20px', textAlign: 'center', color: '#6B7280', fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.6 }}>
      {message}
    </div>
  )
}

function EnvCard({ session, round }: { session: LocalSession | null; round: number }) {
  const rows: Array<[string, string]> = [
    ['Track Temp', session?.track_temp_c != null ? `${session.track_temp_c}°C` : '—'],
    ['Air Temp', session?.air_temp_c != null ? `${session.air_temp_c}°C` : '—'],
    ['Humidity', session?.humidity_pct != null ? `${session.humidity_pct}%` : '—'],
    ['Surface', session?.rainfall != null ? (session.rainfall ? 'WET' : 'DRY') : '—'],
    ['Wind', session?.wind_speed_ms != null ? `${session.wind_speed_ms} m/s` : '—'],
    ['Round', String(round).padStart(2, '0')],
  ]
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 20, padding: 18, minWidth: 300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ ...eyebrow }}>Session Environment</div>
        <span style={{
          padding: '4px 10px', borderRadius: 999, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', background: session ? 'rgba(13,148,136,0.1)' : 'rgba(148,163,184,0.12)',
          color: session ? '#0F766E' : '#64748B', fontFamily: MONO,
        }}>
          {session ? 'Official Classified' : 'Pending Ingest'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ padding: '10px 12px', borderRadius: 12, background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', fontFamily: MONO }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
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
      <div style={{ border: '1px dashed #D1D5DB', borderRadius: 16, padding: 14, flex: 1, minWidth: 140 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#9CA3AF', fontFamily: MONO }}>{position} — {POINTS[index]} PTS</div>
        <div style={{ marginTop: 10, fontSize: 12, color: '#9CA3AF' }}>Awaiting data</div>
      </div>
    )
  }
  const isFirst = index === 0
  const accent = teamColour(result.team_colour, result.team_name)
  const gap = index === 0 ? null : formatGapLike(result, index)
  return (
    <div style={{
      border: `1px solid ${isFirst ? '#0D9488' : '#E5E7EB'}`,
      borderRadius: 16, padding: 14, flex: 1, minWidth: 140,
      background: isFirst ? 'linear-gradient(180deg, rgba(13,148,136,0.05), rgba(255,255,255,0))' : '#FFFFFF',
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: isFirst ? '#0F766E' : '#111827', fontFamily: MONO }}>
        {position} — {POINTS[index]} PTS
      </div>
      <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter, sans-serif', fontWeight: 600, marginTop: 12 }}>{result.team_name}</div>
      <div style={{ margin: '3px 0 8px', fontSize: 19, fontWeight: 600, color: '#111827', fontFamily: SERIF }}>{result.abbreviation}</div>
      {gap != null && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: accent, fontFamily: MONO }}>{gap}</div>
      )}
      <div style={{ marginTop: 10, fontSize: 10, color: '#9CA3AF', fontFamily: MONO }}>
        Best Lap: {formatLapTime(result.best_lap_ms ?? winnerBest)}
      </div>
    </div>
  )
}

function BenchmarkRow({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '11px 0', borderBottom: '1px solid #F3F4F6' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', fontFamily: 'Inter, sans-serif' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: '#111827', fontFamily: MONO, display: 'block' }}>{value}</span>
        <span style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'Inter, sans-serif', marginTop: 2, display: 'block' }}>{caption}</span>
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
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
            {['POS', 'Driver', 'Team', 'Laps', 'Gap', 'Best Lap', 'Tyres', 'Pts'].map(h => (
              <th
                key={h}
                style={{
                  textAlign: h === 'POS' ? 'center' : h === 'Driver' ? 'left' : 'right',
                  padding: '10px 10px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: '#9CA3AF', fontFamily: MONO, whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const accent = teamColour(r.team_colour, r.team_name)
            return (
              <tr key={r.driver_number} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '12px 10px', textAlign: 'center', fontFamily: MONO, fontSize: 12, fontWeight: 800, color: i === 0 ? '#0F766E' : '#111827' }}>
                  {r.finish_pos ?? '—'}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'left' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700, color: '#111827' }}>
                    <span style={{ width: 3, height: 22, borderRadius: 999, background: accent, display: 'inline-block' }} />
                    {r.abbreviation}
                  </span>
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: '#6B7280', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {r.team_name}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontFamily: MONO, fontSize: 12, color: '#111827', fontWeight: 700 }}>
                  {r.total_laps}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontFamily: MONO, fontSize: 12, color: '#111827', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {r.displayGap}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontFamily: MONO, fontSize: 12, color: '#111827', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {formatLapTime(r.best_lap_ms)}
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    {r.tyreFlags.length ? r.tyreFlags.map(t => (
                      <span
                        key={t}
                        title={t}
                        style={{
                          width: 16, height: 16, borderRadius: 999, border: '1px solid #E5E7EB',
                          background: COMPOUND_COLOURS[t] ?? '#CBD5E1', display: 'inline-block',
                        }}
                      />
                    )) : <span style={{ color: '#D1D5DB', fontFamily: MONO, fontSize: 10 }}>—</span>}
                  </span>
                </td>
                <td style={{ padding: '12px 10px', textAlign: 'right', fontFamily: MONO, fontSize: 12, fontWeight: 800, color: r.points ? '#0F766E' : '#9CA3AF' }}>
                  {r.points || '—'}
                </td>
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
  const [sessionsRes, results, stintPace, fastestLaps] = await Promise.all([
    fetchJson<LocalSession[]>('/api/v1/sessions'),
    fetchJson<RaceResult[]>(`/api/v1/sessions/${sessionKey}/race-results`, 120),
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
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: '36px 20px 72px', fontFamily: 'Inter, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Link href="/" style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textDecoration: 'none', fontFamily: 'Inter, sans-serif' }}>
          Pitwall
        </Link>
        <span style={{ fontSize: 11, color: '#D1D5DB' }}>/</span>
        <Link href="/sessions" style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textDecoration: 'none', fontFamily: 'Inter, sans-serif' }}>
          Sessions
        </Link>
        <span style={{ fontSize: 11, color: '#D1D5DB' }}>/</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#111827', fontFamily: 'Inter, sans-serif' }}>
          {circuitName} {weekend.year}
        </span>
      </div>

      {/* Hero */}
      <header style={{ margin: '18px 0 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 760 }}>
            <div style={{ ...eyebrow, marginBottom: 11 }}>Formula 1 {weekend.year} — Round {String(round).padStart(2, '0')}</div>
            <h1 style={{ margin: 0, fontFamily: SERIF, fontWeight: 400, fontSize: 'clamp(2.4rem, 6vw, 4.2rem)', lineHeight: 1.05, color: '#111827', letterSpacing: '-0.02em' }}>
              {circuitName}
            </h1>
            <p style={{ margin: '16px 0 0', fontFamily: SERIF, fontStyle: 'italic', fontSize: 'clamp(1.05rem, 2.4vw, 1.5rem)', lineHeight: 1.5, color: '#6B7280', maxWidth: 620 }}>
              Race classification, macro benchmarks and telemetry-adjacent lap analytics for one complete race window.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, minWidth: 96 }}>
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#0F766E', whiteSpace: 'nowrap' }}>
              R{String(round).padStart(2, '0')}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#9CA3AF' }}>{circuitName}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#9CA3AF' }}>Lap {maxLap}</span>
          </div>
        </div>
      </header>

      {/* Environment */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 32 }}>
        <EnvCard session={envSession} round={round} />
      </div>

      {/* Podium + Benchmarks */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(320px, 5fr)', gap: 22, marginBottom: 32 }}>
        <CardSection eyebrowLabel="Podium" title="Race classification podium" subtitle="Highest classified finishers by championship points awarded.">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <PodiumCard position="P1" result={podiumResults[0]} index={0} winnerBest={winnerBest} />
            <PodiumCard position="P2" result={podiumResults[1]} index={1} winnerBest={winnerBest} />
            <PodiumCard position="P3" result={podiumResults[2]} index={2} winnerBest={winnerBest} />
          </div>
        </CardSection>

        <CardSection eyebrowLabel="Macro Benchmarks" title="Window benchmarks" subtitle="Best whole-track and per-sector performance detected.">
          <BenchmarkRow label="Fastest Lap" value={raceFastest?.[0] ? formatLapTime(raceFastest[0].lap_time_ms) : '—'} caption={raceFastest?.[0] ? `${raceFastest[0].abbreviation} ${raceFastest[0].compound ?? ''} on lap ${raceFastest[0].lap_number}` : 'Awaiting race data'} />
          <BenchmarkRow label="Theoretical Optimum" value={theo.ms ? formatLapTime(theo.ms) : '—'} caption={theo.ms ? `S1 L${theo.s1} · S2 L${theo.s2} · S3 L${theo.s3}` : 'Awaiting sector data'} />
          <BenchmarkRow label="Pole Position" value={qualiFastest?.[0] ? formatLapTime(qualiFastest[0].lap_time_ms) : '—'} caption={qualiFastest?.[0] ? `${qualiFastest[0].abbreviation} · ${qualiFastest[0].compound ?? ''}` : 'Awaiting qualifying data'} />
          <BenchmarkRow label="Winner Gap" value={winnerBest != null ? formatLapTime(winnerBest) : '—'} caption={raceResults?.[0]?.abbreviation ?? 'Awaiting race data'} />
        </CardSection>
      </div>

      {/* Race pace + tyre strategy + consistency (shared driver selection) */}
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

      {/* Classification */}
      <CardSection
        eyebrowLabel="Classification"
        title="Full race classification"
        subtitle={`Official classified order with laps completed, gaps to the leader, fastest lap and compounds used.`}
      >
        {tableRows.length ? (
          <ClassificationTable rows={tableRows} />
        ) : (
          <Empty message="Race results have not been classified yet." />
        )}
      </CardSection>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid #E5E7EB', marginTop: 48, paddingTop: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 600, color: '#111827' }}>
            {circuitName} <span style={{ color: '#9CA3AF' }}>·</span> {weekend.year}
          </div>
          <div style={{ marginTop: 5, fontSize: 11.5, color: '#6B7280', fontFamily: 'Inter, sans-serif' }}>
            Data refreshed from live feeds every minute. Source classification subject to change.
          </div>
        </div>
        <Link
          href={getSessionTelemetryRoute(raceKey)}
          prefetch={false}
          style={{
            textDecoration: 'none', background: '#111827', color: '#FFFFFF', borderRadius: 999,
            padding: '12px 20px', fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 700,
          }}
        >
          Open telemetry →
        </Link>
      </footer>
    </div>
  )
}
