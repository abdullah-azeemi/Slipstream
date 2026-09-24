'use client'

import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ClerkProvider } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import './globals.css'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isDashboard = pathname?.startsWith('/dashboard')
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body style={{ background: '#FFFFFF', color: '#0F172A', minHeight: '100vh' }} suppressHydrationWarning>
          <TopBar />
          <main style={{ minHeight: '100vh', paddingTop: isDashboard ? 0 : undefined, paddingBottom: isDashboard ? 0 : undefined }}>
            {children}
          </main>
          <BottomNav />
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  )
}