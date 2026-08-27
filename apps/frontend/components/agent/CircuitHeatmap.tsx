'use client'

import { Map } from 'lucide-react'
import { normalizeCircuitPoints, speedGradientColor } from '@/lib/chart-data'
import type { TelemetryInspectorResult } from '@/types/agent'

interface Props {
  result?: TelemetryInspectorResult | null
}

export default function CircuitHeatmap({ result }: Props) {
  const trace = (result?.traces ?? []).find((t) =>
    t.samples.some((s) => s.x_pos != null && s.y_pos != null)
  )
  const samples = trace?.samples ?? []
  const view = normalizeCircuitPoints(samples)
  if (!trace || !view) return null

  const valid = samples.filter((s) => s.x_pos != null && s.y_pos != null)
  const speeds = valid.map((s) => Math.max(0, s.speed_kmh))
  const maxSpeed = Math.max(...speeds, 1)
  const minSpeed = Math.min(...speeds, 0)

  const segments = view.points.slice(0, -1).map(([x1, y1], i) => {
    const [x2, y2] = view.points[i + 1]
    return (
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={speedGradientColor(speeds[i], maxSpeed)}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    )
  })

  const brakeDots = valid
    .map((s, i) => ({ s, point: view.points[i] }))
    .filter(({ s }) => s.brake)
    .slice(0, 80)
    .map(({ point: [x, y] }, i) => (
      <circle key={`brake-${i}`} cx={x} cy={y} r={2.5} fill="#e8002d" opacity={0.85} />
    ))

  return (
    <div className="mt-4 border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Map className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="truncate text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-600">
            Circuit speed heatmap
          </span>
        </div>
        <span className="font-mono text-[10px] font-bold text-slate-400">
          {trace.driver_abbreviation} · L{trace.lap_number}
        </span>
      </div>

      <div className="border-b border-slate-200 bg-[#0d0d0d] p-3">
        <svg
          viewBox={`0 0 ${view.width} ${view.height}`}
          className="h-56 w-full"
          role="img"
          aria-label="Circuit speed heatmap"
        >
          {segments}
          {brakeDots}
          <circle cx={view.points[0][0]} cy={view.points[0][1]} r={4} fill="#ffffff" />
        </svg>
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="font-mono text-[9px] font-bold uppercase text-slate-400">
          {Math.round(minSpeed)} km/h
        </span>
        <div
          className="h-2 flex-1"
          style={{
            background:
              'linear-gradient(90deg, rgb(232,0,45), rgb(255,215,0), rgb(44,244,197))',
          }}
        />
        <span className="font-mono text-[9px] font-bold uppercase text-slate-400">
          {Math.round(maxSpeed)} km/h
        </span>
      </div>
    </div>
  )
}