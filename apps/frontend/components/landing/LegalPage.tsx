import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import LandingNav from '@/components/landing/LandingNav'
import LandingFooter from '@/components/landing/LandingFooter'

export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className={`lp ${geist.className}`}>
      <LandingNav />
      <div id="main" className="wrap">
        <article className="article">
          <h1 className="heading-3">{title}</h1>
          <p className="caption-1 muted" style={{ marginTop: 'var(--sp-100)' }}>Last updated {updated}</p>
          <div className="prose">{children}</div>
        </article>
      </div>
      <LandingFooter />
    </div>
  )
}
