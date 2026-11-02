import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Check } from '@phosphor-icons/react/dist/ssr'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'

export const clerkAppearance = {
  variables: {
    colorPrimary: '#0a0a0a',
    colorText: '#0a0a0a',
    colorTextSecondary: '#666666',
    colorBackground: '#ffffff',
    colorInputBackground: '#ffffff',
    borderRadius: '0.75rem',
    fontFamily: 'inherit',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', boxShadow: 'none', border: '1px solid #e5e5e5', borderRadius: '24px' },
    card: { boxShadow: 'none' },
    footer: { background: 'transparent' },
  },
}

export default function AuthShell({
  title,
  lede,
  children,
}: {
  title: string
  lede: string
  children: React.ReactNode
}) {
  return (
    <div className={`lp ${geist.className}`}>
      <div className="auth">
        <section className="auth-copy">
          <Link href="/" className="back body-5">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" /> Back to home
          </Link>
          <p className="nav-logo" style={{ marginTop: 'var(--sp-600)' }}>Slipstream</p>
          <h1 className="heading-2 gradient-text" style={{ marginTop: 'var(--sp-200)' }}>{title}</h1>
          <p className="body-3 muted" style={{ marginTop: 'var(--sp-200)', maxWidth: 480 }}>{lede}</p>
          <ul className="auth-points body-3">
            <li><Check size={20} weight="bold" aria-hidden="true" /> Corner by corner lap comparisons</li>
            <li><Check size={20} weight="bold" aria-hidden="true" /> Tyre strategy and race predictions</li>
            <li><Check size={20} weight="bold" aria-hidden="true" /> The Pitwall agent, with evidence for every answer</li>
          </ul>
          <div className="media-box auth-media">
            <Image
              src="/LandingPage3-poster.jpg"
              alt="A Formula 1 car cornering at speed"
              fill
              sizes="(max-width: 1024px) 0px, 520px"
              style={{ objectFit: 'cover' }}
            />
          </div>
        </section>
        <div id="main" className="auth-form">{children}</div>
      </div>
    </div>
  )
}
