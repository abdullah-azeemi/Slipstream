'use client'

import dynamic from 'next/dynamic'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface DriverEmb {
  driver_number: number
  embedding: number[]
  abbreviation: string
  full_name: string
  team_colour: string | null
  archetype?: string | null
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

  // Get axis labels from embeddings
  const axisLabels = {
    x: 'PC1 — Driving Style',
    y: 'PC2 — Performance Profile',
  }

  const traces: Plotly.Data[] = [
    // Far drivers — small, muted, coloured by team
    {
      type: 'scatter',
      mode: 'text+markers',
      x: far.map(d => d.embedding[0]),
      y: far.map(d => d.embedding[1]),
      text: far.map(d => d.abbreviation),
      textposition: 'top center',
      textfont: { size: 9, color: far.map(d => `${tc(d.team_colour)}90`), family: 'JetBrains Mono' },
      hovertemplate: far.map(d => `<b>${d.full_name}</b><br>${d.archetype || 'Unknown'}<extra></extra>`),
      marker: {
        size: 7,
        color: far.map(d => tc(d.team_colour)),
        opacity: 0.25,
        line: { color: '#fff', width: 1 },
      },
      showlegend: false,
    },
    // Nearest neighbours — medium, bordered, with team colours
    {
      type: 'scatter',
      mode: 'text+markers',
      x: nearest.map(d => d.embedding[0]),
      y: nearest.map(d => d.embedding[1]),
      text: nearest.map(d => d.abbreviation),
      textposition: 'top center',
      textfont: { size: 10, color: nearest.map(d => tc(d.team_colour)), family: 'JetBrains Mono, monospace', weight: 700 },
      hovertemplate: nearest.map(d => `<b>${d.full_name}</b><br>Similarity: ${((1 - d.dist) * 100).toFixed(0)}%<extra>Similar</extra>`),
      marker: {
        size: 11,
        color: nearest.map(d => `${tc(d.team_colour)}20`),
        line: { color: nearest.map(d => tc(d.team_colour)), width: 2.5 },
      },
      showlegend: false,
    },
  ]

  if (selected) {
    // Connection lines — team colour
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: nearest.flatMap(d => [selected.embedding[0], d.embedding[0], null]),
      y: nearest.flatMap(d => [selected.embedding[1], d.embedding[1], null]),
      line: { color: `${colour}30`, width: 1.5, dash: 'dot' },
      hoverinfo: 'skip',
      showlegend: false,
    })
    // Selected — big, team colour, prominent
    traces.push({
      type: 'scatter',
      mode: 'text+markers',
      x: [selected.embedding[0]],
      y: [selected.embedding[1]],
      text: [selected.abbreviation],
      textposition: 'top center',
      textfont: { size: 12, color: colour, family: 'JetBrains Mono, monospace', weight: 900 },
      hovertemplate: `<b>${selected.full_name}</b><extra>Selected</extra>`,
      marker: {
        size: 18,
        color: colour,
        line: { color: '#fff', width: 3 },
        symbol: 'circle',
      },
      showlegend: false,
    })
  }

  return (
    <div style={{ width: '100%', height: 320 }}>
      <Plot
        data={traces}
        layout={{
          xaxis: {
            gridcolor: '#F8FAFC', zeroline: true, zerolinecolor: '#E2E8F0', zerolinewidth: 1,
            showticklabels: false, showgrid: true, gridwidth: 1,
            title: { text: axisLabels.x, font: { size: 10, color: '#94A3B8', family: 'Space Grotesk, sans-serif' } },
          },
          yaxis: {
            gridcolor: '#F8FAFC', zeroline: true, zerolinecolor: '#E2E8F0', zerolinewidth: 1,
            showticklabels: false, showgrid: true, gridwidth: 1,
            title: { text: axisLabels.y, font: { size: 10, color: '#94A3B8', family: 'Space Grotesk, sans-serif' } },
          },
          margin: { t: 12, b: 44, l: 44, r: 12 },
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
