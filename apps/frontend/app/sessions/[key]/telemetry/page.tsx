'use client'
import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { api, telemetryApi } from '@/lib/api'
import { teamColour } from '@/lib/utils'
import type { Driver, TelemetrySample } from '@/types/f1'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Link from 'next/link'
import { ArrowLeft, X } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface DriverTrace {
  driver_number: number
  abbreviation:  string
  colour:        string
  lap_number:    number
  samples:       TelemetrySample[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const CHART_H    = 100
const THROTTLE_H = 50
const GEAR_H     = 50
const DRS_H      = 24
const DELTA_H    = 40
const PAD        = 4

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Interpolate a trace to N evenly-spaced distance points */
function interpolateByDistance(
  samples: TelemetrySample[],
  points:  number,
  maxDist: number,
): TelemetrySample[] {
  if (samples.length === 0) return []
  const out: TelemetrySample[] = []
  for (let i = 0; i < points; i++) {
    const d   = (i / (points - 1)) * maxDist
    // find nearest sample
    let best  = 0
    let bestD = Infinity
    for (let j = 0; j < samples.length; j++) {
      const diff = Math.abs((samples[j].distance ?? 0) - d)
      if (diff < bestD) { bestD = diff; best = j }
    }
    out.push(samples[best])
  }
  return out
}

/** Build an SVG polyline points string from a value series */
function buildPoints(
  values: (number | null)[],
  w: number, h: number,
  min: number, max: number,
): string {
  return values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (w - PAD * 2)
    const y = v == null
      ? h - PAD
      : h - PAD - ((v - min) / (max - min || 1)) * (h - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

// ── Mini Sector Delta ────────────────────────────────────────────────────────

function computeMiniSectorDeltas(
  traces: DriverTrace[],
  sectors: number = 18,
): { colour: string; label: string }[][] {
  if (traces.length < 2) return []

  // Split lap into N equal sectors by distance index
  const n = traces[0]?.samples.length ?? 0
  if (n === 0) return []
  const sectorSize = Math.floor(n / sectors)

  return Array.from({ length: sectors }, (_, s) => {
    const start = s * sectorSize
    const end   = start + sectorSize

    // Average speed in this sector per driver
    const avgSpeeds = traces.map(t => {
      const slice = t.samples.slice(start, end)
      const speeds = slice.map(x => x.speed ?? 0).filter(Boolean)
      return speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
    })

    const maxSpeed = Math.max(...avgSpeeds)

    return traces.map((t, i) => {
      const spd = avgSpeeds[i]
      const isPurple = spd === maxSpeed && spd > 0
      // compare to the other driver
      const otherMax = Math.max(...avgSpeeds.filter((_, j) => j !== i))
      const isFaster = spd >= otherMax
      return {
        colour: isPurple ? '#B347FF' : isFaster ? '#22C55E' : '#FFD700',
        label:  t.abbreviation,
      }
    })
  })
}

// ── Track Map ────────────────────────────────────────────────────────────────

function TrackMap({ traces }: { traces: DriverTrace[] }) {
  const first = traces[0]
  if (!first) return null

  const xs = first.samples.map(s => (s as any).x ?? 0).filter(Boolean)
  const ys = first.samples.map(s => (s as any).y ?? 0).filter(Boolean)
  if (xs.length === 0) return null

  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const W = 200, H = 120

  const scaleX = (x: number) => PAD + ((x - minX) / (maxX - minX || 1)) * (W - PAD * 2)
  const scaleY = (y: number) => H - PAD - ((y - minY) / (maxY - minY || 1)) * (H - PAD * 2)

  const trackPath = first.samples
    .filter(s => (s as any).x && (s as any).y)
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${scaleX((s as any).x).toFixed(1)},${scaleY((s as any).y).toFixed(1)}`)
    .join(' ')

  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Track Map</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }}>
        {/* Base track */}
        <path d={trackPath} fill="none" stroke="#333" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {/* Each driver's braking zones coloured */}
        {traces.map(t => {
          const brakePath = t.samples
            .filter(s => s.brake && (s as any).x && (s as any).y)
            .map((s, i, arr) => `${i === 0 ? 'M' : 'L'}${scaleX((s as any).x).toFixed(1)},${scaleY((s as any).y).toFixed(1)}`)
            .join(' ')
          return brakePath ? (
            <path key={t.driver_number} d={brakePath} fill="none"
              stroke="#E8002D" strokeWidth="3" opacity={0.8} />
          ) : null
        })}
        {/* Driver positions overlaid */}
        {traces.map(t => {
          const last = t.samples.filter(s => (s as any).x && (s as any).y).at(-1)
          if (!last) return null
          return (
            <circle key={t.driver_number}
              cx={scaleX((last as any).x)} cy={scaleY((last as any).y)}
              r={3} fill={t.colour} />
          )
        })}
      </svg>
      <div className="text-[9px] text-zinc-700 mt-1">Red = braking zones</div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TelemetryPage() {
  const { key } = useParams<{ key: string }>()
  const sessionKey = parseInt(key)

  const [drivers,  setDrivers]  = useState<Driver[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [traces,   setTraces]   = useState<DriverTrace[]>([])
  const [loading,  setLoading]  = useState(false)
  const [pageLoad, setPageLoad] = useState(true)

  // Load driver list on mount
  useEffect(() => {
    api.drivers.list(sessionKey)
      .then(d => {
        setDrivers(d)
        // Default: top 2 drivers
        const top2 = d.slice(0, 2).map(x => x.driver_number)
        setSelected(top2)
      })
      .finally(() => setPageLoad(false))
  }, [sessionKey])

  // Load telemetry when selection changes
  useEffect(() => {
    if (selected.length < 1) return
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
  }, [selected, sessionKey, drivers])

  // Normalise all traces to same distance grid
  const POINTS   = 300
  const maxDist  = useMemo(() =>
    Math.max(...traces.flatMap(t => t.samples.map(s => s.distance ?? 0)), 1),
    [traces]
  )

  const normTraces = useMemo(() =>
    traces.map(t => ({
      ...t,
      samples: interpolateByDistance(t.samples, POINTS, maxDist),
    })),
    [traces, maxDist]
  )

  // Derived series
  const speedSeries    = normTraces.map(t => t.samples.map(s => s.speed))
  const throttleSeries = normTraces.map(t => t.samples.map(s => s.throttle))
  const gearSeries     = normTraces.map(t => t.samples.map(s => s.gear))
  const drsSeries      = normTraces.map(t => t.samples.map(s => (s.drs ?? 0) > 8 ? 1 : 0))
  const brakeSeries    = normTraces.map(t => t.samples.map(s => s.brake ? 1 : 0))

  const allSpeeds   = speedSeries.flat().filter(Boolean) as number[]
  const minSpeed    = allSpeeds.length ? Math.min(...allSpeeds) : 0
  const maxSpeed    = allSpeeds.length ? Math.max(...allSpeeds) : 350
  const miniDeltas  = computeMiniSectorDeltas(normTraces)

  const W = 560

  if (pageLoad) return <LoadingSpinner text="Loading session..." />

  return (
    <div className="px-4 py-4 max-w-3xl mx-auto space-y-4">

      {/* Header */}
      <Link href={`/sessions/${sessionKey}`}
        className="flex items-center gap-1.5 text-zinc-500 text-sm hover:text-white transition-colors">
        <ArrowLeft size={14} /> Session
      </Link>

      <div>
        <h1 className="font-display font-bold text-2xl text-white">Speed Traces</h1>
        <p className="text-zinc-500 text-sm">Fastest lap telemetry comparison</p>
      </div>

      {/* Driver selector */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3">Select Drivers (max 4)</div>

        {/* Selected tags */}
        <div className="flex flex-wrap gap-2 mb-3">
          {selected.map(num => {
            const d = drivers.find(x => x.driver_number === num)
            if (!d) return null
            return (
              <button key={num}
                onClick={() => setSelected(prev => prev.filter(n => n !== num))}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border-0 text-black"
                style={{ background: teamColour(d.team_colour) }}
              >
                {d.abbreviation} <X size={10} />
              </button>
            )
          })}
        </div>

        {/* Available drivers */}
        <div className="flex flex-wrap gap-1.5">
          {drivers.filter(d => !selected.includes(d.driver_number)).map(d => (
            <button key={d.driver_number}
              onClick={() => selected.length < 4 && setSelected(prev => [...prev, d.driver_number])}
              className="px-2.5 py-1 rounded-full text-xs font-mono text-zinc-400 border border-border hover:border-zinc-500 transition-colors"
            >
              {d.abbreviation}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner text="Fetching telemetry..." />
      ) : normTraces.length === 0 ? (
        <div className="text-center py-12 text-zinc-600 text-sm">
          No telemetry loaded for this session.
          <br />
          <code className="font-mono text-zinc-500 text-xs">
            uv run python -m ingestion.ingest_session --year YYYY --gp British --session Q
          </code>
        </div>
      ) : (
        <div className="space-y-3">

          {/* Legend + lap info */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-4">
              {normTraces.map(t => (
                <div key={t.driver_number} className="flex items-center gap-1.5">
                  <div className="w-6 h-0.5 rounded" style={{ background: t.colour }} />
                  <span className="font-mono text-xs text-zinc-300">{t.abbreviation}</span>
                  <span className="font-mono text-[10px] text-zinc-600">L{t.lap_number}</span>
                </div>
              ))}
            </div>
            <span className="text-[10px] text-zinc-600 font-mono">
              {maxDist > 0 ? `${(maxDist / 1000).toFixed(2)}km` : ''}
            </span>
          </div>

          {/* ── Speed Trace ─────────────────────────────────────────────── */}
          <ChartPanel title="Speed" unit="km/h" minVal={Math.round(minSpeed)} maxVal={Math.round(maxSpeed)}>
            <svg viewBox={`0 0 ${W} ${CHART_H}`} className="w-full" style={{ height: CHART_H }}>
              {/* Grid */}
              {[0.25, 0.5, 0.75].map(p => (
                <line key={p}
                  x1={PAD} y1={CHART_H - PAD - p * (CHART_H - PAD*2)}
                  x2={W - PAD} y2={CHART_H - PAD - p * (CHART_H - PAD*2)}
                  stroke="#1E1E1E" strokeWidth="1" />
              ))}

              {/* Brake zones — red fill at bottom */}
              {normTraces.slice(0, 1).map(t =>
                t.samples.map((s, i) => {
                  if (!s.brake) return null
                  const x = PAD + (i / (POINTS - 1)) * (W - PAD*2)
                  return (
                    <rect key={i} x={x - 1} y={CHART_H - PAD - 8}
                      width={2} height={8} fill="#E8002D" opacity={0.5} />
                  )
                })
              )}

              {/* Speed traces */}
              {normTraces.map(t => (
                <polyline key={t.driver_number}
                  points={buildPoints(speedSeries[normTraces.indexOf(t)], W, CHART_H, minSpeed, maxSpeed)}
                  fill="none" stroke={t.colour} strokeWidth="1.5"
                  strokeLinejoin="round" strokeLinecap="round" opacity={0.9}
                />
              ))}
            </svg>
          </ChartPanel>

          {/* ── Throttle ────────────────────────────────────────────────── */}
          <ChartPanel title="Throttle" unit="%" minVal={0} maxVal={100}>
            <svg viewBox={`0 0 ${W} ${THROTTLE_H}`} className="w-full" style={{ height: THROTTLE_H }}>
              {normTraces.map(t => (
                <polyline key={t.driver_number}
                  points={buildPoints(throttleSeries[normTraces.indexOf(t)], W, THROTTLE_H, 0, 100)}
                  fill="none" stroke={t.colour} strokeWidth="1.2" opacity={0.8}
                />
              ))}
            </svg>
          </ChartPanel>

          {/* ── Gear ────────────────────────────────────────────────────── */}
          <ChartPanel title="Gear" unit="1–8" minVal={1} maxVal={8}>
            <svg viewBox={`0 0 ${W} ${GEAR_H}`} className="w-full" style={{ height: GEAR_H }}>
              {normTraces.map(t => (
                <polyline key={t.driver_number}
                  points={buildPoints(gearSeries[normTraces.indexOf(t)], W, GEAR_H, 1, 8)}
                  fill="none" stroke={t.colour} strokeWidth="1.2" opacity={0.8}
                  strokeLinejoin="miter"
                />
              ))}
            </svg>
          </ChartPanel>

          {/* ── DRS ─────────────────────────────────────────────────────── */}
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">DRS Open</div>
            {normTraces.map(t => (
              <div key={t.driver_number} className="flex items-center gap-2 mb-1.5 last:mb-0">
                <span className="font-mono text-[10px] text-zinc-500 w-8">{t.abbreviation}</span>
                <div className="flex-1 h-4 bg-surface2 rounded overflow-hidden flex">
                  {drsSeries[normTraces.indexOf(t)].map((on, i) => (
                    <div key={i} className="flex-1 h-full transition-colors"
                      style={{ background: on ? '#22C55E' : 'transparent' }} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* ── Mini Sectors ─────────────────────────────────────────────── */}
          {miniDeltas.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-3">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">
                Mini Sectors — speed advantage per zone
              </div>
              <div className="flex gap-1 mb-1">
                {miniDeltas.map((sector, i) => (
                  <div key={i} className="flex-1 flex flex-col gap-0.5">
                    {sector.map((d, j) => (
                      <div key={j} className="h-3 rounded-sm" style={{ background: d.colour }} />
                    ))}
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div className="flex items-center gap-4 mt-2">
                {[
                  { colour: '#B347FF', label: 'Fastest overall' },
                  { colour: '#22C55E', label: 'Faster' },
                  { colour: '#FFD700', label: 'Slower' },
                ].map(({ colour, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-3 h-2 rounded-sm" style={{ background: colour }} />
                    <span className="text-[9px] text-zinc-500">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Track Map */}
          <TrackMap traces={normTraces} />

        </div>
      )}
    </div>
  )
}

// ── Reusable chart wrapper ───────────────────────────────────────────────────

function ChartPanel({
  title, unit, minVal, maxVal, children
}: {
  title: string; unit: string; minVal: number; maxVal: number; children: React.ReactNode
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">{title}</span>
        <span className="font-mono text-[9px] text-zinc-700">{unit}</span>
      </div>
      <div className="relative">
        {children}
        {/* Y axis labels */}
        <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between pointer-events-none pr-1">
          <span className="font-mono text-[9px] text-zinc-700">{maxVal}</span>
          <span className="font-mono text-[9px] text-zinc-700">{minVal}</span>
        </div>
      </div>
    </div>
  )
}
