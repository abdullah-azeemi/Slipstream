'use client'

import { Fragment } from 'react'
import { TrendingDown } from 'lucide-react'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { degradationFit } from '@/lib/chart-data'
import type { StintDegradationResult, StintSummary } from '@/types/agent'

const STINT_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#f97316']

interface Props {
  result?: StintDegradationResult | null
}

function toSeconds(value: number | string) {
  return `${(Number(value) / 1000).toFixed(1)}s`
}

export default function TyreDegradationChart({ result }: Props) {
  const stints = (result?.stints ?? []).filter((s) => s.laps.length > 0)
  if (!stints.length) return null

  const worst = result?.worst_degradation_stint
  const worstSummary = stints.find((s) => s.stint_index === worst)

  return (
    <div className="mt-4 border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <TrendingDown className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="truncate text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-600">
            Tyre degradation
          </span>
        </div>
        {worstSummary && (
          <span className="border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-600">
            worst S{worstSummary.stint_index} {worstSummary.compound}{' '}
            +{worstSummary.degradation_slope_ms_per_lap.toFixed(2)}s/lap
          </span>
        )}
      </div>

      <div className="h-64 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="#eef1f6" vertical={false} />
            <XAxis
              dataKey="age"
              type="number"
              domain={[0, 'dataMax']}
              tick={{ fontSize: 9 }}
              label={{ value: 'tyre age (laps)', position: 'insideBottom', offset: -4, fontSize: 9 }}
            />
            <YAxis
              dataKey="ms"
              domain={['dataMin - 400', 'dataMax + 400']}
              tick={{ fontSize: 9 }}
              width={34}
              tickFormatter={toSeconds}
            />
            <Tooltip
              isAnimationActive={false}
              contentStyle={{ fontSize: 11 }}
              formatter={(value, name) => [
                `${(Number(value ?? 0) / 1000).toFixed(1)}s`,
                String(name),
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {stints.map((stint: StintSummary, index) => {
              const color = STINT_COLORS[index % STINT_COLORS.length]
              const fit = degradationFit(stint)
              const scatterData = stint.laps.map((p) => ({
                age: p.tyre_age,
                ms: p.lap_time_ms,
              }))
              const fitData = fit
                ? [
                    { age: fit.ageStart, ms: fit.startMs },
                    { age: fit.ageEnd, ms: fit.endMs },
                  ]
                : []
              const cliffAge =
                stint.cliff_lap != null ? stint.cliff_lap - stint.start_lap + 1 : null
              return (
                <Fragment key={stint.stint_index}>
                  <Scatter
                    data={scatterData}
                    name={`S${stint.stint_index} ${stint.compound}`}
                    fill={color}
                  />
                  <Line
                    data={fitData}
                    dataKey="ms"
                    name={`${stint.compound} fit`}
                    type="linear"
                    stroke={color}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                  {cliffAge != null && (
                    <ReferenceLine
                      x={cliffAge}
                      stroke="#e8002d"
                      strokeDasharray="4 2"
                      strokeWidth={1}
                    />
                  )}
                </Fragment>
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}