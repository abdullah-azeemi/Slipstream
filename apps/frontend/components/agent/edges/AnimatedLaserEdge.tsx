'use client'

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

export type EdgeTone = 'idle' | 'running' | 'done' | 'error'

export default function AnimatedLaserEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.4,
  })

  const tone: EdgeTone = (data?.tone as EdgeTone | undefined) ?? 'done'
  const latency: number | null = (data?.latency_ms as number | null) ?? null

  return (
    <>
      <BaseEdge path={path} className={`edge-laser edge-${tone}`} />

      {/* Latency label — only shown when done and latency is known */}
      {tone === 'done' && latency !== null && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="font-mono text-[8px] font-semibold uppercase tracking-[0.06em] text-slate-400"
          >
            LATENCY: {latency}ms
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}