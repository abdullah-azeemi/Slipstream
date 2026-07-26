'use client'

interface Embedding {
  embedding: number[]
  pca_loadings: Record<string, { feature: string; weight: number }[]>
  axis_labels: Record<string, { label: string; top_features: { feature: string; weight: number }[] }>
}

interface Features {
  [key: string]: number | null | undefined
}

const COLOURS = ['#E8002D', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#06B6D4']

export default function PerformanceDrivers({
  embedding,
  features,
}: {
  embedding: Embedding | null
  features: Features | null
}) {
  const bars: { label: string; value: number; colour: string }[] = []

  if (embedding?.axis_labels) {
    Object.values(embedding.axis_labels).forEach((axis, i) => {
      const topFeature = axis.top_features[0]
      if (topFeature) {
        bars.push({
          label: axis.label,
          value: Math.min(1, Math.abs(topFeature.weight) * 2),
          colour: COLOURS[i % COLOURS.length],
        })
      }
    })
  }

  if (features) {
    const featureBars = [
      { key: 'kerb_confidence', label: 'Kerb' },
      { key: 'throttle_instability', label: 'Throttle' },
      { key: 'track_limits_rate', label: 'Limits' },
    ]
    featureBars.forEach(fb => {
      const val = features[fb.key]
      if (val != null) {
        bars.push({ label: fb.label, value: Math.max(0, Math.min(1, val)), colour: COLOURS[bars.length % COLOURS.length] })
      }
    })
  }

  if (bars.length === 0) {
    bars.push(
      { label: 'Braking', value: 0.85, colour: COLOURS[0] },
      { label: 'Tyres', value: 0.72, colour: COLOURS[1] },
      { label: 'Speed', value: 0.78, colour: COLOURS[2] },
      { label: 'Exit', value: 0.91, colour: COLOURS[3] },
    )
  }

  const topBars = bars.slice(0, 6)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {topBars.map((bar, i) => {
        const pct = Math.round(bar.value * 100)
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, color: '#475569',
                textTransform: 'uppercase', letterSpacing: '0.04em',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {bar.label}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 800, color: bar.colour,
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {pct}
              </span>
            </div>
            <div style={{
              width: '100%', height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden',
            }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 3,
                background: bar.colour,
                transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
                boxShadow: `0 0 8px ${bar.colour}30`,
              }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
