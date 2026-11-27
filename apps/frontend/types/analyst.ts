/** Events streamed by POST /api/v1/agent/analyst/stream (and stored for replay). */
interface Base {
  seq: number
  t_ms: number
}

export type AnalystEvent =
  | (Base & { type: 'run_start'; question: string })
  | (Base & { type: 'thought'; round: number; text: string })
  | (Base & {
      type: 'llm_call'
      round: number
      model: string
      duration_ms: number
      cost_usd: number
      prompt_tokens: number
      completion_tokens: number
      content: string
      tool_calls: { call_id: string; tool: string }[]
      forced: boolean
    })
  | (Base & {
      type: 'tool_start'
      round: number
      call_id: string
      tool: string
      title: string
      preview: string
      args?: Record<string, unknown> // missing in runs saved before tracing
    })
  | (Base & {
      type: 'tool_end'
      round: number
      call_id: string
      ok: boolean
      duration_ms: number
      summary: string
      output?: string // missing in runs saved before tracing
      title: string
      preview: string
    })
  | (Base & { type: 'chart'; round: number; call_id: string; title: string; option: Record<string, unknown> })
  | (Base & { type: 'final'; markdown: string; cost_usd: number; steps: number; refused?: boolean })
  | (Base & { type: 'error'; message: string })

export interface AnalystRunSummary {
  id: number
  question: string
  cost_usd: number
  steps: number
  error: string | null
  created_at: string
}

export interface AnalystRunDetail extends AnalystRunSummary {
  answer: string
  events: AnalystEvent[]
}
