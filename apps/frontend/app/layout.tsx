import type { Metadata } from 'next'
import './globals.css'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'

export const metadata: Metadata = {
  title: 'Pitwall — F1 Analytics',
  description: 'Post-race F1 intelligence.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-white min-h-screen">
        <TopBar />
        <main style={{ paddingTop: '56px', paddingBottom: '80px', minHeight: '100vh' }}>
          <div className="layout-wrapper" style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 20px' }}>
            {children}
          </div>
        </main>
        <BottomNav />
      </body>
    </html>
  )
}