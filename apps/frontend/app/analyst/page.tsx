'use client'

import { useAuth } from '@clerk/nextjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@/components/landing/landing.css'
import AnalystCanvas from '@/components/analyst/AnalystCanvas'
import AnswerPanel from '@/components/analyst/AnswerPanel'
import { useReplay } from '@/components/analyst/useReplay'
import { API_URL } from '@/lib/api'
import { reduceEvents } from '@/lib/analyst-graph'
import { streamAnalyst } from '@/lib/analyst-stream'
import type { AnalystEvent, AnalystRunDetail, AnalystRunSummary } from '@/types/analyst'

const EXAMPLES = [
  'How bad was Hamilton’s tyre degradation at the 2026 Singapore Grand Prix?',
  'What was the green-flag pit loss at the 2026 Spanish Grand Prix, and who lost the most?',
]

export default function AnalystPage() {
  const { getToken } = useAuth()
  const replay = useReplay()
  const [live, setLive] = useState<AnalystEvent[]>([])
  const [mode, setMode] = useState<'live' | 'replay'>('live')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<AnalystRunSummary[]>([])
  const abort = useRef<AbortController | null>(null)

  const events = mode === 'live' ? live : replay.events
  const run = useMemo(() => reduceEvents(events), [events])

  const authedFetch = useCallback(
    async (path: string) => {
      const token = await getToken()
      const resp = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!resp.ok) throw new Error(`Request failed (${resp.status})`)
      return resp.json()
    },
    [getToken]
  )

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await authedFetch('/api/v1/agent/analyst/runs'))
    } catch {
      // history is a convenience; the page works without it
    }
  }, [authedFetch])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  async function ask(text: string) {
    const q = text.trim()
    if (!q || busy) return
    replay.stop()
    setMode('live')
    setLive([])
    setSelected(null)
    setError(null)
    setBusy(true)
    setQuestion('')
    abort.current = new AbortController()
    try {
      await streamAnalyst({
        apiUrl: API_URL,
        token: await getToken(),
        question: q,
        signal: abort.current.signal,
        handlers: { onEvent: (e) => setLive((cur) => [...cur, e]) },
      })
      void loadHistory()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function replayRun(id: number) {
    try {
      const detail = (await authedFetch(`/api/v1/agent/analyst/runs/${id}`)) as AnalystRunDetail
      setMode('replay')
      setSelected(null)
      setError(null)
      replay.play(detail.events, 1.5)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[360px] flex-1">
          <AnalystCanvas run={run} selectedId={selected} onSelect={setSelected} />
          {run.question == null && (
            <div className="absolute inset-x-0 bottom-24 mx-auto flex max-w-xl flex-wrap justify-center gap-2 px-4">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => ask(ex)} className="an-mono rounded border border-[#b9c4c6] bg-white px-3 py-2 text-left text-[12px] text-[#2c4a52] hover:border-[#3d7f8a]">
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="flex w-full flex-col border-t border-[#e3e6e3] bg-white lg:w-[440px] lg:border-l lg:border-t-0">
          <div className="min-h-0 flex-1">
            <AnswerPanel run={run} selectedId={selected} onSelect={setSelected} />
          </div>
          {history.length > 0 && (
            <details className="border-t border-[#e3e6e3] px-5 py-3 text-sm">
              <summary className="an-mono cursor-pointer text-[11px] uppercase tracking-wider text-[#8a9498]">Past runs</summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {history.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => replayRun(h.id)} className="w-full truncate rounded px-2 py-1 text-left text-[13px] text-[#2c4a52] hover:bg-[#f1f7f8]">
                      ▶ {h.question}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void ask(question)
            }}
            className="border-t border-[#e3e6e3] p-4"
          >
            {error && <p className="mb-2 text-sm text-[#8a3b32]">{error}</p>}
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about pace, degradation, pit strategy…"
                disabled={busy}
                className="min-w-0 flex-1 rounded border border-[#cfd6d4] px-3 py-2 text-sm outline-none focus:border-[#3d7f8a] disabled:opacity-60"
              />
              <button disabled={busy || !question.trim()} className="rounded bg-[#1f2a2e] px-4 py-2 text-sm text-white disabled:opacity-40">
                {busy ? 'Working…' : 'Ask'}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  )
}
