'use client'

import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ClerkProvider } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import './globals.css'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'
import AuthTokenSync from '@/components/auth/AuthTokenSync'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isDashboard = pathname?.startsWith('/dashboard')
  const isAuthPage = pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body style={{ background: '#FFFFFF', color: '#0F172A', minHeight: '100vh' }} suppressHydrationWarning>
          <AuthTokenSync />
          {!isAuthPage && <TopBar />}
          <main style={{ minHeight: '100vh', paddingTop: isDashboard ? 0 : undefined, paddingBottom: isDashboard ? 0 : undefined }}>
            {children}
          </main>
          {!isAuthPage && <BottomNav />}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  )
}
