import { ResolvedSession, ResolvedDriver, PitStop, SpeedWindowResult } from '@/types/agent'
import { ArrowRight, Flag, Gauge, User } from 'lucide-react'

interface Props {
  session?: ResolvedSession | null
  driver?: ResolvedDriver | null
  pitStop?: PitStop | null
  speedWindow?: SpeedWindowResult | null
}

function formatSpeed(value?: number | null) {
  return value === undefined || value === null ? 'N/A' : `${value.toFixed(1)} km/h`
}

export default function EvidenceCards({ session, driver, pitStop, speedWindow }: Props) {
  if (!session && !driver && !pitStop && !speedWindow) return null

  const deltaFormatted =
    speedWindow?.delta_kmh !== undefined && speedWindow?.delta_kmh !== null
      ? `${speedWindow.delta_kmh > 0 ? '+' : ''}${speedWindow.delta_kmh.toFixed(1)} km/h`
      : null

  const isPositiveDelta = (speedWindow?.delta_kmh ?? 0) > 0

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {(session || driver) && (
        <div className="relative overflow-hidden border border-slate-200 bg-white p-3 shadow-sm">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-rose-500" />
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
            <Flag className="h-3 w-3 text-rose-500" />
            Target context
          </div>

          {session && (
            <div className="truncate text-sm font-black text-slate-800">
              {session.year} {session.gp_name}
            </div>
          )}

          {driver && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-500">
              <User className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="truncate">
                #{driver.driver_number} {driver.full_name} ({driver.abbreviation})
              </span>
            </div>
          )}
        </div>
      )}

      {pitStop && (
        <div className="relative overflow-hidden border border-slate-200 bg-white p-3 shadow-sm">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-amber-500" />
          <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
            Pit stop #{pitStop.stop_index}
          </div>

          <div className="flex items-center gap-2 text-sm font-black text-slate-800">
            <span>Lap {pitStop.pit_in_lap}</span>
            <ArrowRight className="h-3.5 w-3.5 text-amber-500" />
            <span>Lap {pitStop.pit_out_lap}</span>
          </div>

          <div className="mt-1 text-xs font-semibold text-slate-500">
            {pitStop.compound_before || 'Unspecified'} -&gt;{' '}
            {pitStop.compound_after || 'Unspecified'}
          </div>
        </div>
      )}

      {speedWindow && (
        <div className="relative overflow-hidden border border-slate-200 bg-white p-3 shadow-sm sm:col-span-2 xl:col-span-1">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500" />
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
              <Gauge className="h-3 w-3 text-emerald-500" />
              Speed delta
            </div>
            {deltaFormatted && (
              <span
                className={`font-mono text-xs font-bold ${
                  isPositiveDelta ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {deltaFormatted}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 border border-slate-200 bg-slate-50 p-2 text-xs">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">Pre-stop avg</div>
              <div className="mt-1 font-mono font-bold text-slate-800">
                {formatSpeed(speedWindow.before_avg_speed_kmh)}
              </div>
              <div className="mt-1 text-[10px] font-semibold text-slate-400">
                Laps: {speedWindow.before_laps.join(', ') || 'N/A'}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">Post-stop avg</div>
              <div className="mt-1 font-mono font-bold text-slate-800">
                {formatSpeed(speedWindow.after_avg_speed_kmh)}
              </div>
              <div className="mt-1 text-[10px] font-semibold text-slate-400">
                Laps: {speedWindow.after_laps.join(', ') || 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
