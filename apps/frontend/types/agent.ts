export interface ResolvedSession {
    session_key: number, 
    year: number, 
    gp_name: string, 
    session_type: string,
    session_name?: string | null
}

export interface ResolvedDriver{
    driver_number: number,
    abbreviation: string,
    full_name: string,
    team_name?: string | null
}

export interface PitStop{
    stop_index: number,
    pit_in_lap: number,
    pit_out_lap: number,
    compound_before?: string | null,
    compound_after?: string | null
}

export interface SpeedWindowResult{
    session_key: number,
    driver_number: number,
    metric: string,
    before_laps: number[],
    after_laps: number[],
    before_avg_speed_kmh: number | null,
    after_avg_speed_kmh: number | null,
    delta_kmh: number | null,
    sample_count_before: number,
    sample_count_after: number
}

export interface EvidenceCheck{
    name: string,
    passed: boolean,
    detail?: string | null
}

export interface VerifyEvidenceResult {
  passed: boolean
  checks: EvidenceCheck[]
  refusal_reason?: string | null
}

export interface ToolCallRecord {
  tool_name: string
  status: 'ok' | 'error' | string
  input_summary: string
  output_summary?: string | null
  error?: string | null
  duration_ms?: number | null
  node_id?: string | null
}

export interface AgentAnswer {
  question: string
  intent: string
  answer: string
  refusals: string[]
  session?: ResolvedSession | null
  driver?: ResolvedDriver | null
  pit_stop?: PitStop | null
  speed_window?: SpeedWindowResult | null
  evidence?: VerifyEvidenceResult | null
  trace: ToolCallRecord[]
  conversation_id?: number | null
  trace_visibility?: 'full' | 'evidence' | string
  cost_usd?: number
}

export interface AgentProgressEvent {
  type: 'stage' | 'tool' | string
  stage?: string
  tool_name?: string
  status: 'running' | 'ok' | 'error' | string
  label: string
  duration_ms?: number | null
  node_id?: string
  nodes?: AgentDAGNode[]
  edges?: AgentDAGEdge[]
  summary?: string | null
  error?: string | null
}

// ── Conversation persistence types (L16) ──────────────────

export interface ConversationSummary {
  id: number
  title: string | null
  message_count: number
  last_message_preview: string | null
  created_at: string | null
  updated_at: string | null
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  created_at: string | null
}

export interface ConversationDetail {
  id: number
  title: string | null
  created_at: string | null
  messages: ConversationMessage[]
}

export interface UsageInfo {
  used: number,
  limit: number,
  remaining: number
}
export interface AdminStats {
  total_runs: number
  total_cost_usd: number
  completed: number
  refused: number
}

// ── Dynamic DAG visualization (L25) ──

export interface AgentDAGNode {
  id: string
  tool_name: string
  label: string
  description?: string | null
  depends_on: string[]
  input_params?: Record<string, unknown>
}

export interface AgentDAGEdge {
  source: string
  target: string
  label?: string | null
}

export type AgentNodeState = 'idle' | 'running' | 'done' | 'error'

export interface AgentNodeRunInfo {
  state: AgentNodeState
  duration_ms?: number | null
  summary?: string | null
  error?: string | null
}
