'use client'

import dynamic from 'next/dynamic'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

export default function DriverRadar({
  traits,
  values,
  colour,
}: {
  traits: string[]
  values: number[]
  colour: string
}) {
  const theta = [...traits, traits[0]]
  const r = [...values, values[0]]

  return (
    <div style={{ width: '100%', height: 240 }}>
      <Plot
        data={[
          // Background reference ring
          {
            type: 'scatterpolar',
            r: [1, 1, 1, 1, 1, 1],
            theta,
            mode: 'lines',
            line: { color: '#F1F5F9', width: 1 },
            hoverinfo: 'skip',
            showlegend: false,
          },
          // 50% reference
          {
            type: 'scatterpolar',
            r: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
            theta,
            mode: 'lines',
            line: { color: '#F1F5F9', width: 1, dash: 'dot' },
            hoverinfo: 'skip',
            showlegend: false,
          },
          // Actual data
          {
            type: 'scatterpolar',
            r,
            theta,
            fill: 'toself',
            fillcolor: `${colour}14`,
            line: { color: colour, width: 2.5 },
            marker: { size: 5, color: colour, line: { color: '#fff', width: 1 } },
            hovertemplate: '%{theta}: %{r:.0%}<extra></extra>',
            showlegend: false,
          },
        ]}
        layout={{
          polar: {
            radialaxis: {
              visible: true,
              range: [0, 1.05],
              showticklabels: false,
              gridcolor: '#E2E8F0',
              gridwidth: 1,
              linecolor: 'transparent',
            },
            angularaxis: {
              gridcolor: '#E2E8F0',
              gridwidth: 1,
              linecolor: '#E2E8F0',
              linewidth: 1,
              tickfont: { family: 'Inter, sans-serif', size: 9, color: '#475569', weight: 600 },
            },
            bgcolor: 'transparent',
          },
          showlegend: false,
          margin: { t: 24, b: 24, l: 40, r: 40 },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
