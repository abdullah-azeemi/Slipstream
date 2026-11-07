/** Events streamed by POST /api/v1/agent/analyst/stream (and stored for replay). */
interface Base {
  seq: number
  t_ms: number
}

export type AnalystEvent =
  | (Base & { type: 'run_start'; question: string })
  | (Base & { type: 'thought'; round: number; text: string })
  | (Base & { type: 'tool_start'; round: number; call_id: string; tool: string; title: string; preview: string })
  | (Base & {
      type: 'tool_end'
      round: number
      call_id: string
      ok: boolean
      duration_ms: number
      summary: string
      title: string
      preview: string
    })
  | (Base & { type: 'chart'; round: number; call_id: string; title: string; option: Record<string, unknown> })
  | (Base & { type: 'final'; markdown: string; cost_usd: number; steps: number })
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
