import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import { geist, geistMono } from '@/components/landing/font'
import AppChrome from '@/components/layout/AppChrome'
import AuthTokenSync from '@/components/auth/AuthTokenSync'

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
