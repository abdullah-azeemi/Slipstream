import Link from 'next/link'

const LINKS = [
  { label: 'Telemetry', href: '/telemetry' },
  { label: 'Sessions', href: '/sessions' },
  { label: 'Schedule', href: '/schedule' },
  { label: 'Predictions', href: '/predictions' },
  { label: 'Agent', href: '/agent' },
  { label: 'Blog', href: '/blog' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
  { label: 'GitHub', href: 'https://github.com/abdullah-azeemi/Slipstream' },
]

export default function LandingFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-inner">
          <div>
            <div className="title-3">Slipstream</div>
            <div className="body-6 muted">Open source Formula 1 analytics.</div>
          </div>
          <nav aria-label="Footer" className="body-5">
            {LINKS.map(l => (
              <Link key={l.href} href={l.href}>{l.label}</Link>
            ))}
          </nav>
        </div>
        <p className="fine caption-4">
          Slipstream is an independent project. It is not affiliated with, or endorsed by, Formula 1
          or any team, driver or governing body. Formula 1 and related marks belong to their owners.
        </p>
        <p className="fine caption-4">© 2026 Slipstream</p>
      </div>
    </footer>
  )
}
