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
import QueryRootNode from './nodes/QueryRootNode'
import AnimatedLaserEdge, { type EdgeTone } from './edges/AnimatedLaserEdge'

const nodeTypes: NodeTypes = {
  agent: AgentDAGNode,
  query: QueryRootNode,
}
const edgeTypes: EdgeTypes = { laser: AnimatedLaserEdge }

interface Props {
  nodes: AgentDAGNodeSpec[]
  edges: AgentDAGEdge[]
  states: Record<string, AgentNodeRunInfo>
  onSelectNode?: (nodeId: string) => void
  selectedNodeId?: string | null
  phase: 'running' | 'completing' | 'minimap' | 'expanded'
  animationIndex: Record<string, number>
  question?: string
  intent?: string
}

export default function ReasoningGraphCanvas({
  nodes,
  edges,
  states,
  onSelectNode,
  selectedNodeId,
  phase,
  animationIndex,
  question,
  intent,
}: Props) {
  const isMinimap = phase === 'minimap'

  const allDone = useMemo(() => {
    if (!nodes.length) return false
    return nodes.every((n) => states[n.id]?.state === 'done' || states[n.id]?.state === 'error')
  }, [nodes, states])

  const rfNodes = useMemo<FlowNode[]>(() => {
    const positions = layeredLayout(nodes, isMinimap ? 1.35 : 1)

    // Calculate vertical midpoint for query root node
    let avgY = 0
    if (nodes.length > 0) {
      const ySum = nodes.reduce((sum, n) => sum + (positions[n.id]?.y ?? 0), 0)
      avgY = ySum / nodes.length
    }

    const flowNodes: FlowNode[] = []

    // Inject synthetic root query node if we have a question
    if (question || nodes.length > 0) {
      flowNodes.push({
        id: 'query_root',
        type: 'query',
        position: { x: isMinimap ? -360 : -420, y: avgY },
        data: {
          question: question || 'Processing query...',
          intent: intent || 'race_analysis',
          thinking: phase === 'running',
          allDone,
        },
      })
    }

    // Map regular tool nodes
    nodes.forEach((node) => {
      const info: AgentNodeRunInfo = states[node.id] ?? { state: 'idle' }
      flowNodes.push({
        id: node.id,
        type: 'agent',
        position: positions[node.id],
        data: {
          label: node.label,
          tool_name: node.tool_name,
          state: info.state,
          duration_ms: info.duration_ms ?? null,
          summary: info.summary ?? null,
          query_preview: info.query_preview ?? null,
          animationDelay: (animationIndex[node.id] ?? 0) * 100, // 100ms stagger per rank
        } satisfies AgentDAGNodeData,
      })
    })

    return flowNodes
  }, [nodes, states, animationIndex, isMinimap, question, intent, phase, allDone])

  const rfEdges = useMemo<FlowEdge[]>(() => {
    const rank = topoRankMap(nodes)
    const flowEdges: FlowEdge[] = []

    // Identify root DAG nodes (nodes that are not targets of any internal edge)
    const targetSet = new Set(edges.map((e) => e.target))
    const rootNodeIds = nodes.filter((n) => !targetSet.has(n.id)).map((n) => n.id)

    // Add synthetic laser edges from query_root -> root DAG nodes
    rootNodeIds.forEach((rootId) => {
      const targetState = states[rootId]?.state
      let tone: EdgeTone = 'idle'
      if (targetState === 'running') tone = 'running'
      else if (targetState === 'done') tone = 'done'
      else if (phase === 'running') tone = 'running'

      flowEdges.push({
        id: `query_root->${rootId}`,
        source: 'query_root',
        target: rootId,
        type: 'laser',
        data: { tone, latency_ms: null, span: 1, compact: isMinimap },
      })
    })

    // Map internal tool edges
    edges.forEach((edge) => {
      const sourceInfo: AgentNodeRunInfo | undefined = states[edge.source]
      const targetInfo: AgentNodeRunInfo | undefined = states[edge.target]
      let tone: EdgeTone = 'idle'
      if (targetInfo?.state === 'running') tone = 'running'
      else if (targetInfo?.state === 'error') tone = 'error'
      else if (sourceInfo?.state === 'done' || sourceInfo?.state === 'error') tone = 'done'
      const latency = sourceInfo?.duration_ms ?? null
      const span = (rank[edge.target] ?? 0) - (rank[edge.source] ?? 0)

      flowEdges.push({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: 'laser',
        data: { tone, latency_ms: latency, span, compact: isMinimap },
      })
    })

    return flowEdges
  }, [edges, states, isMinimap, nodes, phase])

  return (
    <div className={`h-full w-full ${isMinimap ? 'pointer-events-none' : ''}`}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: isMinimap ? 0.6 : 1 }}
        minZoom={0.2}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => !isMinimap && node.id !== 'query_root' && onSelectNode?.(node.id)}
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

function FitController({ trigger }: { trigger: string }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    const t = setTimeout(
      () =>
        fitView({
          padding: 0.25,
          maxZoom: trigger === 'minimap' ? 0.6 : 1,
          duration: 300,
        }),
      320
    )
    return () => clearTimeout(t)
  }, [trigger, fitView])

  return null
}