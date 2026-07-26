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

export default function CompoundViolin({
  laps,
  driverNumber,
}: {
  laps: LapData[]
  driverNumber: number
}) {
  const compounds = ['SOFT', 'MEDIUM', 'HARD']

  // Group by compound: field vs driver
  const traces: Plotly.Data[] = compounds.map(compound => {
    const fieldLaps = laps.filter(l => l.compound === compound && l.driver_number !== driverNumber).map(l => l.lap_time_ms)

    return {
      type: 'box' as const,
      y: fieldLaps.length > 0 ? fieldLaps : undefined,
      name: compound,
      x0: compound,
      boxpoints: false,
      line: { color: COMPOUND_COLOURS[compound], width: 1.5 },
      fillcolor: `${COMPOUND_COLOURS[compound]}08`,
      whiskerwidth: 0.5,
      hoverinfo: 'y+name',
      showlegend: false,
      offsetgroup: compound,
      // Position driver boxes slightly right
    } as Plotly.Data
  })

  // Overlay driver-specific points
  compounds.forEach(compound => {
    const driverLaps = laps.filter(l => l.compound === compound && l.driver_number === driverNumber)
    if (driverLaps.length === 0) return

    const times = driverLaps.map(l => l.lap_time_ms)
    const sorted = [...times].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    // Individual laps as jittered points
    traces.push({
      type: 'scatter' as const,
      x: times.map(() => compound),
      y: times,
      mode: 'markers',
      marker: {
        size: 4,
        color: COMPOUND_COLOURS[compound],
        opacity: 0.6,
        line: { color: '#fff', width: 0.5 },
      },
      hovertemplate: `%{y:.0f}ms<extra>${compound}</extra>`,
      showlegend: false,
      jitter: 0.15,
    })

    // Median diamond
    traces.push({
      type: 'scatter' as const,
      x: [compound],
      y: [median],
      mode: 'markers',
      marker: { size: 8, color: COMPOUND_COLOURS[compound], symbol: 'diamond', line: { color: '#fff', width: 2 } },
      hovertemplate: `Median: %{y:.0f}ms<extra>${compound}</extra>`,
      showlegend: false,
    })
  })

  return (
    <div style={{ width: '100%', height: 240 }}>
      <Plot
        data={traces}
        layout={{
          yaxis: {
            gridcolor: '#F8FAFC', zeroline: false,
            tickfont: { size: 9, color: '#94A3B8', family: 'JetBrains Mono' },
            title: { text: 'Lap Time (ms)', font: { size: 9, color: '#94A3B8', family: 'JetBrains Mono' } },
          },
          xaxis: {
            tickfont: { size: 10, color: '#475569', family: 'JetBrains Mono' },
          },
          margin: { t: 12, b: 32, l: 56, r: 12 },
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
