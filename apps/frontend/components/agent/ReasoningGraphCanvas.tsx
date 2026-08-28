'use client'

import { useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge as FlowEdge,
  type EdgeTypes,
  type Node as FlowNode,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { layeredLayout } from '@/lib/dag-layout'
import {
  AgentDAGEdge,
  AgentDAGNode as AgentDAGNodeSpec,
  AgentNodeRunInfo,
} from '@/types/agent'
import AgentDAGNode, { type AgentDAGNodeData } from './nodes/AgentDAGNode'
import AnimatedLaserEdge, { type EdgeTone } from './edges/AnimatedLaserEdge'

const nodeTypes: NodeTypes = { agent: AgentDAGNode }
const edgeTypes: EdgeTypes = { laser: AnimatedLaserEdge }

interface Props {
  nodes: AgentDAGNodeSpec[]
  edges: AgentDAGEdge[]
  states: Record<string, AgentNodeRunInfo>
  onSelectNode?: (nodeId: string) => void
  phase: 'running' | 'completing' | 'minimap' | 'expanded'
  // animationIndex: map of nodeId → topo rank (0-based), used to stagger ghost entrance
  animationIndex: Record<string, number>
}

export default function ReasoningGraphCanvas({
  nodes,
  edges,
  states,
  onSelectNode,
  phase,
  animationIndex,
}: Props) {
  const isMinimap = phase === 'minimap'

  const rfNodes = useMemo<FlowNode[]>(() => {
    const position = layeredLayout(nodes)
    return nodes.map((node) => {
      const info: AgentNodeRunInfo = states[node.id] ?? { state: 'idle' }
      return {
        id: node.id,
        type: 'agent',
        position: position[node.id],
        data: {
          label: node.label,
          tool_name: node.tool_name,
          state: info.state,
          duration_ms: info.duration_ms ?? null,
          summary: info.summary ?? null,
          query_preview: info.query_preview ?? null,
          animationDelay: (animationIndex[node.id] ?? 0) * 60,
        } satisfies AgentDAGNodeData,
      }
    })
  }, [nodes, states, animationIndex])

  const rfEdges = useMemo<FlowEdge[]>(
    () =>
      edges.map((edge) => {
        const sourceInfo: AgentNodeRunInfo | undefined = states[edge.source]
        const targetInfo: AgentNodeRunInfo | undefined = states[edge.target]
        let tone: EdgeTone = 'idle'
        if (targetInfo?.state === 'running') tone = 'running'
        else if (targetInfo?.state === 'error') tone = 'error'
        else if (sourceInfo?.state === 'done' || sourceInfo?.state === 'error') tone = 'done'
        const latency = sourceInfo?.duration_ms ?? null
        return {
          id: `${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          type: 'laser',
          data: { tone, latency_ms: latency },
        }
      }),
    [edges, states]
  )

  return (
    <div className={`h-full w-full ${isMinimap ? 'pointer-events-none' : ''}`}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: isMinimap ? 0.6 : 1 }}
        minZoom={0.2}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => !isMinimap && onSelectNode?.(node.id)}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d1d5db"
        />
        {!isMinimap && <Controls showInteractive={false} position="bottom-left" />}
      </ReactFlow>
    </div>
  )
}