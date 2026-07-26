'use client'

import { useEffect, useState } from 'react'

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
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100)
    return () => clearTimeout(timer)
  }, [])

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
      { key: 'kerb_confidence', label: 'Kerb Confidence' },
      { key: 'throttle_instability', label: 'Throttle Control' },
      { key: 'track_limits_rate', label: 'Track Limits' },
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
      { label: 'Tyre Mgmt', value: 0.72, colour: COLOURS[1] },
      { label: 'Top Speed', value: 0.78, colour: COLOURS[2] },
      { label: 'Corner Exit', value: 0.91, colour: COLOURS[3] },
    )
  }

  const topBars = bars.slice(0, 6)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {topBars.map((bar, i) => {
        const pct = Math.round(bar.value * 100)
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: '#475569',
                textTransform: 'uppercase', letterSpacing: '0.04em',
                fontFamily: 'Space Grotesk, sans-serif',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: bar.colour, flexShrink: 0,
                  boxShadow: `0 0 6px ${bar.colour}40`,
                }} />
                {bar.label}
              </span>
              <span style={{
                fontSize: 12, fontWeight: 800, color: bar.colour,
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {pct}%
              </span>
            </div>
            <div style={{
              width: '100%', height: 8, background: '#F1F5F9', borderRadius: 4, overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                width: mounted ? `${pct}%` : '0%',
                height: '100%', borderRadius: 4,
                background: `linear-gradient(90deg, ${bar.colour}, ${bar.colour}CC)`,
                transition: `width 1.2s cubic-bezier(0.16, 1, 0.3, 1) ${i * 100}ms`,
                boxShadow: `0 0 10px ${bar.colour}30`,
                position: 'relative',
              }}>
                {/* Shimmer effect */}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)',
                  borderRadius: 4,
                  animationName: mounted ? 'barShimmer' : 'none',
                  animationDuration: '2s',
                  animationTimingFunction: 'ease-in-out',
                  animationIterationCount: 'infinite',
                  animationDelay: `${i * 200 + 1200}ms`,
                  opacity: 0.5,
                }} />
              </div>
            </div>
          </div>
        )
      })}
      <style>{`
        @keyframes barShimmer {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  )
}
