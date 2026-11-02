'use client'

import LandingNav from '@/components/landing/LandingNav'
import { geist, geistMono } from '@/components/landing/font'

/** The product navigation shown on every signed in page. */
export default function TopBar() {
  return (
    <div className={`lp lp-bare ${geist.className} ${geistMono.variable}`}>
      <LandingNav app />
    </div>
  )
}
