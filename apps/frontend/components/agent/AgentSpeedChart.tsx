import { Activity, BarChart3 } from 'lucide-react'
import { SpeedWindowResult } from '@/types/agent'

interface Props {
  speedWindow?: SpeedWindowResult | null
}

function formatSpeed(value?: number | null) {
  return value === undefined || value === null ? 'N/A' : `${value.toFixed(1)} km/h`
}

export default function AgentSpeedChart({ speedWindow }: Props) {
  if (!speedWindow?.before_avg_speed_kmh || !speedWindow?.after_avg_speed_kmh) return null

  const values = [speedWindow.before_avg_speed_kmh, speedWindow.after_avg_speed_kmh]
  const max = Math.max(...values, 1)
  const beforeHeight = Math.max(18, (speedWindow.before_avg_speed_kmh / max) * 116)
  const afterHeight = Math.max(18, (speedWindow.after_avg_speed_kmh / max) * 116)
  const delta = speedWindow.delta_kmh ?? 0
  const deltaTone = delta >= 0 ? 'text-emerald-600' : 'text-rose-600'

  return (
    <div className="mt-4 border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span className="truncate text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-600">
            Speed comparison graph
          </span>
        </div>
        <span className={`font-mono text-[11px] font-black ${deltaTone}`}>
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)} km/h
        </span>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-[170px_minmax(0,1fr)]">
        <div className="grid h-40 grid-cols-2 items-end gap-4 border border-slate-200 bg-slate-50 px-4 pb-4 pt-3">
          <div className="flex h-full flex-col justify-end gap-2">
            <div
              className="border border-rose-300 bg-rose-500/85"
              style={{ height: `${beforeHeight}px` }}
            />
            <div className="text-center text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">
              Before
            </div>
          </div>
          <div className="flex h-full flex-col justify-end gap-2">
            <div
              className="border border-emerald-300 bg-emerald-500/85"
              style={{ height: `${afterHeight}px` }}
            />
            <div className="text-center text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">
              After
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border-l border-rose-200 pl-3">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
              Pre-stop laps
            </div>
            <div className="mt-1 font-mono text-lg font-black text-slate-800">
              {formatSpeed(speedWindow.before_avg_speed_kmh)}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-500">
              Laps {speedWindow.before_laps.join(', ')}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">
              <Activity className="h-3 w-3" />
              {speedWindow.sample_count_before} samples
            </div>
          </div>

          <div className="border-l border-emerald-200 pl-3">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
              Post-stop laps
            </div>
            <div className="mt-1 font-mono text-lg font-black text-slate-800">
              {formatSpeed(speedWindow.after_avg_speed_kmh)}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-500">
              Laps {speedWindow.after_laps.join(', ')}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">
              <Activity className="h-3 w-3" />
              {speedWindow.sample_count_after} samples
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
