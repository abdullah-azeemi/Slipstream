import type { AnalystEvent } from '@/types/analyst'

export interface SseFrame {
  event: string
  data: unknown
}

/** Split a streaming buffer into complete SSE frames; returns the unfinished tail. */
export function parseSse(buffer: string): { frames: SseFrame[]; rest: string } {
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  const frames: SseFrame[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim()
    const dataLine = lines.find((l) => l.startsWith('data:'))?.slice(5).trim()
    if (!event || dataLine === undefined) continue
    try {
      frames.push({ event, data: JSON.parse(dataLine) })
    } catch {
      // a malformed frame must not kill the stream
    }
  }
  return { frames, rest }
}

export interface StreamHandlers {
  onEvent: (event: AnalystEvent) => void
  onSaved?: (info: { run_id: number; conversation_id: number }) => void
}

export async function streamAnalyst(opts: {
  apiUrl: string
  token: string | null
  question: string
  signal?: AbortSignal
  handlers: StreamHandlers
}): Promise<void> {
  const resp = await fetch(`${opts.apiUrl}/api/v1/agent/analyst/stream`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({ question: opts.question }),
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => null)
    throw new Error(body?.error ?? `Request failed (${resp.status})`)
  }
  if (!resp.body) throw new Error('Streaming response was empty')

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const { frames, rest } = parseSse(done ? buffer + '\n\n' : buffer)
    buffer = done ? '' : rest
    for (const frame of frames) {
      if (frame.event === 'analyst') opts.handlers.onEvent(frame.data as AnalystEvent)
      else if (frame.event === 'saved') opts.handlers.onSaved?.(frame.data as { run_id: number; conversation_id: number })
      else if (frame.event === 'error') throw new Error((frame.data as { error?: string })?.error ?? 'Analysis failed')
    }
    if (done) break
  }
}
