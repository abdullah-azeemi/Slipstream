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
  telemetry_overlay?: TelemetryInspectorResult | null
  stint_degradation?: StintDegradationResult | null
  race_control?: RaceControlWindowResult | null
  trace: ToolCallRecord[]
  conversation_id?: number | null
  trace_visibility?: 'full' | 'evidence' | string
  cost_usd?: number
  clarification?: { missing: string[]; question: string } | null
  routing_context?: Record<string, unknown> | null
}

export interface AgentProgressEvent {
  type:
    | 'stage'
    | 'tool'
    | 'dag_init'
    | 'node_start'
    | 'node_complete'
    | 'node_error'
    | 'route'
    | 'plan'
    | 'compose'
    | string
  stage?: string
  tool_name?: string
  status: 'running' | 'ok' | 'error' | string
  label: string
  duration_ms?: number | null
  node_id?: string
  nodes?: AgentDAGNode[]
  edges?: AgentDAGEdge[]
  query_preview?: string | null
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
  query_preview?: string | null
}

// ── Rich telemetry & circuit visualizations (L27) ──

export interface TelemetrySamplePoint {
  distance_m: number
  speed_kmh: number
  throttle_pct: number
  brake: boolean
  gear: number
  drs: number
  x_pos: number | null
  y_pos: number | null
}

export interface TelemetryLapTrace {
  driver_number: number
  driver_abbreviation: string
  lap_number: number
  samples: TelemetrySamplePoint[]
}

export interface TelemetryInspectorResult {
  session_key: number
  traces: TelemetryLapTrace[]
  speed_delta_apex_kmh: number | null
  full_throttle_pct: number
  heavy_braking_zones_count: number
}

export interface StintLapPoint {
  lap_number: number
  tyre_age: number
  lap_time_ms: number
}

export interface StintSummary {
  stint_index: number
  compound: string
  start_lap: number
  end_lap: number
  total_laps: number
  initial_pace_ms: number
  final_pace_ms: number
  degradation_slope_ms_per_lap: number
  cliff_detected: boolean
  cliff_lap: number | null
  laps: StintLapPoint[]
}

export interface StintDegradationResult {
  session_key: number
  driver_number: number
  stints: StintSummary[]
  worst_degradation_stint: number | null
}

export interface RaceControlEvent {
  category: string | null
  flag: string | null
  scope: string | null
  driver_number: number | null
  sector: number | null
  lap_number: number | null
  message: string | null
}

export interface RaceControlWindowResult {
  from_lap: number | null
  to_lap: number | null
  events: RaceControlEvent[]
  safety_car_periods: number
}