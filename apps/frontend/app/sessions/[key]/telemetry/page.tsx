'use client'
import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { api, telemetryApi } from '@/lib/api'
import { teamColour } from '@/lib/utils'
import type { Driver, TelemetrySample } from '@/types/f1'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import CornerAnalysis from '@/components/telemetry/CornerAnalysis'

// ── Types ────────────────────────────────────────────────────────────────────

interface DriverTrace {
  driver_number: number
  abbreviation:  string
  colour:        string
  lap_number:    number
  samples:       TelemetrySample[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const POINTS   = 300
const PAD      = 4
const CHART_H  = 100
const MINI_H   = 50
const GEAR_H   = 50
const DRS_H    = 24

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Interpolate trace to N evenly-spaced distance points for alignment */
function interpolateByDistance(
  samples: TelemetrySample[],
  n:       number,
  maxDist: number,
): TelemetrySample[] {
  if (samples.length === 0) return []
  const out: TelemetrySample[] = []
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * maxDist
    let best = 0, bestDiff = Infinity
    for (let j = 0; j < samples.length; j++) {
      const diff = Math.abs((samples[j].distance_m ?? 0) - target)
      if (diff < bestDiff) { bestDiff = diff; best = j }
    }
    out.push(samples[best])
  }
  return out
}

/** Build SVG polyline points string */
function pts(
  values: (number | null)[],
  W: number, H: number,
  min: number, max: number,
): string {
  return values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2)
    const y = v == null
      ? H - PAD
      : H - PAD - ((v - min) / (max - min || 1)) * (H - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

/** Compute mini-sector colour per driver: purple=fastest, green=faster, yellow=slower */
function miniSectors(traces: DriverTrace[], sectors = 18) {
  if (traces.length < 2) return []
  const n = traces[0]?.samples.length ?? 0
  if (n === 0) return []
  const sz = Math.floor(n / sectors)

  return Array.from({ length: sectors }, (_, s) => {
    const start = s * sz
    const end   = start + sz
    const avgs  = traces.map(t => {
      const slice  = t.samples.slice(start, end)
      const speeds = slice.map(x => x.speed_kmh ?? 0).filter(Boolean)
      return speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
    })
    const fastest = Math.max(...avgs)
    return traces.map((_, i) => {
      const spd   = avgs[i]
      const other = Math.max(...avgs.filter((_, j) => j !== i))
      return spd === fastest ? '#B347FF'
           : spd >= other    ? '#22C55E'
           : '#FFD700'
    })
  })
}

// ── Track Map ────────────────────────────────────────────────────────────────

function TrackMap({ traces }: { traces: DriverTrace[] }) {
  const first = traces[0]
  if (!first) return null

  const xs = first.samples.map(s => s.x_pos ?? 0).filter(Boolean)
  const ys = first.samples.map(s => s.y_pos ?? 0).filter(Boolean)
  if (xs.length < 10) return null

  const W = 240, H = 130
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const sx   = (x: number) => PAD + ((x - minX) / (maxX - minX || 1)) * (W - PAD * 2)
  const sy   = (y: number) => H - PAD - ((y - minY) / (maxY - minY || 1)) * (H - PAD * 2)

  const trackPath = first.samples
    .filter(s => s.x_pos && s.y_pos)
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${sx(s.x_pos!).toFixed(1)},${sy(s.y_pos!).toFixed(1)}`)
    .join(' ')

  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Track Map</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 110 }}>
        {/* Base track outline */}
        <path d={trackPath} fill="none" stroke="#2A2A2A" strokeWidth="5"
          strokeLinecap="round" strokeLinejoin="round" />
        <path d={trackPath} fill="none" stroke="#444" strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Braking zones — red dots where brake=true */}
        {traces.map(t =>
          t.samples
            .filter(s => s.brake && s.x_pos && s.y_pos)
            .map((s, i) => (
              <circle key={i} cx={sx(s.x_pos!)} cy={sy(s.y_pos!)}
                r={1.5} fill="#E8002D" opacity={0.7} />
            ))
        )}

        {/* DRS zones — green dots */}
        {traces.slice(0, 1).map(t =>
          t.samples
            .filter(s => (s.drs ?? 0) > 8 && s.x_pos && s.y_pos)
            .map((s, i) => (
              <circle key={i} cx={sx(s.x_pos!)} cy={sy(s.y_pos!)}
                r={1.5} fill="#22C55E" opacity={0.6} />
            ))
        )}
      </svg>
      <div className="flex items-center gap-3 mt-1">
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red" /><span className="text-[9px] text-zinc-600">Braking</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[9px] text-zinc-600">DRS</span></div>
      </div>
    </div>
  )
}

// ── Chart wrapper ────────────────────────────────────────────────────────────

function Panel({ title, unit, min, max, children }: {
  title: string; unit: string; min: number; max: number; children: React.ReactNode
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">{title}</span>
        <span className="font-mono text-[9px] text-zinc-700">{unit}</span>
      </div>
      <div className="relative">
        {children}
        <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between pointer-events-none">
          <span className="font-mono text-[9px] text-zinc-700">{max}</span>
          <span className="font-mono text-[9px] text-zinc-700">{min}</span>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TelemetryPage() {
  const { key }    = useParams<{ key: string }>()
  const sessionKey = parseInt(key)

  const [drivers,  setDrivers]  = useState<Driver[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [traces,   setTraces]   = useState<DriverTrace[]>([])
  const [loading,  setLoading]  = useState(false)
  const [ready,    setReady]    = useState(false)

  useEffect(() => {
    api.drivers.list(sessionKey).then(d => {
      setDrivers(d)
      setSelected(d.slice(0, 2).map(x => x.driver_number))
      setReady(true)
    })
  }, [sessionKey])

  useEffect(() => {
    if (!ready || selected.length < 1) return
    setLoading(true)
    telemetryApi.compare(sessionKey, selected)
      .then(data => {
        const result: DriverTrace[] = []
        for (const num of selected) {
          const entry  = data[String(num)]
          const driver = drivers.find(d => d.driver_number === num)
          if (entry && driver) {
            result.push({
              driver_number: num,
              abbreviation:  driver.abbreviation,
              colour:        teamColour(driver.team_colour),
              lap_number:    entry.lap_number,
              samples:       entry.samples,
            })
          }
        }
        setTraces(result)
      })
      .catch(() => setTraces([]))
      .finally(() => setLoading(false))
  }, [selected, sessionKey, ready])

  // Max distance across all loaded traces
  const maxDist = useMemo(() =>
    Math.max(...traces.flatMap(t => t.samples.map(s => s.distance_m ?? 0)), 1),
    [traces]
  )

  // Normalise all traces to same POINTS grid aligned by distance
  const norm = useMemo(() =>
    traces.map(t => ({
      ...t,
      samples: interpolateByDistance(t.samples, POINTS, maxDist),
    })),
    [traces, maxDist]
  )

  const allSpeeds = norm.flatMap(t => t.samples.map(s => s.speed_kmh)).filter(Boolean) as number[]
  const minSpd    = allSpeeds.length ? Math.floor(Math.min(...allSpeeds)) : 0
  const maxSpd    = allSpeeds.length ? Math.ceil(Math.max(...allSpeeds))  : 350
  const deltas    = miniSectors(norm)
  const W         = 560

  if (!ready) return <LoadingSpinner text="Loading session..." />

  return (
    <div className="px-4 py-4 max-w-3xl mx-auto space-y-4">

      <Link href={`/sessions/${sessionKey}`}
        className="flex items-center gap-1.5 text-zinc-500 text-sm hover:text-white transition-colors">
        <ArrowLeft size={14} /> Session
      </Link>

      <div>
        <h1 className="font-display font-bold text-2xl text-white">Speed Traces</h1>
        <p className="text-zinc-500 text-sm">Fastest lap telemetry — distance-aligned overlay</p>
      </div>

      {/* Driver selector */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">
          Drivers (max 4)
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {selected.map(num => {
            const d = drivers.find(x => x.driver_number === num)
            if (!d) return null
            return (
              <button key={num}
                onClick={() => setSelected(p => p.filter(n => n !== num))}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                style={{ background: teamColour(d.team_colour), color: '#000' }}>
                {d.abbreviation} ×
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {drivers.filter(d => !selected.includes(d.driver_number)).map(d => (
            <button key={d.driver_number}
              onClick={() => selected.length < 4 && setSelected(p => [...p, d.driver_number])}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border border-border text-zinc-400 hover:border-zinc-500 transition-colors">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: teamColour(d.team_colour) }} />
              {d.abbreviation}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner text="Fetching telemetry..." />
      ) : norm.length === 0 ? (
        <div className="text-center py-12 text-zinc-600 text-sm bg-surface border border-border rounded-xl">
          No telemetry loaded for this session.
          <br /><br />
          <code className="font-mono text-zinc-500 text-xs bg-surface2 px-2 py-1 rounded">
            uv run python -m ingestion.ingest_session --year YYYY --gp British --session Q
          </code>
        </div>
      ) : (
        <div className="space-y-3">

          {/* Legend */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-4">
              {norm.map(t => (
                <div key={t.driver_number} className="flex items-center gap-1.5">
                  <div className="w-6 h-0.5 rounded" style={{ background: t.colour }} />
                  <span className="font-mono text-xs text-zinc-300">{t.abbreviation}</span>
                  <span className="font-mono text-[10px] text-zinc-600">L{t.lap_number}</span>
                </div>
              ))}
            </div>
            <span className="font-mono text-[10px] text-zinc-600">
              {maxDist > 0 ? `${(maxDist / 1000).toFixed(2)} km` : ''}
            </span>
          </div>

          {/* Speed trace */}
          <Panel title="Speed" unit="km/h" min={minSpd} max={maxSpd}>
            <svg viewBox={`0 0 ${W} ${CHART_H}`} className="w-full" style={{ height: CHART_H }}>
              {[0.25, 0.5, 0.75].map(p => (
                <line key={p}
                  x1={PAD} y1={CHART_H - PAD - p * (CHART_H - PAD*2)}
                  x2={W-PAD} y2={CHART_H - PAD - p * (CHART_H - PAD*2)}
                  stroke="#1A1A1A" strokeWidth="1" />
              ))}
              {/* Brake zones — red strips at bottom */}
              {norm.slice(0, 1).map(t =>
                t.samples.map((s, i) => {
                  if (!s.brake) return null
                  const x = PAD + (i / (POINTS-1)) * (W - PAD*2)
                  return <rect key={i} x={x-1} y={CHART_H-PAD-6} width={2} height={6}
                    fill="#E8002D" opacity={0.5} />
                })
              )}
              {norm.map(t => (
                <polyline key={t.driver_number}
                  points={pts(t.samples.map(s => s.speed_kmh), W, CHART_H, minSpd, maxSpd)}
                  fill="none" stroke={t.colour} strokeWidth="1.5"
                  strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
              ))}
            </svg>
          </Panel>

          {/* Throttle */}
          <Panel title="Throttle" unit="%" min={0} max={100}>
            <svg viewBox={`0 0 ${W} ${MINI_H}`} className="w-full" style={{ height: MINI_H }}>
              {norm.map(t => (
                <polyline key={t.driver_number}
                  points={pts(t.samples.map(s => s.throttle_pct), W, MINI_H, 0, 100)}
                  fill="none" stroke={t.colour} strokeWidth="1.2" opacity={0.8} />
              ))}
            </svg>
          </Panel>

          {/* Gear */}
          <Panel title="Gear" unit="1–8" min={1} max={8}>
            <svg viewBox={`0 0 ${W} ${GEAR_H}`} className="w-full" style={{ height: GEAR_H }}>
              {norm.map(t => (
                <polyline key={t.driver_number}
                  points={pts(t.samples.map(s => s.gear), W, GEAR_H, 1, 8)}
                  fill="none" stroke={t.colour} strokeWidth="1.2" opacity={0.8}
                  strokeLinejoin="miter" />
              ))}
            </svg>
          </Panel>

          {/* DRS open indicator */}
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">DRS Open</div>
            {norm.map(t => (
              <div key={t.driver_number} className="flex items-center gap-2 mb-1.5 last:mb-0">
                <span className="font-mono text-[10px] text-zinc-500 w-8">{t.abbreviation}</span>
                <div className="flex-1 h-4 bg-surface2 rounded overflow-hidden flex">
                  {t.samples.map((s, i) => (
                    <div key={i} className="flex-1 h-full"
                      style={{ background: (s.drs ?? 0) > 8 ? '#22C55E' : 'transparent' }} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Mini sectors */}
          {deltas.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-3">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">
                Mini Sectors — speed advantage per zone
              </div>
              <div className="flex gap-0.5 mb-2">
                {deltas.map((sector, i) => (
                  <div key={i} className="flex-1 flex flex-col gap-0.5">
                    {sector.map((colour, j) => (
                      <div key={j} className="h-3 rounded-sm" style={{ background: colour }} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4">
                {[
                  { colour: '#B347FF', label: 'Fastest overall' },
                  { colour: '#22C55E', label: 'Faster'          },
                  { colour: '#FFD700', label: 'Slower'          },
                ].map(({ colour, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-3 h-2 rounded-sm" style={{ background: colour }} />
                    <span className="text-[9px] text-zinc-500">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Track map */}
          <TrackMap traces={norm} />

          {/* Corner analysis */}
            <CornerAnalysis
              sessionKey={sessionKey}
              drivers={selected}
              driverMap={Object.fromEntries(
                drivers.map(d => [d.driver_number, {
                  abbreviation: d.abbreviation,
                  team_colour:  d.team_colour,
                }])
              )}
            />



        </div>
      )}
    </div>
  )
}