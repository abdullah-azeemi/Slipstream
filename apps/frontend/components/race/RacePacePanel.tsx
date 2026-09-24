'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

import CardSection from '@/components/race/CardSection'
import LapEvolutionChart, { type ChartDriver, type PitWindow } from '@/components/race/LapEvolutionChart'
import { getSessionTelemetryRoute } from '@/lib/session-routing'
import {
  COMPOUND_COLOURS,
  COMPOUND_LABEL,
  formatGap,
  formatLapTime,
  sessionTypeLabel,
} from '@/lib/utils'
import type { Session } from '@/types/f1'

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

const SESSION_ORDER: Record<string, number> = { FP1: 0, FP2: 1, FP3: 2, SQ: 3, SS: 4, Q: 5, S: 6, R: 7 }
const MONO = 'JetBrains Mono, monospace'

function defaultHiddenState(drivers: ChartDriver[], defaultVisible: number): Record<string, boolean> {
  return Object.fromEntries(drivers.slice(defaultVisible).map(d => [d.abbreviation, true]))
}

function Empty({ message }: { message: string }) {
  return (
    <div style={{ border: '1px dashed #D1D5DB', borderRadius: 16, padding: '28px 20px', textAlign: 'center', color: '#6B7280', fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.6 }}>
      {message}
    </div>
  )
}

function formatGapLike(result: RaceResult, index: number): string {
  if (index === 0) return 'Winner'
  if (result.laps_down > 0) return `+${result.laps_down} lap${result.laps_down === 1 ? '' : 's'}`
  if (result.gap_ms == null) return '—'
  return formatGap(result.gap_ms)
}

function SessionStrip({ sessions, currentKey }: { sessions: Session[]; currentKey: number }) {
  if (!sessions.length) return null
  const ordered = [...sessions].sort((a, b) => (SESSION_ORDER[a.session_type] ?? 99) - (SESSION_ORDER[b.session_type] ?? 99))
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {ordered.map(s => {
        const active = s.session_key === currentKey
        return (
          <Link
            key={s.session_key}
            href={getSessionTelemetryRoute(s.session_key)}
            prefetch={false}
            style={{
              textDecoration: 'none', padding: '8px 14px', borderRadius: 999,
              background: active ? '#111827' : '#FFFFFF', color: active ? '#FFFFFF' : '#374151',
              border: `1px solid ${active ? '#111827' : '#E5E7EB'}`,
              fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >
            {sessionTypeLabel(s.session_type)}
          </Link>
        )
      })}
    </div>
  )
}

function StintGantt({ stints, results, maxLap }: { stints: StintPace[]; results: RaceResult[]; maxLap: number }) {
  const rows = results.slice(0, 6)
  if (!rows.length) return <Empty message="Tyre data is not available for this weekend yet." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((result, idx) => {
        const driverStints = stints.filter(s => s.driver_number === result.driver_number).sort((a, b) => a.start_lap - b.start_lap)
        const gap = formatGapLike(result, idx)
        return (
          <div key={result.driver_number}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#111827', fontFamily: 'Inter, sans-serif' }}>{result.abbreviation}</span>
              <span style={{ fontSize: 10.5, color: '#6B7280', fontFamily: MONO, fontWeight: 600 }}>{gap}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '46px 1fr', gap: 10, alignItems: 'center' }}>
              <div style={{ height: 26, borderRadius: 8, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#6B7280', fontFamily: MONO }}>
                {result.total_laps} L
              </div>
              <div style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden', background: '#F3F4F6' }}>
                {driverStints.length ? driverStints.map((stint, i) => {
                  const laps = Math.max(1, stint.end_lap - stint.start_lap + 1)
                  const w = `${(laps / Math.max(maxLap, 1)) * 100}%`
                  return (
                    <div
                      key={`${stint.driver_number}-${stint.stint}-${i}`}
                      style={{
                        width: w, minWidth: '12%',
                        background: COMPOUND_COLOURS[stint.compound] ?? '#CBD5E1',
                        color: '#FFFFFF',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 800, fontFamily: MONO, textTransform: 'uppercase',
                        padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap',
                      }}
                    >
                      {COMPOUND_LABEL[stint.compound] ?? stint.compound.slice(0, 1)}
                    </div>
                  )
                }) : (
                  <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#9CA3AF' }}>
                    No clean stint data
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ConsistencyChart({ drivers, colors }: { drivers: ChartDriver[]; colors: Record<string, string> }) {
  const bins = drivers.map(d => {
    const times = d.laps.map(l => l.lap_time_ms).filter((v): v is number => v != null)
    if (times.length < 3) {
      return { abbr: d.abbreviation, color: colors[d.abbreviation] ?? '#666', bins: [] as number[], min: 0, max: 1, std: null as number | null }
    }
    const sorted = [...times].sort((a, b) => a - b)
    const min = sorted[Math.floor(sorted.length * 0.02)]
    const max = sorted[Math.floor(sorted.length * 0.98)]
    const mean = times.reduce((acc, t) => acc + t, 0) / times.length
    const std = Math.sqrt(times.reduce((acc, t) => acc + (t - mean) ** 2, 0) / times.length)
    const nb = 14
    const width = Math.max(max - min, 1)
    const arr = new Array(nb).fill(0)
    for (const t of times) {
      const idx = Math.min(nb - 1, Math.max(0, Math.floor(((t - min) / width) * nb)))
      arr[idx] += 1
    }
    const peak = Math.max(...arr, 1)
    return { abbr: d.abbreviation, color: colors[d.abbreviation] ?? '#666', bins: arr.map(c => c / peak), min, max, std }
  })

  const W = 200
  const H = 120

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap' }}>
      {bins.map(d => (
        <div key={d.abbr} style={{ textAlign: 'center', flex: '0 1 190px' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            <rect x="0" y="0" width={W} height={H} rx="14" fill="#F9FAFB" />
            {d.bins.map((count, i) => {
              const sliceW = W / d.bins.length
              const x = i * sliceW
              const h = 6 + count * (H - 26)
              const y = (H - 16) - h
              return (
                <rect
                  key={i}
                  x={x + sliceW * 0.08}
                  y={y}
                  width={sliceW * 0.84}
                  height={h}
                  rx="2"
                  fill={d.color}
                  opacity={0.35 + count * 0.65}
                />
              )
            })}
            <line x1="0" y1={H - 16} x2={W} y2={H - 16} stroke="#E5E7EB" strokeWidth="1" />
            <text x={10} y={H - 30} fontSize="8" fontFamily={MONO} fill="#9CA3AF">{formatLapTime(d.max)}</text>
            <text x={10} y={H - 4} fontSize="8" fontFamily={MONO} fill="#9CA3AF">{formatLapTime(d.min)}</text>
          </svg>
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: '#111827', fontFamily: 'Inter, sans-serif' }}>
            {d.abbr}
          </div>
          <div style={{ fontSize: 10.5, fontFamily: MONO, color: d.std != null ? '#0F766E' : '#9CA3AF', fontWeight: 700 }}>
            {d.std != null ? `±${(d.std / 1000).toFixed(3)}s` : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RacePacePanel({
  drivers,
  colors,
  pitWindows,
  maxLap,
  stints,
  results,
  sessions,
  currentKey,
}: {
  drivers: ChartDriver[]
  colors: Record<string, string>
  pitWindows: PitWindow[]
  maxLap: number
  stints: StintPace[]
  results: RaceResult[]
  sessions: Session[]
  currentKey: number
}) {
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => defaultHiddenState(drivers, 4))

  const selected = useMemo(() => drivers.filter(d => !hidden[d.abbreviation]), [drivers, hidden])
  const visibleCount = selected.length
  const allShown = drivers.length > 0 && drivers.every(d => !hidden[d.abbreviation])

  const toggle = (abbr: string) => {
    setHidden(prev => ({ ...prev, [abbr]: !prev[abbr] }))
  }
  const showAll = () => setHidden({})
  const reset = () => setHidden(defaultHiddenState(drivers, 4))

  return (
    <div>
      <CardSection
        eyebrowLabel="Lap Evolution"
        title="Pace over the distance"
        subtitle="Smoothed clean-lap deltas against the race window. Stint transitions marked with their starting compound. The consistency plots below track the same drivers you select."
        right={<SessionStrip sessions={sessions} currentKey={currentKey} />}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9CA3AF', marginRight: 6 }}>
            Drivers
          </span>
          <button
            type="button"
            onClick={allShown ? reset : showAll}
            style={{
              padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
              background: allShown ? '#111827' : '#FFFFFF', color: allShown ? '#FFFFFF' : '#6B7280',
              border: '1px solid #E5E7EB', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700,
            }}
          >
            ALL
          </button>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
              background: '#FFFFFF', color: '#6B7280',
              border: '1px solid #E5E7EB', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
            }}
          >
            Reset
          </button>
          {drivers.map(d => {
            const off = hidden[d.abbreviation]
            const color = colors[d.abbreviation] ?? '#666'
            return (
              <button
                key={d.abbreviation}
                type="button"
                onClick={() => toggle(d.abbreviation)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999,
                  cursor: 'pointer', background: '#FFFFFF',
                  color: off ? '#9CA3AF' : color,
                  border: `1px solid ${off ? '#E5E7EB' : color}`,
                  fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700,
                  opacity: off ? 0.55 : 1,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: off ? '#D1D5DB' : color, display: 'inline-block' }} />
                {d.abbreviation}
              </button>
            )
          })}
        </div>

        {selected.length ? (
          <LapEvolutionChart drivers={selected} colors={colors} pitWindows={pitWindows} maxLap={maxLap} />
        ) : (
          <Empty message="Select at least one driver to plot race pace." />
        )}
      </CardSection>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 7fr) minmax(320px, 5fr)', gap: 22, marginBottom: 32, marginTop: 32 }}>
        <CardSection
          eyebrowLabel="Tyre Strategy"
          title="Stint structure"
          subtitle="Compound allocation per driver across the race distance."
          right={
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {Object.entries(COMPOUND_COLOURS).map(([key, val]) => (
                <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 700, color: '#6B7280', fontFamily: MONO, textTransform: 'uppercase' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: val, border: '1px solid rgba(0,0,0,0.12)', display: 'inline-block' }} />
                  {COMPOUND_LABEL[key] ?? key.slice(0, 3)}
                </span>
              ))}
            </div>
          }
        >
          <StintGantt stints={stints} results={results} maxLap={maxLap} />
        </CardSection>

        <CardSection
          eyebrowLabel="Consistency"
          title="Lap-to-lap stability"
          subtitle={
            visibleCount
              ? `Distribution of clean lap times for the ${visibleCount} driver${visibleCount === 1 ? '' : 's'} currently selected. Tighter peaks mean more consistent race pace.`
              : 'Distribution of clean lap times for the drivers you select. Tighter peaks mean more consistent race pace.'
          }
        >
          {selected.length ? (
            <ConsistencyChart drivers={selected} colors={colors} />
          ) : (
            <Empty message="Select drivers to compare lap-to-lap consistency." />
          )}
        </CardSection>
      </div>
    </div>
  )
}
