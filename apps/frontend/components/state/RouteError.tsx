'use client'

interface RouteErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function RouteError({ reset }: RouteErrorProps) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#E8002D', textTransform: 'uppercase', marginBottom: 12 }}>
          Something went wrong
        </div>
        <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 400, color: '#0F172A', margin: '0 0 12px' }}>
          We couldn&apos;t load this page
        </h1>
        <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6, marginBottom: 24 }}>
          Pitwall hit an unexpected error. Try again, or head back to the dashboard.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{ background: '#0F172A', color: '#FFFFFF', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Retry
          </button>
          <a
            href="/dashboard"
            style={{ display: 'inline-flex', alignItems: 'center', padding: '10px 20px', fontSize: 13, fontWeight: 700, color: '#0F172A', borderRadius: 10, textDecoration: 'none', border: '1px solid #CBD5E1' }}
          >
            Dashboard
          </a>
        </div>
      </div>
    </div>
  )
}