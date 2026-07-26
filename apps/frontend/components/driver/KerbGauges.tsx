'use client'

interface Features {
  throttle_instability?: number | null
  kerb_confidence?: number | null
  track_limits_rate?: number | null
}

function getColour(value: number, inverted = false): string {
  const v = inverted ? 1 - value : value
  if (v < 0.33) return '#10B981' // green
  if (v < 0.66) return '#F59E0B' // amber
  return '#EF4444' // red
}

function getLabel(value: number, inverted = false): { text: string; colour: string } {
  const v = inverted ? 1 - value : value
  if (v < 0.33) return { text: 'Low', colour: '#10B981' }
  if (v < 0.66) return { text: 'Med', colour: '#F59E0B' }
  return { text: 'High', colour: '#EF4444' }
}

function GaugeBar({ label, value, inverted }: { label: string; value: number; inverted?: boolean }) {
  const pct = Math.max(0, Math.min(100, value * 100))
  const barColour = getColour(value, inverted)
  const { text: statusText, colour: statusColour } = getLabel(value, inverted)

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: statusColour,
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {statusText}
        </span>
      </div>
      <div
        style={{
          width: '100%',
          height: 4,
          background: 'var(--surface-3)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: barColour,
            borderRadius: 2,
            transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>
    </div>
  )
}

export default function KerbGauges({ features }: { features: Features | null }) {
  const throttleInstability = features?.throttle_instability ?? 0.15
  const kerbConfidence = features?.kerb_confidence ?? 0.85
  const trackLimitsRate = features?.track_limits_rate ?? 0.42

  return (
    <div>
      <GaugeBar label="Throttle Instability" value={throttleInstability} inverted />
      <GaugeBar label="Kerb Confidence" value={kerbConfidence} />
      <GaugeBar label="Track Limits Risk" value={trackLimitsRate} inverted />
    </div>
  )
}
