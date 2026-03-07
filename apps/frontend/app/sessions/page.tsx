import { api } from '@/lib/api'
import { getCircuitImage, sessionTypeLabel } from '@/lib/utils'
import Link from 'next/link'
import Image from 'next/image'
import { Calendar, ChevronRight } from 'lucide-react'

export const revalidate = 60

export default async function SessionsPage() {
  const sessions = await api.sessions.list(true).catch(() => [])

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Sessions</h1>
      <p className="text-zinc-500 text-sm mb-5">All loaded F1 sessions</p>

      <div className="space-y-3">
        {sessions.length === 0 && (
          <div className="text-center py-16 text-zinc-600 text-sm">
            No sessions available. Run the ingestion script to load data.
          </div>
        )}
        {sessions.map(session => (
          <Link
            key={session.session_key}
            href={`/sessions/${session.session_key}`}
            className="flex items-center gap-4 bg-surface border border-border rounded-xl overflow-hidden hover:border-zinc-600 transition-colors group"
          >
            <div className="w-20 h-16 flex-shrink-0 relative">
              <Image
                src={getCircuitImage(session.gp_name)}
                alt={session.gp_name}
                fill
                sizes="80px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-black/30" />
            </div>

            <div className="flex-1 min-w-0 py-3">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] bg-red/20 text-red px-1.5 py-0.5 rounded font-medium">
                  {sessionTypeLabel(session.session_type)}
                </span>
                <span className="text-zinc-600 text-xs font-mono">{session.year}</span>
              </div>
              <div className="font-semibold text-white text-sm truncate">{session.gp_name}</div>
              {session.date_start && (
                <div className="flex items-center gap-1 text-zinc-500 text-xs mt-0.5">
                  <Calendar size={10} />
                  {new Date(session.date_start).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric'
                  })}
                </div>
              )}
            </div>

            <ChevronRight size={16} className="text-zinc-600 mr-4 group-hover:text-zinc-300 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
