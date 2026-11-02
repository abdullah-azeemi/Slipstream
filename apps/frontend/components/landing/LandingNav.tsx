'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { ArrowRight } from '@phosphor-icons/react'

const LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Blog', href: '/blog' },
  { label: 'FAQ', href: '/#faq' },
]

export default function LandingNav({ current }: { current?: 'blog' }) {
  const [open, setOpen] = useState(false)
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const signedIn = isLoaded && isSignedIn

  return (
    <>
      <a href="#main" className="skip-link button-sm">Skip to content</a>

      <header className="nav" aria-label="Main">
        <Link href="/" className="nav-logo" onClick={() => setOpen(false)}>Slipstream</Link>

        <nav className="nav-links body-5" aria-label="Primary">
          {LINKS.map(l => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={current === 'blog' && l.label === 'Blog' ? 'page' : undefined}
              style={current === 'blog' && l.label === 'Blog' ? { color: 'var(--lp-text)' } : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="nav-actions">
          {!signedIn && (
            <Link href="/sign-in" className="btn btn-ghost button-sm hide-sm">Sign in</Link>
          )}
          <Link href={signedIn ? '/dashboard' : '/sign-up'} className="btn btn-primary button-sm">
            {signedIn ? 'Open dashboard' : 'Get started'}
          </Link>
          <button
            type="button"
            className="btn btn-ghost nav-toggle"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(o => !o)}
          >
            <span className="menu-icon" aria-hidden="true"><span /><span /></span>
          </button>
        </div>
      </header>

      <div id="mobile-menu" className="menu-panel" data-open={open} aria-hidden={!open}>
        {[...LINKS, ...(signedIn ? [] : [{ label: 'Sign in', href: '/sign-in' }])].map((l, i) => (
          <Link
            key={l.href}
            href={l.href}
            className="menu-link heading-4"
            style={{ ['--i' as string]: i }}
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
          >
            {l.label}
          </Link>
        ))}
        <Link
          href={signedIn ? '/dashboard' : '/sign-up'}
          className="menu-link btn btn-primary button-lg"
          style={{ ['--i' as string]: LINKS.length + 1, alignSelf: 'flex-start' }}
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
        >
          {signedIn ? 'Open dashboard' : 'Create free account'} <ArrowRight size={20} weight="bold" aria-hidden="true" />
        </Link>
      </div>
    </>
  )
}
