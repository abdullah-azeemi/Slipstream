'use client'

import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ClerkProvider } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import './globals.css'
import { geist, geistMono } from '@/components/landing/font'
import TopBar from '@/components/layout/TopBar'
import AuthTokenSync from '@/components/auth/AuthTokenSync'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLanding =
    pathname === '/' ||
    pathname?.startsWith('/blog') ||
    pathname?.startsWith('/privacy') ||
    pathname?.startsWith('/terms')
  const isAuthPage = pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={`${geist.className} ${geistMono.variable}`} style={{ background: '#FFFFFF', color: '#0A0A0A', minHeight: '100vh' }} suppressHydrationWarning>
          <AuthTokenSync />
          {!isAuthPage && !isLanding && <TopBar />}
          <main id={isLanding || isAuthPage ? undefined : 'main'} style={{ minHeight: '100vh', paddingTop: isLanding || isAuthPage ? 0 : 72 }}>
            {children}
          </main>
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  )
}
