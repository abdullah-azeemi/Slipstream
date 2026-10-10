import { WeatherWindowResult } from '@/types/agent'
import { CloudRain, CloudSun, Thermometer, Droplets, Wind } from 'lucide-react'

interface Props {
  result?: WeatherWindowResult | null
}

function fmt(value?: number | null, unit = '') {
  return value === undefined || value === null ? 'N/A' : `${value}${unit}`
}

export default function WeatherEvidence({ result }: Props) {
  if (!result || result.samples.length === 0) return null

  const last = result.samples[result.samples.length - 1]

  return (
    <div className="mt-4 overflow-hidden border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-sky-50/60 px-3 py-2">
        <CloudSun className="h-3.5 w-3.5 text-sky-600" />
        <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
          Weather · laps {result.from_lap ?? '—'}–{result.to_lap ?? '—'}
        </div>
        {result.total_laps > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-sky-700">
            <CloudRain className="h-3 w-3" />
            rain on {result.rainfall_laps}/{result.total_laps} laps ({result.rain_share_pct}%)
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
        <Stat
          icon={<Thermometer className="h-3.5 w-3.5 text-amber-500" />}
          label="Track temp"
          value={fmt(last?.track_temp_c, '°C')}
        />
        <Stat
          icon={<Wind className="h-3.5 w-3.5 text-slate-400" />}
          label="Air / wind"
          value={`${fmt(last?.air_temp_c, '°C')} · ${fmt(last?.wind_speed_ms, ' m/s')}`}
        />
        <Stat
          icon={<Droplets className="h-3.5 w-3.5 text-sky-500" />}
          label="Humidity"
          value={fmt(last?.humidity_pct, '%')}
        />
        <Stat
          icon={<Thermometer className="h-3.5 w-3.5 text-rose-500" />}
          label="Track delta"
          value={fmt(result.track_temp_delta_c, '°C')}
        />
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 bg-white px-3 py-2.5">
      {icon}
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400">
          {label}
        </div>
        <div className="truncate text-xs font-bold text-slate-800">{value}</div>
      </div>
    </div>
  )
}