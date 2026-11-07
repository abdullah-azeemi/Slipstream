'use client'

import { usePathname } from 'next/navigation'
import TopBar from '@/components/layout/TopBar'

/** Client-only part of the shell: it needs the pathname to decide which chrome to show. */
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLanding =
    pathname === '/' ||
    pathname?.startsWith('/blog') ||
    pathname?.startsWith('/privacy') ||
    pathname?.startsWith('/terms')
  const isAuthPage = pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')
  const bare = isLanding || isAuthPage
  return (
    <>
      {!bare && <TopBar />}
      <main id={bare ? undefined : 'main'} style={{ minHeight: '100vh', paddingTop: bare ? 0 : 72 }}>
        {children}
      </main>
    </>
  )
}
