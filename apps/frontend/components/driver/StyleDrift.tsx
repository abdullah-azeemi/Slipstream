'use client'

import dynamic from 'next/dynamic'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

export default function StyleDrift({
  currentYear,
}: {
  currentYear: number
}) {
  const years = [2022, 2023, 2024]
  const pc1Values = [-0.8, -0.2, 0.6]
  const pc2Values = [0.3, 0.5, 0.8]

  return (
    <div style={{ width: '100%', height: 220 }}>
      <Plot
        data={[
          {
            type: 'scatter',
            mode: 'lines',
            x: pc1Values,
            y: pc2Values,
            line: { color: '#E8002D', width: 2, shape: 'spline' },
            hoverinfo: 'skip',
            showlegend: false,
          },
          {
            type: 'scatter',
            mode: 'text+markers',
            x: pc1Values,
            y: pc2Values,
            text: years.map(String),
            textposition: 'top center',
            textfont: {
              size: 11,
              family: 'JetBrains Mono, monospace',
              color: years.map((y) => (y === currentYear ? '#E8002D' : '#94A3B8')),
            },
            marker: {
              size: years.map((y) => (y === currentYear ? 10 : 7)),
              color: years.map((y) => (y === currentYear ? '#E8002D' : '#CBD5E1')),
              line: {
                color: years.map((y) => (y === currentYear ? '#fff' : 'transparent')),
                width: 2,
              },
            },
            hovertemplate: '%{text}<extra></extra>',
            showlegend: false,
          },
        ]}
        layout={{
          xaxis: {
            title: { text: 'PC1', font: { size: 10, color: '#94A3B8', family: 'JetBrains Mono' } },
            gridcolor: '#F1F5F9',
            zeroline: true,
            zerolinecolor: '#E2E8F0',
            showticklabels: false,
          },
          yaxis: {
            title: { text: 'PC2', font: { size: 10, color: '#94A3B8', family: 'JetBrains Mono' } },
            gridcolor: '#F1F5F9',
            zeroline: true,
            zerolinecolor: '#E2E8F0',
            showticklabels: false,
          },
          margin: { t: 16, b: 48, l: 48, r: 16 },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          font: { family: 'Inter, sans-serif' },
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
