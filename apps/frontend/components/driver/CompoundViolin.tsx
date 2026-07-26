'use client'

import dynamic from 'next/dynamic'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface LapData {
  driver_number: number
  compound: string
  lap_time_ms: number
}

const COMPOUND_COLOURS: Record<string, string> = {
  SOFT: '#E8002D',
  MEDIUM: '#FBBF24',
  HARD: '#94A3B8',
}

const COMPOUND_FILL: Record<string, string> = {
  SOFT: '#E8002D15',
  MEDIUM: '#FBBF2415',
  HARD: '#94A3B815',
}


export default function CompoundViolin({
  laps,
  driverNumber,
}: {
  laps: LapData[]
  driverNumber: number
}) {
  const compounds = ['SOFT', 'MEDIUM', 'HARD']

  // Convert ms to seconds for better readability
  const toSec = (ms: number) => ms / 1000

  const traces: Plotly.Data[] = compounds.map(compound => {
    const fieldLaps = laps.filter(l => l.compound === compound && l.driver_number !== driverNumber).map(l => toSec(l.lap_time_ms))

    return {
      type: 'box' as const,
      y: fieldLaps.length > 0 ? fieldLaps : undefined,
      name: compound,
      x0: compound,
      boxpoints: false,
      line: { color: COMPOUND_COLOURS[compound], width: 2 },
      fillcolor: COMPOUND_FILL[compound],
      whiskerwidth: 0.6,
      hovertemplate: '%{y:.3f}s<extra>Field</extra>',
      showlegend: false,
      offsetgroup: compound,
    } as Plotly.Data
  })

  // Overlay driver-specific points
  compounds.forEach(compound => {
    const driverLaps = laps.filter(l => l.compound === compound && l.driver_number === driverNumber)
    if (driverLaps.length === 0) return

    const times = driverLaps.map(l => toSec(l.lap_time_ms))
    const sorted = [...times].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    // Individual laps as jittered points
    traces.push({
      type: 'scatter' as const,
      x: times.map(() => compound),
      y: times,
      mode: 'markers',
      marker: {
        size: 5,
        color: COMPOUND_COLOURS[compound],
        opacity: 0.5,
        line: { color: '#fff', width: 1 },
      },
      hovertemplate: `%{y:.3f}s<extra>${compound}</extra>`,
      showlegend: false,
      jitter: 0.2,
    })

    // Median diamond — larger with glow
    traces.push({
      type: 'scatter' as const,
      x: [compound],
      y: [median],
      mode: 'markers',
      marker: {
        size: 10,
        color: COMPOUND_COLOURS[compound],
        symbol: 'diamond',
        line: { color: '#fff', width: 2 },
      },
      hovertemplate: `Median: %{y:.3f}s<extra>${compound} — Driver</extra>`,
      showlegend: false,
    })
  })

  return (
    <div style={{ width: '100%', height: 280 }}>
      <Plot
        data={traces}
        layout={{
          yaxis: {
            gridcolor: '#F1F5F9', zeroline: false,
            tickfont: { size: 10, color: '#94A3B8', family: 'JetBrains Mono' },
            title: { text: 'Lap Time (seconds)', font: { size: 10, color: '#94A3B8', family: 'Space Grotesk, sans-serif' } },
            tickformat: '.1f',
          },
          xaxis: {
            tickfont: { size: 11, color: '#475569', family: 'Space Grotesk, sans-serif', weight: 600 },
          },
          margin: { t: 12, b: 36, l: 60, r: 12 },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          font: { family: 'Inter, sans-serif' },
          showlegend: false,
          boxmode: 'group',
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
