'use client'

import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { usePathname } from 'next/navigation'
import './globals.css'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isDashboard = pathname?.startsWith('/dashboard')

  return (
    <html lang="en">
      <body style={{ background: '#F8FAFC', color: '#0F172A', minHeight: '100vh' }}>
        <TopBar />
        {/* 
          Landing page manages its own spacing (hero bleeds to top of viewport).
          Inner pages use layout-wrapper for padding.
          We set paddingTop = 60px (nav height) on main so inner pages clear the nav.
          Landing page overrides this with a negative marginTop on its first section.
        */}
        <main style={{ paddingTop: 60, paddingBottom: isDashboard ? 48 : 80, minHeight: '100vh' }}>
          {children}
        </main>
        {!isDashboard && <BottomNav />}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}