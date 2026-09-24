'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function TopBar() {
  const pathname = usePathname()

  const navLinks = [
    { label: 'Telemetry', href: '/telemetry' },
    { label: 'Sessions', href: '/sessions' },
    { label: 'Schedule', href: '/schedule' },
    { label: 'Predictions', href: '/predictions' },
  ]

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      background: '#FFFFFF',
      borderBottom: '1px solid #F3F4F6',
      width: '100%',
    }}>
      <div className="landing-header" style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        maxWidth: 1040,
        margin: '0 auto',
        padding: '0 24px',
        background: '#FFFFFF',
      }}>
        {/* Logo */}
        <Link href="/" style={{ textDecoration: 'none', color: '#000000', fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Slipstream
        </Link>

        {/* Center Nav Links (Hidden on Mobile) */}
        <nav className="hidden-mobile" style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          {navLinks.map(item => {
            const isActive = pathname === item.href
            return (
              <Link key={item.label} href={item.href} style={{
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#000000' : '#4B5563',
                textDecoration: 'none',
                transition: 'color 150ms ease',
              }}>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Right CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/dashboard" className="hidden-xs" style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#111827',
            textDecoration: 'none',
          }}>
            Sign In
          </Link>

          <Link href="/dashboard" className="get-started-btn" style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '8px 18px',
            background: '#000000',
            color: '#FFFFFF',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 9999,
            textDecoration: 'none',
            transition: 'opacity 150ms ease',
          }}>
            Get Started
          </Link>
        </div>
      </div>
    </header>
  )
}
