'use client'
import Link from 'next/link'

export default function TopBar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-bg/95 backdrop-blur border-b border-border flex items-center px-5">
      <Link href="/" className="flex items-center gap-2">
        <div className="w-0.5 h-6 bg-red" />
        <span className="font-display font-bold text-xl tracking-widest text-white">
          PITWALL
        </span>
      </Link>
    </header>
  )
}