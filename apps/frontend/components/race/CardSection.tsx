import type { ReactNode } from 'react'

export default function CardSection({
  eyebrowLabel,
  title,
  subtitle,
  right,
  children,
}: {
  eyebrowLabel: string
  title: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  accent?: boolean
}) {
  return (
    <section className="panel" aria-label={eyebrowLabel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 'var(--sp-300)' }}>
        <div style={{ maxWidth: 640 }}>
          <h2 className="heading-5">{title}</h2>
          {subtitle ? <p className="body-6 muted" style={{ marginTop: 'var(--sp-50)' }}>{subtitle}</p> : null}
        </div>
        {right ?? null}
      </div>
      {children}
    </section>
  )
}
