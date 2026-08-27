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
}

export default function ReasoningGraphCanvas({ nodes, edges, states, onSelectNode }: Props) {
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
        } satisfies AgentDAGNodeData,
      }
    })
  }, [nodes, states])

  const rfEdges = useMemo<FlowEdge[]>(
    () =>
      edges.map((edge) => {
        const sourceInfo: AgentNodeRunInfo | undefined = states[edge.source]
        const targetInfo: AgentNodeRunInfo | undefined = states[edge.target]
        let tone: EdgeTone = 'idle'
        if (targetInfo?.state === 'running') tone = 'running'
        else if (targetInfo?.state === 'error') tone = 'error'
        else if (sourceInfo?.state === 'done' || sourceInfo?.state === 'error') tone = 'done'
        return {
          id: `${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          type: 'laser',
          data: { tone },
        }
      }),
    [edges, states]
  )

  return (
    <div className="h-[380px] w-full rounded-[6px] border border-slate-200 bg-[#0d0d0d]">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        minZoom={0.3}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelectNode?.(node.id)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#2a2a2a" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  )
}