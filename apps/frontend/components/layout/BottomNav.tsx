'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Flag, Users, Zap } from 'lucide-react'

const NAV = [
  { href: '/',            label: 'Home',        icon: Home  },
  { href: '/sessions',    label: 'Sessions',    icon: Flag  },
  { href: '/compare',     label: 'Compare',     icon: Users },
  { href: '/predictions', label: 'Predictions', icon: Zap   },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-surface border-t border-border">
      <div className="flex h-full">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
            >
              <Icon
                size={20}
                className={active ? 'text-red' : 'text-zinc-500'}
              />
              <span
                className={`text-[10px] font-medium tracking-wide ${
                  active ? 'text-red' : 'text-zinc-500'
                }`}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
