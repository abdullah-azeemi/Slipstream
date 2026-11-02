import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import '@/components/landing/landing.css'

export const metadata = { title: 'Page not found | Slipstream' }

export default function NotFound() {
  return (
    <div className="lp lp-bare">
      <div id="main" className="wrap" style={{ padding: 'var(--sp-900) var(--sp-300)', textAlign: 'center', minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <p className="caption-1 muted">Error 404</p>
        <h1 className="heading-3 gradient-text" style={{ marginTop: 'var(--sp-100)' }}>This page is off the racing line</h1>
        <p className="body-3 muted" style={{ marginTop: 'var(--sp-200)', maxWidth: 480 }}>
          The page you asked for does not exist or has moved. Head back and pick up from the start.
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-100)', marginTop: 'var(--sp-400)', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/" className="btn btn-primary button-md">Back to home <ArrowRight size={16} weight="bold" aria-hidden="true" /></Link>
          <Link href="/dashboard" className="btn btn-outline button-md">Open dashboard</Link>
        </div>
      </div>
    </div>
  )
}
