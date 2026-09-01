'use client'

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'

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
  const span = (data?.span as number | undefined) ?? 0
  const [path, labelX, labelY] =
    span > 1
      ? getSmoothStepPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
          borderRadius: 12,
          offset: 24,
        })
      : getBezierPath({
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
  const compact = (data?.compact as boolean | undefined) ?? false

  return (
    <>
      <BaseEdge path={path} className={`edge-laser edge-${tone}`} />

      {/* Latency label — only shown when done, latency is known, and not in minimap */}
      {tone === 'done' && latency !== null && !compact && (
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