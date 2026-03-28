'use client'
import Link from 'next/link'

export default function TopBar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/8 bg-[rgba(7,17,27,0.82)] px-3 py-3 backdrop-blur-xl md:px-5">
      <div className="flex h-14 w-full items-center justify-between rounded-[20px] border border-white/8 bg-white/[0.03] px-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)] md:px-5">
        <Link href="/" className="flex items-center gap-3">
          <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <div className="absolute inset-y-1 left-2 w-1 rounded-full bg-red shadow-[0_0_18px_rgba(232,0,45,0.75)]" />
            <div className="absolute inset-y-1 right-2 w-1 rounded-full bg-teal/80 shadow-[0_0_16px_rgba(44,244,197,0.5)]" />
          </div>
          <div className="flex flex-col">
            <span className="font-display text-xl font-bold tracking-[0.22em] text-white">
              SLIPSTREAM
            </span>
            <span className="hidden font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-3)] md:block">
              Race Intel Console
            </span>
          </div>
        </Link>

        <div className="hidden items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-2 md:flex">
          <span className="h-2 w-2 rounded-full bg-teal shadow-[0_0_12px_rgba(44,244,197,0.65)]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-2)]">
            Telemetry Ready
          </span>
        </div>
      </div>
    </header>
  )
}
