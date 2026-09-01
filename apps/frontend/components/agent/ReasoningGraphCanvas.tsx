'use client'

import { useEffect, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useNodes,
  useReactFlow,
  type Edge as FlowEdge,
  type EdgeTypes,
  type Node as FlowNode,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { DAG_NODE_H, DAG_NODE_W, layeredLayout, topoRankMap } from '@/lib/dag-layout'
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
  selectedNodeId?: string | null
  phase: 'running' | 'completing' | 'minimap' | 'expanded'
  // animationIndex: map of nodeId → topo rank (0-based), used to stagger ghost entrance
  animationIndex: Record<string, number>
}

export default function ReasoningGraphCanvas({
  nodes,
  edges,
  states,
  onSelectNode,
  selectedNodeId,
  phase,
  animationIndex,
}: Props) {
  const isMinimap = phase === 'minimap'

  const rfNodes = useMemo<FlowNode[]>(() => {
    const position = layeredLayout(nodes, isMinimap ? 1.35 : 1)
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
  }, [nodes, states, animationIndex, isMinimap])

  const rfEdges = useMemo<FlowEdge[]>(() => {
    const rank = topoRankMap(nodes)
    return edges.map((edge) => {
      const sourceInfo: AgentNodeRunInfo | undefined = states[edge.source]
      const targetInfo: AgentNodeRunInfo | undefined = states[edge.target]
      let tone: EdgeTone = 'idle'
      if (targetInfo?.state === 'running') tone = 'running'
      else if (targetInfo?.state === 'error') tone = 'error'
      else if (sourceInfo?.state === 'done' || sourceInfo?.state === 'error') tone = 'done'
      const latency = sourceInfo?.duration_ms ?? null
      const span = (rank[edge.target] ?? 0) - (rank[edge.source] ?? 0)
      return {
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: 'laser',
        data: { tone, latency_ms: latency, span, compact: isMinimap },
      }
    })
  }, [edges, states, isMinimap, nodes])

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
        {!isMinimap && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#d1d5db"
          />
        )}
        {!isMinimap && <Controls showInteractive={false} position="bottom-left" />}
        <NodeZoomAnimator nodeId={selectedNodeId} drawerWidth={300} />
        <FitController trigger={phase} />
      </ReactFlow>
    </div>
  )
}

// Centers the viewport on the selected node once the inspector opens, offset to
// the left so the node lands next to the 300px drawer instead of under it.
function NodeZoomAnimator({
  nodeId,
  drawerWidth = 300,
}: {
  nodeId?: string | null
  drawerWidth?: number
}) {
  const { setCenter } = useReactFlow()
  const nodes = useNodes<FlowNode>()

  useEffect(() => {
    if (!nodeId) return
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    const w = node.measured?.width ?? DAG_NODE_W
    const h = node.measured?.height ?? DAG_NODE_H
    setCenter(node.position.x + w / 2 - drawerWidth / 2, node.position.y + h / 2, {
      zoom: 0.9,
      duration: 400,
    })
  }, [nodeId, nodes, setCenter, drawerWidth])

  return null
}

// Re-fits the viewport after the container height transitions (collapse /
// expand) so the layout stays fully visible once the slide finishes.
function FitController({ trigger }: { trigger: string }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    const t = setTimeout(
      () =>
        fitView({
          padding: 0.2,
          maxZoom: trigger === 'minimap' ? 0.6 : 1,
          duration: 300,
        }),
      // Wait for the height transition (300ms) to settle before re-fitting.
      320
    )
    return () => clearTimeout(t)
  }, [trigger, fitView])

  return null
}