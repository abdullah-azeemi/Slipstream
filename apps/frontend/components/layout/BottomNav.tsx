'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Flag, Activity, Zap } from 'lucide-react'

const NAV = [
  { href: '/',            label: 'Home',        icon: Home     },
  { href: '/sessions',    label: 'Sessions',    icon: Flag     },
  { href: '/predictions', label: 'Predictions', icon: Zap      },
]

export default function BottomNav() {
  const pathname = usePathname()

  // Extract session key if we're inside a session
  const sessionMatch = pathname.match(/\/sessions\/(\d+)/)
  const sessionKey   = sessionMatch ? sessionMatch[1] : null

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-bg/95 backdrop-blur border-t border-border">
      <div className="max-w-5xl mx-auto flex h-16">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center gap-1 transition-all relative"
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-red rounded-full" />
              )}
              <Icon size={20} className={active ? 'text-red' : 'text-zinc-500'} />
              <span className={`text-[10px] font-medium tracking-wide ${active ? 'text-white' : 'text-zinc-600'}`}>
                {label}
              </span>
            </Link>
          )
        })}

        {/* Telemetry — only active when inside a session */}
        {sessionKey ? (
          <Link
            href={`/sessions/${sessionKey}/telemetry`}
            className="flex-1 flex flex-col items-center justify-center gap-1 transition-all relative"
          >
            {pathname.includes('/telemetry') && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-red rounded-full" />
            )}
            <Activity
              size={20}
              className={pathname.includes('/telemetry') ? 'text-red' : 'text-zinc-500'}
            />
            <span className={`text-[10px] font-medium tracking-wide ${
              pathname.includes('/telemetry') ? 'text-white' : 'text-zinc-600'
            }`}>
              Telemetry
            </span>
          </Link>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-1 opacity-30 cursor-not-allowed">
            <Activity size={20} className="text-zinc-600" />
            <span className="text-[10px] font-medium tracking-wide text-zinc-600">Telemetry</span>
          </div>
        )}
      </div>
    </nav>
  )
}
