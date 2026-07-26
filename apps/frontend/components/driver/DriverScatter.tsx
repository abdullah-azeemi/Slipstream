'use client'

import dynamic from 'next/dynamic'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface DriverEmb {
  driver_number: number
  embedding: number[]
  abbreviation: string
  full_name: string
  team_colour: string | null
}

function tc(colour: string | null): string {
  if (!colour) return '#CBD5E1'
  return colour.startsWith('#') ? colour : `#${colour}`
}

export default function DriverScatter({
  allDrivers,
  selectedDriver,
  colour,
}: {
  allDrivers: DriverEmb[]
  selectedDriver: number
  colour: string
}) {
  const selected = allDrivers.find(d => d.driver_number === selectedDriver)
  const others = allDrivers.filter(d => d.driver_number !== selectedDriver)

  const nearest = selected
    ? others
        .map(d => ({
          ...d,
          dist: Math.sqrt(
            d.embedding.reduce((s, v, i) => s + (v - selected.embedding[i]) ** 2, 0)
          ),
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5)
    : []

  const nearestNums = new Set(nearest.map(d => d.driver_number))
  const far = others.filter(d => !nearestNums.has(d.driver_number))

  const traces: Plotly.Data[] = [
    // Far drivers — small, muted, coloured by team
    {
      type: 'scatter',
      mode: 'text+markers',
      x: far.map(d => d.embedding[0]),
      y: far.map(d => d.embedding[1]),
      text: far.map(d => d.abbreviation),
      textposition: 'top center',
      textfont: { size: 8, color: far.map(d => tc(d.team_colour)), family: 'JetBrains Mono' },
      hovertemplate: '%{text}<extra></extra>',
      marker: {
        size: 6,
        color: far.map(d => tc(d.team_colour)),
        opacity: 0.3,
        line: { color: '#fff', width: 0.5 },
      },
      showlegend: false,
    },
    // Nearest neighbours — medium, bordered
    {
      type: 'scatter',
      mode: 'text+markers',
      x: nearest.map(d => d.embedding[0]),
      y: nearest.map(d => d.embedding[1]),
      text: nearest.map(d => d.abbreviation),
      textposition: 'top center',
      textfont: { size: 9, color: nearest.map(d => tc(d.team_colour)), family: 'JetBrains Mono' },
      hovertemplate: '%{text}<extra>Similar</extra>',
      marker: {
        size: 9,
        color: '#fff',
        line: { color: nearest.map(d => tc(d.team_colour)), width: 2 },
      },
      showlegend: false,
    },
  ]

  if (selected) {
    // Connection lines
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: nearest.flatMap(d => [selected.embedding[0], d.embedding[0], null]),
      y: nearest.flatMap(d => [selected.embedding[1], d.embedding[1], null]),
      line: { color: '#E2E8F0', width: 1, dash: 'dot' },
      hoverinfo: 'skip',
      showlegend: false,
    })
    // Selected — big, team colour, with glow
    traces.push({
      type: 'scatter',
      mode: 'text+markers',
      x: [selected.embedding[0]],
      y: [selected.embedding[1]],
      text: [selected.abbreviation],
      textposition: 'top center',
      textfont: { size: 11, color: colour, family: 'JetBrains Mono' },
      hovertemplate: '%{text}<extra>You</extra>',
      marker: {
        size: 16,
        color: colour,
        line: { color: '#fff', width: 3 },
        symbol: 'circle',
      },
      showlegend: false,
    })
  }

  return (
    <div style={{ width: '100%', height: 240 }}>
      <Plot
        data={traces}
        layout={{
          xaxis: {
            gridcolor: '#F8FAFC', zeroline: true, zerolinecolor: '#E2E8F0', zerolinewidth: 1,
            showticklabels: false, showgrid: true, gridwidth: 1,
            title: { text: 'PC1 — Pace', font: { size: 9, color: '#94A3B8', family: 'JetBrains Mono' } },
          },
          yaxis: {
            gridcolor: '#F8FAFC', zeroline: true, zerolinecolor: '#E2E8F0', zerolinewidth: 1,
            showticklabels: false, showgrid: true, gridwidth: 1,
            title: { text: 'PC2 — Racecraft', font: { size: 9, color: '#94A3B8', family: 'JetBrains Mono' } },
          },
          margin: { t: 12, b: 40, l: 40, r: 12 },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          font: { family: 'Inter, sans-serif' },
          hovermode: 'closest',
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
