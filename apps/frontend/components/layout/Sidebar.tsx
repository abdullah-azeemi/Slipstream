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

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex flex-col fixed left-0 top-14 bottom-0 w-56 bg-surface border-r border-border z-40">
      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-red/10 text-white border-l-2 border-red pl-[10px]'
                  : 'text-zinc-500 hover:text-white hover:bg-surface2'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="text-[10px] text-zinc-600 font-mono">PITWALL v0.1.0</div>
        <div className="text-[10px] text-zinc-700 mt-0.5">Apache 2.0 · Open Source</div>
      </div>
    </aside>
  )
}
