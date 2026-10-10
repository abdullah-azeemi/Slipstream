'use client'

import { useMemo, useState } from 'react'
import { formatLapTime } from '@/lib/utils'

export type ChartLap = {
  lap_number: number
  lap_time_ms: number | null
  compound: string | null
  stint?: number | null
  position?: number | null
}

export type ChartDriver = {
  driver_number: number
  abbreviation: string
  team_name: string
  laps: ChartLap[]
}

export type PitWindow = { start: number; end: number; label: string }

const COMPOUND_DOT: Record<string, string> = {
  SOFT: '#DC2626',
  MEDIUM: '#EAB308',
  HARD: '#334155',
  INTER: '#16A34A',
  INTERMEDIATE: '#16A34A',
  WET: '#0284C7',
}

const WIDTH = 760
const HEIGHT = 340
const PAD = { top: 20, right: 22, bottom: 34, left: 64 }

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(i - 1, 0)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(i + 2, points.length - 1)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

export default function LapEvolutionChart({
  drivers,
  colors,
  pitWindows,
  maxLap,
}: {
  drivers: ChartDriver[]
  colors: Record<string, string>
  pitWindows: PitWindow[]
  maxLap: number
}) {
  const [tooltipLap, setTooltipLap] = useState<number | null>(null)

  const cleanLaps = useMemo(() => {
    const winnerTimes = drivers[0]?.laps.flatMap(l => (l.lap_time_ms != null ? [l.lap_time_ms] : [])) ?? []
    const globalMin = winnerTimes.length ? Math.min(...winnerTimes) : 0
    return drivers.map(dr => ({
      ...dr,
      clean: dr.laps.filter(
        f => f.lap_time_ms != null && f.lap_time_ms >= globalMin && f.lap_time_ms <= globalMin + 5500,
      ),
    }))
  }, [drivers])

  const domain = useMemo(() => {
    const all = cleanLaps.flatMap(d => d.clean.map(l => l.lap_time_ms as number))
    if (!all.length) return { min: 0, max: 100000 }
    const min = Math.min(...all)
    const max = Math.max(...all)
    const padMs = Math.max(500, Math.round((max - min) * 0.18))
    return { min: min - padMs, max: max + padMs }
  }, [cleanLaps])

  const scaleX = (lap: number) => {
    const span = Math.max(maxLap, 1)
    return PAD.left + ((lap - 1) / span) * (WIDTH - PAD.left - PAD.right)
  }

  const scaleY = (ms: number) => {
    const range = Math.max(domain.max - domain.min, 1)
    return PAD.top + (1 - (ms - domain.min) / range) * (HEIGHT - PAD.top - PAD.bottom)
  }

  const xTicks = useMemo(() => {
    const ticks: number[] = []
    const step = Math.max(1, Math.round(maxLap / 10))
    for (let lap = 1; lap <= maxLap; lap += step) ticks.push(lap)
    if (ticks[ticks.length - 1] !== maxLap) ticks.push(maxLap)
    return ticks
  }, [maxLap])

  const yTicks = useMemo(() => {
    const ticks: number[] = []
    for (let i = 0; i <= 4; i += 1) ticks.push(domain.min + ((domain.max - domain.min) * i) / 4)
    return ticks
  }, [domain])

  const tooltipX = tooltipLap != null ? scaleX(tooltipLap) : 0
  const tooltipPts = tooltipLap != null
    ? cleanLaps
        .map(d => {
          const lap = [...d.clean].reverse().find(l => l.lap_number <= tooltipLap!) ?? d.clean[0]
          return { abbr: d.abbreviation, color: colors[d.abbreviation] ?? '#666', ms: lap?.lap_time_ms ?? null }
        })
        .filter(p => p.ms != null)
    : []

  return (
    <div>
      <div
        style={{ position: 'relative' }}
        onMouseLeave={() => setTooltipLap(null)}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * WIDTH
          const span = Math.max(maxLap, 1)
          const plotW = WIDTH - PAD.left - PAD.right
          const lap = Math.round(1 + ((x - PAD.left) / Math.max(plotW, 1)) * span)
          setTooltipLap(Math.max(1, Math.min(lap, maxLap)))
        }}
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {xTicks.map(lap => (
            <line key={`x${lap}`} x1={scaleX(lap)} y1={PAD.top} x2={scaleX(lap)} y2={HEIGHT - PAD.bottom} stroke="#EEF1F6" strokeWidth="1" />
          ))}
          {yTicks.map(ms => (
            <line key={`y${ms}`} x1={PAD.left} y1={scaleY(ms)} x2={WIDTH - PAD.right} y2={scaleY(ms)} stroke="#EEF1F6" strokeWidth="1" />
          ))}

          {yTicks.map(ms => (
            <text key={`yt${ms}`} x={PAD.left - 8} y={scaleY(ms) + 3} textAnchor="end" fontSize="9" fontFamily="JetBrains Mono, monospace" fill="#9CA3AF">
              {formatLapTime(Math.round(ms))}
            </text>
          ))}
          {xTicks.map(lap => (
            <text key={`xt${lap}`} x={scaleX(lap)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono, monospace" fill="#9CA3AF">
              {lap}
            </text>
          ))}

          {pitWindows.map((w, i) => {
            const x1 = scaleX(w.start) - 3
            const x2 = scaleX(w.end) + 5
            return (
              <g key={`pit${i}`}>
                <rect
                  x={x1}
                  y={PAD.top}
                  width={Math.max(8, x2 - x1)}
                  height={HEIGHT - PAD.top - PAD.bottom}
                  fill="rgba(245,158,11,0.09)"
                />
                <text x={(x1 + x2) / 2} y={PAD.top - 7} textAnchor="middle" fontSize="8" fontFamily="JetBrains Mono, monospace" fill="#B45309" letterSpacing="0.06em">
                  {w.label}
                </text>
              </g>
            )
          })}

          {cleanLaps.map(d => {
            const color = colors[d.abbreviation] ?? '#666'
            const pts = d.clean
              .filter(p => p.lap_time_ms != null)
              .map(p => ({ x: scaleX(p.lap_number), y: scaleY(p.lap_time_ms as number) }))
            const path = smoothPath(pts)
            const transitions: Array<{ x: number; y: number; compound: string }> = []
            for (let i = 1; i < d.clean.length; i += 1) {
              const lap = d.clean[i]
              const prev = d.clean[i - 1]
              if (lap.stint !== prev.stint && lap.lap_time_ms != null) {
                transitions.push({ x: scaleX(lap.lap_number), y: scaleY(lap.lap_time_ms), compound: lap.compound ?? '' })
              }
            }
            return (
              <g key={d.abbreviation}>
                <path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
                {transitions.map((pt, i) => (
                  <circle key={`${d.abbreviation}-${i}`} cx={pt.x} cy={pt.y} r="4.5" fill="#FFFFFF" stroke={COMPOUND_DOT[pt.compound] ?? '#94A3B8'} strokeWidth="2" opacity="0.95" />
                ))}
              </g>
            )
          })}
        </svg>

        {tooltipLap != null && tooltipPts.length > 0 && (
          <div style={{
            position: 'absolute',
            left: `${Math.min(Math.max((tooltipX / WIDTH) * 100, 4), 70)}%`,
            top: 36,
            background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12,
            boxShadow: '0 12px 28px rgba(17,24,39,0.12)', padding: '10px 12px', minWidth: 170,
            pointerEvents: 'none', zIndex: 5, maxHeight: 320, overflow: 'hidden',
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 8, fontFamily: 'JetBrains Mono, monospace' }}>
              Lap {tooltipLap}
            </div>
            {tooltipPts.map(p => {
              const bestAtLap = Math.min(...tooltipPts.map(x => x.ms ?? Infinity))
              const delta = (p.ms ?? 0) - bestAtLap
              return (
                <div key={p.abbr} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, padding: '3px 0' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#111827', fontFamily: 'Inter, sans-serif' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
                    {p.abbr}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#111827' }}>
                    {formatLapTime(p.ms)}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: delta === 0 ? '#9CA3AF' : '#B45309', minWidth: 52, textAlign: 'right' }}>
                    {delta === 0 ? 'best' : `+${(delta / 1000).toFixed(3)}s`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {Object.entries(COMPOUND_DOT).map(([key, val]) => (
            <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 600, color: '#9CA3AF', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#FFF', border: `2px solid ${val}`, display: 'inline-block' }} />
              {key}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
