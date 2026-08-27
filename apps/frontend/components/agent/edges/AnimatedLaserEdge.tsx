'use client'

import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  })
  const tone: EdgeTone = (data?.tone as EdgeTone | undefined) ?? 'done'

  return <BaseEdge path={path} className={`edge-laser edge-${tone}`} />
}