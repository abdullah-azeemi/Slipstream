import type { Metadata } from 'next'
import './globals.css'
import BottomNav from '@/components/layout/BottomNav'
import TopBar from '@/components/layout/TopBar'
import Sidebar from '@/components/layout/Sidebar'

export const metadata: Metadata = {
  title: 'Pitwall — F1 Analytics',
  description: 'Post-race F1 intelligence.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-white min-h-screen">
        <TopBar />
        <Sidebar />
        <main style={{ paddingTop: '56px', paddingLeft: '224px', minHeight: '100vh', paddingBottom: '32px' }}>
          <div style={{ maxWidth: '1200px', padding: '24px' }}>
            {children}
          </div>
        </main>
        <BottomNav />
      </body>
    </html>
  )
}
