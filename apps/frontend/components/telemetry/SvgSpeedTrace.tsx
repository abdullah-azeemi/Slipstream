import React from 'react'

const W = 880
const H = 220

function ptToSVG(i: number, v: number, total: number, yMin: number, yRange: number) {
  const x = (i / total) * W
  const y = H - ((v - yMin) / yRange) * H
  return `${x.toFixed(1)},${y.toFixed(1)}`
}

function buildPath(trace: number[], yMin: number, yRange: number) {
  return trace.map((v, i) => (i === 0 ? 'M' : 'L') + ptToSVG(i, v, trace.length - 1, yMin, yRange)).join(' ')
}

type SvgSpeedTraceProps = {
  driverData: { interp: { speed: number[] }, colour: string, abbr: string }[]
  tooltipNx: number | null
  onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void
  onMouseLeave: () => void
}

export default function SvgSpeedTrace({ driverData, tooltipNx, onMouseMove, onMouseLeave }: SvgSpeedTraceProps) {
  const yMin = 60
  const yMax = 350
  const yRange = yMax - yMin

  const trace1 = driverData[0]?.interp.speed ?? []
  const trace2 = driverData[1]?.interp.speed ?? []

  return (
    <div style={{ padding: '8px 0', overflowX: 'auto', background: '#FFFFFF' }}>
      <div style={{ minWidth: 600, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 44, height: H + 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '8px 0', pointerEvents: 'none' }}>
          {[300, 250, 200, 150, 100].map(v => (
            <div key={v} style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', textAlign: 'right', paddingRight: 8, fontFamily: 'monospace' }}>{v}</div>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H + 16}
          style={{ display: 'block', padding: '8px 18px 0 44px', boxSizing: 'border-box', cursor: 'crosshair' }}
          preserveAspectRatio="none"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        >
          {/* Grid lines */}
          {[300, 250, 200, 150, 100].map(v => {
            const y = H - ((v - yMin) / yRange) * H
            return <line key={v} x1={0} y1={y} x2={W} y2={y} stroke="#F3F4F6" strokeWidth={1} />
          })}

          {/* Trace 1 */}
          {trace1.length > 0 && (
            <>
              <path
                d={buildPath(trace1, yMin, yRange)}
                fill="none"
                stroke={driverData[0].colour}
                strokeWidth={1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path
                d={`${buildPath(trace1, yMin, yRange)} L${W},${H} L0,${H} Z`}
                fill={driverData[0].colour}
                fillOpacity={0.04}
              />
            </>
          )}

          {/* Trace 2 */}
          {trace2.length > 0 && (
            <path
              d={buildPath(trace2, yMin, yRange)}
              fill="none"
              stroke={driverData[1].colour}
              strokeWidth={1.8}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="6 3"
            />
          )}

          {/* Crosshair */}
          {tooltipNx !== null && (
            <line
              x1={tooltipNx * W}
              y1={0}
              x2={tooltipNx * W}
              y2={H}
              stroke="rgba(19,35,61,0.08)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}
          {tooltipNx !== null && trace1.length > 0 && (
            <circle
              cx={tooltipNx * W}
              cy={H - ((trace1[Math.round(tooltipNx * (trace1.length - 1))] - yMin) / yRange) * H}
              r={4.5}
              fill={driverData[0].colour}
              stroke="#FFFFFF"
              strokeWidth={1.5}
            />
          )}
          {tooltipNx !== null && trace2.length > 0 && (
            <circle
              cx={tooltipNx * W}
              cy={H - ((trace2[Math.round(tooltipNx * (trace2.length - 1))] - yMin) / yRange) * H}
              r={4.5}
              fill={driverData[1].colour}
              stroke="#FFFFFF"
              strokeWidth={1.5}
            />
          )}
        </svg>
      </div>
    </div>
  )
}
