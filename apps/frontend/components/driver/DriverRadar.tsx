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
    <div style={{ width: '100%', height: 300 }}>
      <Plot
        data={[
          // Background reference ring — team colour tinted
          {
            type: 'scatterpolar',
            r: Array(theta.length).fill(1),
            theta,
            mode: 'lines',
            line: { color: `${colour}18`, width: 1.5 },
            hoverinfo: 'skip',
            showlegend: false,
          },
          // 75% reference
          {
            type: 'scatterpolar',
            r: Array(theta.length).fill(0.75),
            theta,
            mode: 'lines',
            line: { color: '#F1F5F9', width: 1 },
            hoverinfo: 'skip',
            showlegend: false,
          },
          // 50% reference
          {
            type: 'scatterpolar',
            r: Array(theta.length).fill(0.5),
            theta,
            mode: 'lines',
            line: { color: '#F1F5F9', width: 1, dash: 'dot' },
            hoverinfo: 'skip',
            showlegend: false,
          },
          // 25% reference
          {
            type: 'scatterpolar',
            r: Array(theta.length).fill(0.25),
            theta,
            mode: 'lines',
            line: { color: '#F8FAFC', width: 1 },
            hoverinfo: 'skip',
            showlegend: false,
          },
          // Actual data — filled area
          {
            type: 'scatterpolar',
            r,
            theta,
            fill: 'toself',
            fillcolor: `${colour}18`,
            line: { color: colour, width: 2.5, shape: 'spline' },
            marker: {
              size: 7,
              color: colour,
              line: { color: '#fff', width: 2 },
            },
            hovertemplate: '<b>%{theta}</b><br>%{r:.0%}<extra></extra>',
            showlegend: false,
          },
        ]}
        layout={{
          polar: {
            radialaxis: {
              visible: true,
              range: [0, 1.08],
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
              tickfont: { family: 'Space Grotesk, sans-serif', size: 10, color: '#475569', weight: 600 },
            },
            bgcolor: 'transparent',
          },
          showlegend: false,
          margin: { t: 28, b: 28, l: 48, r: 48 },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
