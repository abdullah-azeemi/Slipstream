'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Flag, BarChart2, Zap } from 'lucide-react'

const NAV = [
  { href: '/',            label: 'Home',        icon: Home     },
  { href: '/sessions',    label: 'Sessions',    icon: Flag     },
  { href: '/compare',     label: 'Compare',     icon: BarChart2 },
  { href: '/predictions', label: 'Predictions', icon: Zap      },
]

export default function BottomNav() {
  const pathname = usePathname()

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
              <Icon
                size={20}
                className={active ? 'text-red' : 'text-zinc-500'}
              />
              <span className={`text-[10px] font-medium tracking-wide ${active ? 'text-white' : 'text-zinc-600'}`}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}