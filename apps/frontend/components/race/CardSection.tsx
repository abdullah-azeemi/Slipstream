import type { ReactNode } from 'react'

const eyebrow = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#9CA3AF',
} as const

export default function CardSection({
  eyebrowLabel,
  title,
  subtitle,
  right,
  children,
  accent = false,
}: {
  eyebrowLabel: string
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  accent?: boolean
}) {
  return (
    <section style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 20, padding: '22px 22px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ maxWidth: 640 }}>
          <div style={{ ...eyebrow, marginBottom: 7, color: accent ? '#DC2626' : '#9CA3AF' }}>{eyebrowLabel}</div>
          <h2 style={{ margin: 0, color: '#111827', fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 'clamp(1.15rem, 2.2vw, 1.45rem)', letterSpacing: '-0.01em' }}>{title}</h2>
          {subtitle ? (
            <p style={{ margin: '7px 0 0', color: '#6B7280', fontFamily: 'Inter, sans-serif', fontSize: 12.5, lineHeight: 1.65 }}>{subtitle}</p>
          ) : null}
        </div>
        {right ?? null}
      </div>
      {children}
    </section>
  )
}
