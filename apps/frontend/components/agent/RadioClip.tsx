import { RadioWindowResult } from '@/types/agent'
import { ExternalLink, Volume2 } from 'lucide-react'

interface Props {
  result?: RadioWindowResult | null
}

export default function RadioClip({ result }: Props) {
  if (!result || result.messages.length === 0) return null

  return (
    <div className="mt-4 overflow-hidden border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-rose-50/60 px-3 py-2">
        <Volume2 className="h-3.5 w-3.5 text-rose-500" />
        <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
          Team radio · #{result.driver_number} · laps {result.from_lap ?? '—'}–
          {result.to_lap ?? '—'}
        </div>
        <span className="ml-auto text-[10px] font-bold text-slate-400">
          {result.clip_count} clip{result.clip_count === 1 ? '' : 's'}
        </span>
      </div>

      <div className="divide-y divide-slate-100">
        {result.messages.map((msg, idx) => (
          <div key={idx} className="flex items-center gap-3 px-3 py-2.5">
            {msg.recording_url ? (
              <audio controls preload="none" className="h-9 w-64 max-w-full">
                <source src={msg.recording_url} type="audio/mpeg" />
                Your browser does not support the audio element.
              </audio>
            ) : (
              <span className="text-xs font-semibold text-slate-300">
                no recording
              </span>
            )}

            <div className="min-w-0 flex-1">
              {msg.transcript && (
                <div className="truncate text-xs font-bold text-slate-700">
                  “{msg.transcript}”
                </div>
              )}
              {msg.date && (
                <div className="mt-0.5 text-[10px] font-mono text-slate-400">
                  {msg.date}
                </div>
              )}
            </div>

            {msg.recording_url && (
              <a
                href={msg.recording_url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-slate-400 transition-colors hover:text-rose-500"
                aria-label="Open full clip"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}