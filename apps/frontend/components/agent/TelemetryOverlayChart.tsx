'use client'

import { Activity } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TelemetryInspectorResult, TelemetryLapTrace } from '@/types/agent'

const TRACE_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#ec4899']

interface Props {
  result?: TelemetryInspectorResult | null
}

function toRows(trace: TelemetryLapTrace) {
  return trace.samples.map((s) => ({
    distance_m: Math.round(s.distance_m),
    speed_kmh: s.speed_kmh,
    throttle_pct: s.throttle_pct,
    brake: s.brake ? 1 : 0,
    gear: s.gear,
    drs: s.drs,
  }))
}

function shortDistance(value: number | string) {
  return `${Math.round(Number(value) / 1000)}k`
}

function ChannelMini({
  label,
  unit,
  rows,
  dataKey,
  color,
  domain,
}: {
  label: string
  unit: string
  rows: ReturnType<typeof toRows>
  dataKey: string
  color: string
  domain: [number | 'auto' | 'dataMin' | 'dataMax', number | 'auto' | 'dataMin' | 'dataMax']
}) {
  return (
    <div className="min-w-0 border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2 py-1">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
          {label}
        </span>
        <span className="font-mono text-[9px] font-bold text-slate-400">{unit}</span>
      </div>
      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 5, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#eef1f6" vertical={false} />
            <XAxis
              dataKey="distance_m"
              type="number"
              domain={[0, 'dataMax']}
              tick={{ fontSize: 8 }}
              tickFormatter={shortDistance}
            />
            <YAxis domain={domain} tick={{ fontSize: 8 }} width={30} />
            <Tooltip isAnimationActive={false} contentStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function TelemetryOverlayChart({ result }: Props) {
  if (!result?.traces?.length) return null

  const primary = result.traces[0]
  const primaryRows = toRows(primary)

  return (
    <div className="mt-4 border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="truncate text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-600">
            Telemetry overlay
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result.traces.map((trace, index) => (
            <span
              key={`${trace.driver_abbreviation}-${trace.lap_number}`}
              className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-slate-500"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: TRACE_COLORS[index % TRACE_COLORS.length] }}
              />
              {trace.driver_abbreviation} · L{trace.lap_number}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 5, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#eef1f6" vertical={false} />
              <XAxis
                dataKey="distance_m"
                type="number"
                domain={[0, 'dataMax']}
                tick={{ fontSize: 9 }}
                tickFormatter={shortDistance}
              />
              <YAxis
                yAxisId="speed"
                domain={[0, 'dataMax']}
                tick={{ fontSize: 9 }}
                width={34}
                unit=""
              />
              <Tooltip
                isAnimationActive={false}
                contentStyle={{ fontSize: 11 }}
                formatter={(value, name) => [`${value ?? 0} km/h`, String(name)]}
              />
              {result.traces.map((trace, index) => (
                <Line
                  key={`${trace.driver_abbreviation}-${trace.lap_number}`}
                  yAxisId="speed"
                  data={toRows(trace)}
                  dataKey="speed_kmh"
                  name={`${trace.driver_abbreviation} L${trace.lap_number}`}
                  type="monotone"
                  stroke={TRACE_COLORS[index % TRACE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ChannelMini
            label="Throttle"
            unit="%"
            rows={primaryRows}
            dataKey="throttle_pct"
            color="#2cf4c5"
            domain={[0, 100]}
          />
          <ChannelMini
            label="Brake"
            unit="on/off"
            rows={primaryRows}
            dataKey="brake"
            color="#e8002d"
            domain={[0, 1]}
          />
          <ChannelMini
            label="Gear"
            unit="1-8"
            rows={primaryRows}
            dataKey="gear"
            color="#ffd700"
            domain={[0, 8]}
          />
          <ChannelMini
            label="DRS"
            unit="open/closed"
            rows={primaryRows}
            dataKey="drs"
            color="#38bdf8"
            domain={[0, 1]}
          />
        </div>
      </div>
    </div>
  )
}