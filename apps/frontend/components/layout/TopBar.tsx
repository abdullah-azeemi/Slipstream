'use client'
import { Bell } from 'lucide-react'
import Link from 'next/link'

export default function TopBar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-bg/95 backdrop-blur border-b border-border flex items-center justify-between px-5">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2">
        <div className="w-0.5 h-6 bg-red" />
        <span className="font-display font-bold text-xl tracking-widest text-white">
          PITWALL
        </span>
      </Link>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 bg-red/10 border border-red/30 rounded px-2.5 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-red animate-pulse" />
          <span className="text-red text-xs font-mono font-medium tracking-wider">
            LIVE TIMING
          </span>
        </div>
        <button className="relative text-zinc-400 hover:text-white transition-colors">
          <Bell size={18} />
        </button>
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-surface2 border border-border flex items-center justify-center text-xs font-bold text-zinc-400">
          P
        </div>
      </div>
    </header>
  )
}