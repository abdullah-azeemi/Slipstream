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
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-md border-t border-[#2A2A2A] h-16 flex items-center justify-center gap-2 md:gap-8 px-4">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className="w-20 flex flex-col items-center justify-center gap-1 transition-all relative group"
          >
            {active && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-red rounded-full shadow-[0_0_10px_rgba(232,0,45,0.8)]" />
            )}
            <Icon size={20} className={active ? 'text-red' : 'text-zinc-500 group-hover:text-zinc-300'} />
            <span className={`text-[10px] font-medium tracking-wide ${active ? 'text-white' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
              {label}
            </span>
          </Link>
        )
      })}

      {/* Telemetry — only active when inside a session */}
      {sessionKey ? (
        <Link
          href={`/sessions/${sessionKey}/telemetry`}
          className="w-20 flex flex-col items-center justify-center gap-1 transition-all relative group"
        >
          {pathname.includes('/telemetry') && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-red rounded-full shadow-[0_0_10px_rgba(232,0,45,0.8)]" />
          )}
          <Activity
            size={20}
            className={pathname.includes('/telemetry') ? 'text-red' : 'text-zinc-500 group-hover:text-zinc-300'}
          />
          <span className={`text-[10px] font-medium tracking-wide ${pathname.includes('/telemetry') ? 'text-white' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
            Telemetry
          </span>
        </Link>
      ) : (
        <div className="w-20 flex flex-col items-center justify-center gap-1 opacity-30 cursor-not-allowed">
          <Activity size={20} className="text-zinc-600" />
          <span className="text-[10px] font-medium tracking-wide text-zinc-600">Telemetry</span>
        </div>
      )}
    </nav>
  )
}
