'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Flag, Activity, Zap, Calendar } from 'lucide-react'

const NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/schedule', label: 'Schedule', icon: Calendar },
  { href: '/sessions', label: 'Sessions', icon: Flag },
  { href: '/predictions', label: 'Predictions', icon: Zap },
]

export default function BottomNav() {
  const pathname = usePathname()

  // Extract session key if we're inside a session
  const sessionMatch = pathname.match(/\/sessions\/(\d+)/)
  const sessionKey = sessionMatch ? sessionMatch[1] : null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/8 bg-[rgba(7,17,27,0.84)] px-3 pb-3 pt-2 backdrop-blur-xl md:px-5">
      <div className="flex h-[70px] w-full items-center justify-between rounded-[24px] border border-white/8 bg-white/[0.03] px-2 shadow-[0_-12px_30px_rgba(0,0,0,0.16)] md:px-4">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className={`group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 pb-2 pt-4 transition-all ${
              active ? 'bg-white/8' : 'hover:bg-white/5'
            }`}
          >
            {active && (
              <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 translate-y-0.5 rounded-full bg-red shadow-[0_0_12px_rgba(232,0,45,0.85)]" />
            )}
            <Icon size={18} className={active ? 'text-red' : 'text-[var(--text-3)] group-hover:text-[var(--text-2)]'} />
            <span className={`truncate text-[10px] font-medium tracking-[0.08em] ${active ? 'text-white' : 'text-[var(--text-3)] group-hover:text-[var(--text-2)]'}`}>
              {label}
            </span>
          </Link>
        )
      })}

      {/* Telemetry — only active when inside a session */}
      {sessionKey ? (
        <Link
          href={`/sessions/${sessionKey}/telemetry`}
          className={`group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 pb-2 pt-4 transition-all ${
            pathname.includes('/telemetry') ? 'bg-white/8' : 'hover:bg-white/5'
          }`}
        >
          {pathname.includes('/telemetry') && (
            <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 translate-y-0.5 rounded-full bg-red shadow-[0_0_12px_rgba(232,0,45,0.85)]" />
          )}
          <Activity
            size={18}
            className={pathname.includes('/telemetry') ? 'text-red' : 'text-[var(--text-3)] group-hover:text-[var(--text-2)]'}
          />
          <span className={`truncate text-[10px] font-medium tracking-[0.08em] ${pathname.includes('/telemetry') ? 'text-white' : 'text-[var(--text-3)] group-hover:text-[var(--text-2)]'}`}>
            Telemetry
          </span>
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 cursor-not-allowed flex-col items-center justify-center gap-1 rounded-2xl px-2 pb-2 pt-4 opacity-35">
          <Activity size={18} className="text-[var(--text-3)]" />
          <span className="truncate text-[10px] font-medium tracking-[0.08em] text-[var(--text-3)]">Telemetry</span>
        </div>
      )}
      </div>
    </nav>
  )
}
