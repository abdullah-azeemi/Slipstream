'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { UserButton, useAuth } from '@clerk/nextjs'
import { ArrowRight } from '@phosphor-icons/react'

const SITE_LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Blog', href: '/blog' },
  { label: 'FAQ', href: '/#faq' },
]

const APP_LINKS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Telemetry', href: '/telemetry' },
  { label: 'Sessions', href: '/sessions' },
  { label: 'Drivers', href: '/drivers' },
  { label: 'Schedule', href: '/schedule' },
  { label: 'Predictions', href: '/predictions' },
  { label: 'Agent', href: '/agent' },
]

/**
 * One navigation for the whole product. `app` switches it to the signed in product links
 * (used on every page behind the sign in wall). Without it, it is the marketing nav.
 */
export default function LandingNav({ app = false }: { app?: boolean }) {
  const [open, setOpen] = useState(false)
  const { isLoaded, isSignedIn } = useAuth()
  const pathname = usePathname() ?? '/'

  const links = app ? APP_LINKS : SITE_LINKS
  const isActive = (href: string) => {
    if (href.startsWith('/#')) return false
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  // Close the menu when a navigation happens or the viewport grows past the mobile layout.
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 861px)')
    const onChange = () => { if (mq.matches) setOpen(false) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // While the mobile menu is open, make everything behind it inert so Tab cannot leave the menu.
  useEffect(() => {
    if (!open) return
    const behind: HTMLElement[] = app
      ? Array.from(document.querySelectorAll<HTMLElement>('body > main'))
      : (Array.from(document.querySelector('.lp')?.children ?? []) as HTMLElement[]).filter(
          el => !el.classList.contains('nav') && el.id !== 'mobile-menu',
        )
    behind.forEach(el => el.setAttribute('inert', ''))
    return () => behind.forEach(el => el.removeAttribute('inert'))
  }, [open, app])

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
  const ctaHref = signedIn ? '/dashboard' : '/sign-up'

  return (
    <>
      <a href="#main" className="skip-link button-sm">Skip to content</a>

      <header className="nav" aria-label="Main">
        <Link href="/" className="nav-logo" onClick={() => setOpen(false)}>Slipstream</Link>

        <nav className="nav-links body-5" aria-label="Primary">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? 'page' : undefined}
              style={isActive(l.href) ? { color: 'var(--lp-text)', fontWeight: 600 } : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="nav-actions">
          {app ? (
            signedIn ? <span className="nav-user"><UserButton /></span> : (
              <Link href="/sign-in" className="btn btn-primary button-sm">Sign in</Link>
            )
          ) : (
            <>
              {!signedIn && <Link href="/sign-in" className="btn btn-ghost button-sm hide-sm">Sign in</Link>}
              <Link href={ctaHref} className="btn btn-primary button-sm">
                {signedIn ? 'Open dashboard' : 'Get started'}
              </Link>
            </>
          )}
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
        {[...links, ...(!app && !signedIn ? [{ label: 'Sign in', href: '/sign-in' }] : [])].map((l, i) => (
          <Link
            key={l.href}
            href={l.href}
            className="menu-link heading-4"
            style={{ ['--i' as string]: i }}
            tabIndex={open ? 0 : -1}
            aria-current={isActive(l.href) ? 'page' : undefined}
            onClick={() => setOpen(false)}
          >
            {l.label}
          </Link>
        ))}
        {!app && (
          <Link
            href={ctaHref}
            className="menu-link btn btn-primary button-lg"
            style={{ ['--i' as string]: links.length + 1, alignSelf: 'flex-start' }}
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
          >
            {signedIn ? 'Open dashboard' : 'Create free account'} <ArrowRight size={20} weight="bold" aria-hidden="true" />
          </Link>
        )}
      </div>
    </>
  )
}
