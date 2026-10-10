import type {
  AgentDAGNode,
  AgentNodeRunInfo,
  AgentNodeState,
  ToolCallRecord,
} from '@/types/agent'

export interface NodeInspectorView {
  nodeId: string
  toolName: string
  label: string
  description: string | null
  dependsOn: string[]
  inputParams: Record<string, unknown>
  state: AgentNodeState
  durationMs: number | null
  summary: string | null
  error: string | null
  call: ToolCallRecord | null
}

export function buildNodeInspectorView(
  node: AgentDAGNode | null | undefined,
  info: AgentNodeRunInfo | null | undefined,
  call: ToolCallRecord | null | undefined
): NodeInspectorView {
  if (!node) {
    return {
      nodeId: '',
      toolName: '',
      label: '',
      description: null,
      dependsOn: [],
      inputParams: {},
      state: 'idle',
      durationMs: null,
      summary: null,
      error: null,
      call: null,
    }
  }

  return {
    nodeId: node.id,
    toolName: node.tool_name,
    label: node.label,
    description: node.description ?? null,
    dependsOn: node.depends_on ?? [],
    inputParams: node.input_params ?? {},
    state: info?.state ?? 'idle',
    durationMs: info?.duration_ms ?? call?.duration_ms ?? null,
    summary: info?.summary ?? call?.output_summary ?? call?.input_summary ?? null,
    error: info?.error ?? call?.error ?? null,
    call: call ?? null,
  }
}