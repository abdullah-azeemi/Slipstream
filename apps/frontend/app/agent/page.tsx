'use client'

import { useAuth, UserButton } from '@clerk/nextjs'
import {
  Bot,
  Braces,
  ChevronRight,
  CircuitBoard,
  Clock3,
  Database,
  Flag,
  Gauge,
  History,
  Loader2,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import EvidenceCards from '@/components/agent/EvidenceCards'
import RefusalBanner from '@/components/agent/RefusalBanner'
import ToolTraceAccordion from '@/components/agent/ToolTraceAccordion'
import { agentApi, API_URL } from '@/lib/api'
import { AgentAnswer, ConversationSummary } from '@/types/agent'

const SUGGESTED_QUESTIONS = [
  'Where did Sainz pit in Monaco 2026?',
  "What was Verstappen's pit stop speed in Monaco 2026?",
  'On which lap did Sainz pit in Monaco 2026 and what was his avg speed before and after?',
]

type ChatTurn = {
  id: number
  question: string
  reply: AgentAnswer | null
  error: string | null
}

const SYSTEM_MODULES: Array<[string, LucideIcon, boolean]> = [
  ['Strategy bot', Radio, true],
  ['Neural router', CircuitBoard, true],
  ['Evidence gate', ShieldCheck, true],
  ['R2 telemetry', Database, false],
]

function PanelHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-9 items-center justify-between border-b border-slate-200 bg-slate-100/80 px-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-500">{eyebrow}</div>
        <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-slate-500">{title}</div>
      </div>
      {action}
    </div>
  )
}

function MiniMetric({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: string
  tone?: 'slate' | 'red' | 'green' | 'amber'
}) {
  const toneClass = {
    slate: 'text-slate-700',
    red: 'text-rose-600',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
  }[tone]

  return (
    <div className="border-l border-slate-200 pl-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-extrabold ${toneClass}`}>{value}</div>
    </div>
  )
}

export default function AgentPage() {
  const { getToken } = useAuth()

  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [loadingQuestion, setLoadingQuestion] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const latestReply = useMemo(
    () => [...turns].reverse().find((turn) => turn.reply)?.reply ?? null,
    [turns]
  )
  const latestError = useMemo(
    () => [...turns].reverse().find((turn) => turn.error)?.error ?? null,
    [turns]
  )
  const successfulRuns = turns.filter((turn) => turn.reply && !turn.reply.refusals.length).length
  const refusedRuns = turns.filter((turn) => turn.reply?.refusals.length).length
  const traceCount = latestReply?.trace.length ?? 0
  const totalTraceMs =
    latestReply?.trace.reduce((sum, call) => sum + (call.duration_ms ?? 0), 0) ?? 0

  // Load conversation list on mount.
  useEffect(() => {
    agentApi.listConversations(getToken).then(setConversations).catch(() => {})
  }, [getToken])

  // Load a past conversation's messages into the turn view.
  async function loadConversation(convId: number) {
    setLoadingHistory(true)
    try {
      const detail = await agentApi.getConversation(convId, getToken)
      // Convert messages into ChatTurn objects.
      const loaded: ChatTurn[] = []
      for (let i = 0; i < detail.messages.length; i += 2) {
        const userMsg = detail.messages[i]
        const assistantMsg = detail.messages[i + 1]
        if (userMsg?.role === 'user') {
          loaded.push({
            id: Date.now() + i,
            question: userMsg.content,
            reply: assistantMsg
              ? { answer: assistantMsg.content, intent: '', refusals: [], trace: [], question: userMsg.content }
              : null,
            error: null,
          })
        }
      }
      setTurns(loaded)
      setConversationId(convId)
    } catch {
      // Silently fail — conversation list stays visible.
    } finally {
      setLoadingHistory(false)
    }
  }

  // Start a new conversation (clear turns and conversationId).
  function newConversation() {
    setTurns([])
    setConversationId(null)
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || loadingQuestion) return

    const id = Date.now()
    setLoadingQuestion(trimmed)
    setQuestion('')
    setTurns((current) => [...current, { id, question: trimmed, reply: null, error: null }])

    try {
      const token = await getToken()

      const resp = await fetch(`${API_URL}/api/v1/agent/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: trimmed,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
      })

      if (!resp.ok) {
        const body = await resp.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${resp.status})`)
      }

      const reply = (await resp.json()) as AgentAnswer
      // Store the conversation_id from the response so the next question
      // in this thread is sent to the same conversation.
      if (reply.conversation_id) {
        setConversationId(reply.conversation_id)
        // Refresh the conversation list so the new conversation appears.
        agentApi.listConversations(getToken).then(setConversations).catch(() => {})
      }
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, reply, error: null } : turn))
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, reply: null, error: message } : turn))
      )
    } finally {
      setLoadingQuestion(null)
    }
  }

  function fillSuggestion(q: string) {
    setQuestion(q)
  }

  return (
    <div className="min-h-[calc(100vh-140px)] bg-[#f7f8fb] bg-[linear-gradient(#e7eaf0_1px,transparent_1px),linear-gradient(90deg,#e7eaf0_1px,transparent_1px)] bg-[size:18px_18px] px-3 py-4 text-slate-900 sm:px-5 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <section className="border border-slate-200 bg-white/82 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <PanelHeader
            eyebrow="Orchestrator_v1"
            title="Analysis"
            action={<UserButton appearance={{ elements: { avatarBox: 'h-7 w-7' } }} />}
          />

          <div className="p-4">
            <div className="border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center border border-slate-300 bg-white">
                  <Bot className="h-5 w-5 text-rose-500" />
                </div>
                <div>
                  <div className="text-xs font-extrabold uppercase tracking-[0.08em] text-slate-700">
                    Agent Core
                  </div>
                  <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-600">
                    v1.0.14 stable
                  </div>
                </div>
              </div>
              <button
                onClick={() => fillSuggestion(SUGGESTED_QUESTIONS[2])}
                className="mt-4 flex w-full items-center justify-center gap-2 bg-rose-600 px-3 py-3 text-[11px] font-extrabold uppercase tracking-[0.08em] text-white transition hover:bg-rose-500"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Prime Query
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniMetric label="runs" value={String(turns.length)} />
              <MiniMetric label="ok" value={String(successfulRuns)} tone="green" />
              <MiniMetric label="refused" value={String(refusedRuns)} tone="amber" />
              <MiniMetric label="tools" value={String(traceCount)} tone="red" />
            </div>

            <div className="mt-5 space-y-2">
              {SYSTEM_MODULES.map(([label, Icon, hot]) => (
                <div
                  key={label}
                  className="flex items-center justify-between border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`h-3.5 w-3.5 ${hot ? 'text-rose-500' : 'text-slate-400'}`} />
                    <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                      {label}
                    </span>
                  </div>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      hot ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                </div>
              ))}
            </div>

            {/* ── Conversation History ──────────────────── */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-500">
                  <History className="h-3 w-3 text-rose-500" />
                  History
                </div>
                <button
                  onClick={newConversation}
                  className="flex items-center gap-1 border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500 hover:border-rose-300 hover:text-rose-600 transition-colors"
                  title="New conversation"
                >
                  <Plus className="h-3 w-3" />
                  New
                </button>
              </div>

              {loadingHistory && (
                <div className="flex items-center gap-2 p-2 text-[10px] text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading...
                </div>
              )}

              {!loadingHistory && conversations.length === 0 && (
                <div className="p-2 text-[10px] text-slate-400">
                  No conversations yet
                </div>
              )}

              <div className="space-y-1 max-h-48 overflow-y-auto">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className={`w-full text-left border px-2.5 py-2 transition-colors ${
                      conversationId === conv.id
                        ? 'border-rose-300 bg-rose-50 text-rose-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-[11px] font-semibold truncate">
                      {conv.title || 'Untitled'}
                    </div>
                    <div className="mt-0.5 text-[9px] text-slate-400">
                      {conv.message_count} messages
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="min-w-0 border border-slate-200 bg-white/76 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          <PanelHeader
            eyebrow="Dag_visualizer"
            title="Race question pipeline"
            action={
              <div className="flex items-center gap-2 text-slate-400">
                <Gauge className="h-3.5 w-3.5" />
                <Braces className="h-3.5 w-3.5" />
              </div>
            }
          />

          <div className="border-b border-slate-200 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            &gt; resolve race --&gt; identify driver --&gt; load telemetry --&gt; verify evidence
          </div>

          <div className="grid min-h-[540px] grid-rows-[1fr_auto]">
            <div className="space-y-5 overflow-hidden p-4 sm:p-6">
              {turns.length === 0 && !loadingQuestion && (
                <div className="grid h-full place-items-center">
                  <div className="w-full max-w-xl border border-slate-200 bg-white/90 p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-rose-500">
                      <Zap className="h-3.5 w-3.5" />
                      Strategy bot listening
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      Ask for a race, driver, pit stop, and speed comparison. The agent will keep
                      the math in deterministic tools and only use the model to route and explain.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          onClick={() => fillSuggestion(q)}
                          className="border border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {turns.map((turn) => (
                <div key={turn.id} className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[92%] border border-slate-300 bg-white px-4 py-3 shadow-sm sm:max-w-[78%]">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                        User input
                      </div>
                      <p className="text-sm font-semibold leading-6 text-slate-800">
                        {turn.question}
                      </p>
                    </div>
                  </div>

                  {turn.reply && (
                    <div className="border-l-2 border-rose-500 bg-white/88 p-4 shadow-sm">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Bot className="h-4 w-4 text-rose-500" />
                          <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
                            Strategy_bot
                          </span>
                          <span className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-emerald-600">
                            processed
                          </span>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-400">
                          intent: {turn.reply.intent}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                        {turn.reply.answer}
                      </p>
                      <RefusalBanner refusals={turn.reply.refusals} />
                      <EvidenceCards
                        session={turn.reply.session}
                        driver={turn.reply.driver}
                        pitStop={turn.reply.pit_stop}
                        speedWindow={turn.reply.speed_window}
                      />
                      <ToolTraceAccordion trace={turn.reply.trace} />
                    </div>
                  )}

                  {turn.error && (
                    <div className="border-l-2 border-rose-500 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                      {turn.error}
                    </div>
                  )}
                </div>
              ))}

              {loadingQuestion && (
                <div className="border-l-2 border-rose-500 bg-white/88 p-4 shadow-sm">
                  <div className="flex items-center gap-3 text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
                    Synthesizing weather delta with lap history
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {['Resolve session', 'Read telemetry', 'Verify result'].map((step) => (
                      <div key={step} className="h-16 animate-pulse border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                          {step}
                        </div>
                        <div className="mt-3 h-1.5 w-2/3 bg-rose-200" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={ask} className="border-t border-slate-200 bg-white/94 p-3">
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Calculate optimal pit window given incoming rain in 12 mins..."
                  disabled={Boolean(loadingQuestion)}
                  className="min-w-0 flex-1 border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-[12px] placeholder:font-semibold placeholder:text-slate-400 focus:border-rose-400 focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={Boolean(loadingQuestion) || !question.trim()}
                  className="flex h-12 w-12 shrink-0 items-center justify-center bg-rose-600 text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  aria-label="Send question"
                  title="Send question"
                >
                  {loadingQuestion ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="border border-slate-200 bg-white/86 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
            <PanelHeader eyebrow="Sys_status" title="Agent telemetry" />
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-3">
                <MiniMetric
                  label="runtime"
                  value={totalTraceMs ? `${totalTraceMs}ms` : 'idle'}
                  tone={totalTraceMs ? 'green' : 'slate'}
                />
                <MiniMetric label="daily cap" value="10 q" tone="red" />
              </div>
              <div className="border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
                  <Flag className="h-3.5 w-3.5 text-rose-500" />
                  Target Context
                </div>
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="flex items-center justify-between gap-3">
                    <span>Session</span>
                    <strong className="text-right text-slate-800">
                      {latestReply?.session
                        ? `${latestReply.session.year} ${latestReply.session.gp_name}`
                        : 'Awaiting query'}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Driver</span>
                    <strong className="text-right text-slate-800">
                      {latestReply?.driver
                        ? `${latestReply.driver.full_name} #${latestReply.driver.driver_number}`
                        : 'Unresolved'}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="border border-slate-200 bg-white/86 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
            <PanelHeader eyebrow="Runtime_logs" title="Latest signals" />
            <div className="divide-y divide-slate-200 text-[11px]">
              {latestReply?.trace.length ? (
                latestReply.trace.slice(0, 5).map((call, index) => (
                  <div key={`${call.tool_name}-${index}`} className="p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-extrabold uppercase tracking-[0.06em] text-rose-500">
                        [{call.tool_name}]
                      </span>
                      <span className="font-mono text-[10px] font-bold text-slate-400">
                        {call.duration_ms ?? 0}ms
                      </span>
                    </div>
                    <p className="line-clamp-2 leading-5 text-slate-500">{call.output_summary ?? call.input_summary}</p>
                  </div>
                ))
              ) : (
                <div className="p-4 text-slate-500">
                  <div className="mb-2 flex items-center gap-2 font-black uppercase text-slate-400">
                    <Terminal className="h-3.5 w-3.5" />
                    Waiting for first run
                  </div>
                  <p className="leading-5">
                    Tool call summaries will appear here after the agent resolves a race question.
                  </p>
                </div>
              )}
              {latestError && (
                <div className="bg-rose-50 p-3 font-bold text-rose-600">
                  [ERROR] {latestError}
                </div>
              )}
            </div>
          </section>

          <section className="border border-slate-200 bg-white/86 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
              <Clock3 className="h-3.5 w-3.5 text-rose-500" />
              Next build targets
            </div>
            <div className="mt-3 space-y-2">
              {['Conversation persistence', 'Usage remaining API', 'Admin trace surface'].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  {item}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
