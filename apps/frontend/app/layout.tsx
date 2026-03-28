import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'

export const metadata: Metadata = {
  title: 'Slipstream — F1 Analytics',
  description: 'Post-race F1 intelligence.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="app-shell bg-bg text-white min-h-screen">
        <TopBar />
        <main>
          <div className="layout-wrapper">
            {children}
          </div>
        </main>
        <BottomNav />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
