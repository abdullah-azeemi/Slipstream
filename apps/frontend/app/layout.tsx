import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import { geist, geistMono } from '@/components/landing/font'
import AppChrome from '@/components/layout/AppChrome'
import AuthTokenSync from '@/components/auth/AuthTokenSync'
import type { Metadata } from 'next'
import { SITE_NAME, SITE_URL } from '@/lib/site'

// Lets every page use relative canonical and share-image URLs.
export const metadata: Metadata = { metadataBase: new URL(SITE_URL), applicationName: SITE_NAME }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={`${geist.className} ${geistMono.variable}`} style={{ background: '#FFFFFF', color: '#0A0A0A', minHeight: '100vh' }} suppressHydrationWarning>
          <AuthTokenSync />
          <AppChrome>{children}</AppChrome>
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  )
}
