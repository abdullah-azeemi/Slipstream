'use client'

import { useAuth, UserButton } from '@clerk/nextjs'
import {
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircuitBoard,
  Clock3,
  Database,
  Gauge,
  History,
  Loader2,
  Menu,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
  CircleHelp,
  ThumbsUp,
  ThumbsDown,
  Search,
  Flame,
  ChevronDown,
  Download,
  Mic,
  ArrowRight,
  Map,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import EvidenceCards from '@/components/agent/EvidenceCards'
import AgentProgressRail from '@/components/agent/AgentProgressRail'
import AgentSpeedChart from '@/components/agent/AgentSpeedChart'
import TelemetryOverlayChart from '@/components/agent/TelemetryOverlayChart'
import CircuitHeatmap from '@/components/agent/CircuitHeatmap'
import RadioClip from '@/components/agent/RadioClip'
import WeatherEvidence from '@/components/agent/WeatherEvidence'
import TyreDegradationChart from '@/components/agent/TyreDegradationChart'
import RefusalBanner from '@/components/agent/RefusalBanner'
import ToolTraceAccordion from '@/components/agent/ToolTraceAccordion'
import ReasoningGraphCanvas from '@/components/agent/ReasoningGraphCanvas'
import NodeInspectorDrawer from '@/components/agent/NodeInspectorDrawer'
import { buildNodeInspectorView, type NodeInspectorView } from '@/lib/node-inspector'
import { topoRankMap } from '@/lib/dag-layout'
import { agentApi, API_URL } from '@/lib/api'
import {
  AgentAnswer,
  AgentDAGEdge,
  AgentDAGNode,
  AgentNodeRunInfo,
  AgentProgressEvent,
  AdminStats,
  ConversationSummary,
  FeedbackStats,
  UsageInfo,
} from '@/types/agent'

const SUGGESTED_QUESTIONS = [
  'Where did Sainz pit in Monaco 2026?',
  "What was Verstappen's pit stop speed in Monaco 2026?",
  'On which lap did Sainz pit in Monaco 2026 and what was his avg speed before and after?',
]

type CanvasPhase = 'idle' | 'running' | 'completing' | 'minimap' | 'expanded'

type ChatTurn = {
  id: number
  question: string
  reply: AgentAnswer | null
  error: string | null
  progress: AgentProgressEvent[]
  nodes: AgentDAGNode[]
  edges: AgentDAGEdge[]
  nodeStates: Record<string, AgentNodeRunInfo>
  rating: number | null
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

function applyNodeEvent(
  states: Record<string, AgentNodeRunInfo>,
  event: AgentProgressEvent
): Record<string, AgentNodeRunInfo> {
  if (!event.node_id) return states
  const nodeId = event.node_id
  if (event.type === 'node_start') {
    return {
      ...states,
      [nodeId]: { state: 'running', query_preview: event.query_preview ?? undefined },
    }
  }
  if (event.type === 'node_complete') {
    return {
      ...states,
      [nodeId]: { state: 'done', duration_ms: event.duration_ms, summary: event.summary },
    }
  }
  if (event.type === 'node_error') {
    return {
      ...states,
      [nodeId]: { state: 'error', duration_ms: event.duration_ms, error: event.error },
    }
  }
  if (event.type === 'self_correcting') {
    return {
      ...states,
      [nodeId]: { state: 'self_correcting' },
    }
  }
  return states
}

export default function AgentPage() {
  const { getToken } = useAuth()

  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [loadingQuestion, setLoadingQuestion] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [canvasPhase, setCanvasPhase] = useState<CanvasPhase>('idle')
  const [canvasTurnId, setCanvasTurnId] = useState<number | null>(null)
  const [animationIndex, setAnimationIndex] = useState<Record<string, number>>({})
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const dissolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  const latestReply = useMemo(
    () => [...turns].reverse().find((turn) => turn.reply)?.reply ?? null,
    [turns]
  )
  const latestDagTurn = useMemo(
    () => [...turns].reverse().find((turn) => turn.nodes.length > 0) ?? null,
    [turns]
  )
  const canvasTurn = useMemo(
    () =>
      (canvasTurnId !== null ? turns.find((turn) => turn.id === canvasTurnId) : null) ??
      (loadingQuestion
        ? [...turns].reverse().find((turn) => turn.question === loadingQuestion)
        : null) ??
      latestDagTurn,
    [canvasTurnId, latestDagTurn, loadingQuestion, turns]
  )
  const selectedNodeView = useMemo<NodeInspectorView | null>(() => {
    if (!selectedNodeId || !canvasTurn) return null
    const node = canvasTurn.nodes.find((item) => item.id === selectedNodeId)
    if (!node) return null
    const info = canvasTurn.nodeStates[selectedNodeId] ?? { state: 'idle' }
    const call = canvasTurn.reply?.trace.find((item) => item.node_id === selectedNodeId) ?? null
    return buildNodeInspectorView(node, info, call)
  }, [canvasTurn, selectedNodeId])
  const successfulRuns = turns.filter((turn) => turn.reply && !turn.reply.refusals.length).length
  const refusedRuns = turns.filter((turn) => turn.reply?.refusals.length).length
  const traceCount = latestReply?.trace.length ?? 0
  const totalTraceMs =
    latestReply?.trace.reduce((sum, call) => sum + (call.duration_ms ?? 0), 0) ?? 0
  const activeTurnHasProgress = turns.some(
    (turn) => turn.question === loadingQuestion && !turn.reply && turn.progress.length > 0
  )
  const canvasVisible =
    canvasPhase === 'running' || canvasPhase === 'completing' || canvasPhase === 'expanded'

  // The active question/intent for passing to the canvas root node
  const activeQuestion = canvasTurn?.question ?? loadingQuestion ?? ''
  const activeIntent = canvasTurn?.reply?.intent ?? ''

  // Auto-scroll chat to bottom when new content arrives
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [turns, loadingQuestion])

  useEffect(() => {
    agentApi.listConversations(getToken).then(setConversations).catch(() => {})
  }, [getToken])

  useEffect(() => {
    agentApi.getUsage(getToken).then(setUsage).catch(() => {})
  }, [getToken])

  useEffect(() => {
    agentApi.getAdminStats(getToken).then(setAdminStats).catch(() => {})
  }, [getToken])

  useEffect(() => {
    agentApi.getFeedbackStats(getToken).then(setFeedbackStats).catch(() => {})
  }, [getToken])

  useEffect(() => {
    return () => {
      if (dissolveTimer.current) clearTimeout(dissolveTimer.current)
    }
  }, [])

  async function loadConversation(convId: number) {
    setLoadingHistory(true)
    setSidebarOpen(false)
    try {
      const detail = await agentApi.getConversation(convId, getToken)
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
            progress: [],
            nodes: [],
            edges: [],
            nodeStates: {},
            rating: null,
          })
        }
      }
      setTurns(loaded)
      setConversationId(convId)
      setCanvasPhase('idle')
      setCanvasTurnId(null)
      setSelectedNodeId(null)
      if (dissolveTimer.current) clearTimeout(dissolveTimer.current)
    } catch {
      // Silently fail
    } finally {
      setLoadingHistory(false)
    }
  }

  function newConversation() {
    setTurns([])
    setConversationId(null)
    setCanvasPhase('idle')
    setCanvasTurnId(null)
    setSelectedNodeId(null)
    setSidebarOpen(false)
    if (dissolveTimer.current) clearTimeout(dissolveTimer.current)
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || loadingQuestion) return

    const id = Date.now()
    setLoadingQuestion(trimmed)
    setQuestion('')
    setSelectedNodeId(null)
    setCanvasTurnId(id)
    setTurns((current) => [...current, { id, question: trimmed, reply: null, error: null, progress: [], nodes: [], edges: [], nodeStates: {}, rating: null }])
    setCanvasPhase('running')

    try {
      const token = await getToken()

      const resp = await fetch(`${API_URL}/api/v1/agent/query/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
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

      if (!resp.body) throw new Error('Streaming response was empty')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const streamResult: { reply: AgentAnswer | null } = { reply: null }

      function handleFrame(frame: string) {
        const lines = frame.split('\n')
        const event = lines
          .find((line) => line.startsWith('event:'))
          ?.replace('event:', '')
          .trim()
        const dataLine = lines
          .find((line) => line.startsWith('data:'))
          ?.replace('data:', '')
          .trim()
        if (!event || !dataLine) return

        const payload = JSON.parse(dataLine)
        if (event === 'progress') {
          const p = payload as AgentProgressEvent
          if (p.type === 'dag_init' && Array.isArray(p.nodes)) {
            setAnimationIndex(topoRankMap(p.nodes as AgentDAGNode[]))
          }
          setTurns((current) =>
            current.map((turn) =>
              turn.id === id
                ? {
                    ...turn,
                    progress: [...turn.progress, p],
                    nodes:
                      p.type === 'dag_init' && Array.isArray(p.nodes)
                        ? (p.nodes as AgentDAGNode[])
                        : turn.nodes,
                    edges:
                      p.type === 'dag_init' && Array.isArray(p.edges)
                        ? (p.edges as AgentDAGEdge[])
                        : turn.edges,
                    nodeStates: applyNodeEvent(turn.nodeStates, p),
                  }
                : turn
            )
          )
        }
        if (event === 'final') {
          streamResult.reply = payload as AgentAnswer
          setTurns((current) =>
            current.map((turn) =>
              turn.id === id ? { ...turn, reply: streamResult.reply, error: null } : turn
            )
          )
          setCanvasPhase('completing')
          if (dissolveTimer.current) clearTimeout(dissolveTimer.current)
          dissolveTimer.current = setTimeout(() => setCanvasPhase('minimap'), 700)
        }
        if (event === 'error') throw new Error(payload?.error ?? 'Agent stream failed')
      }

      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          if (frame.trim()) handleFrame(frame)
        }
        if (done) break
      }
      if (buffer.trim()) handleFrame(buffer)

      const reply = streamResult.reply
      if (!reply) throw new Error('Agent stream ended without a final answer')

      if (reply.conversation_id) {
        setConversationId(reply.conversation_id)
        agentApi.listConversations(getToken).then(setConversations).catch(() => {})
      }
      agentApi.getUsage(getToken).then(setUsage).catch(() => {})
      agentApi.getAdminStats(getToken).then(setAdminStats).catch(() => {})
      agentApi.getFeedbackStats(getToken).then(setFeedbackStats).catch(() => {})
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setTurns((current) =>
        current.map((turn) => (turn.id === id ? { ...turn, reply: null, error: message } : turn))
      )
      setCanvasPhase('minimap')
    } finally {
      setLoadingQuestion(null)
    }
  }

  function fillSuggestion(q: string) {
    setQuestion(q)
  }

  async function rateAnswer(turnId: number, rating: number) {
    const turn = turns.find((t) => t.id === turnId)
    const runId = turn?.reply?.run_id
    if (!runId) return

    try {
      if (turn.rating === rating) {
        await agentApi.clearFeedback(runId, getToken)
        setTurns((current) =>
          current.map((t) => (t.id === turnId ? { ...t, rating: null } : t))
        )
      } else {
        await agentApi.rateRun(runId, rating as 1 | -1, getToken)
        setTurns((current) =>
          current.map((t) => (t.id === turnId ? { ...t, rating } : t))
        )
      }
      agentApi.getFeedbackStats(getToken).then(setFeedbackStats).catch(() => {})
    } catch {
      // Silent
    }
  }

  // ── Sidebar content (shared between desktop and mobile drawer) ──────────────
  const SidebarContent = (
    <div className="flex h-full flex-col bg-white">
      {/* Top logo */}
      <div className="p-6 flex items-center gap-4 border-b border-slate-100">
        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold text-sm">S</div>
        <div>
          <div className="text-[13px] font-extrabold tracking-[0.1em] text-black flex items-center gap-2">
            SLIPSTREAM <span className="text-[8px] font-bold px-1.5 py-0.5 border border-slate-200 rounded text-slate-500">PRO</span>
          </div>
          <div className="text-[9px] text-slate-400 font-bold tracking-[0.15em] mt-0.5">TELEMETRY AGENT V2.4</div>
        </div>
      </div>

      <div className="px-5 pt-6 pb-4">
        <button className="w-full bg-[#1A1A1A] text-white rounded-lg flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-black transition-colors" onClick={newConversation}>
          <div className="flex items-center gap-2 text-xs font-semibold"><Plus className="w-4 h-4 text-rose-500" /> New Pit Wall Inquiry</div>
          <div className="text-[10px] text-slate-400 font-mono bg-white/10 px-1.5 py-0.5 rounded">⌘N</div>
        </button>
      </div>

      <div className="px-5 pb-6">
        <div className="relative">
          <input type="text" placeholder="Search telemetries & logs..." className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 placeholder-slate-400 focus:outline-none focus:border-rose-400" />
          <div className="absolute left-3 top-2.5"><Search className="w-4 h-4 text-slate-400" /></div>
          <div className="absolute right-3 top-2.5"><div className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">⌘K</div></div>
        </div>
      </div>

      <div className="px-3 space-y-1">
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-rose-50/50 text-rose-600 font-semibold text-xs border border-rose-100/50">
          <div className="flex items-center gap-2"><Zap className="w-4 h-4" /> Live Strategy Orchestrator</div>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 text-slate-500 font-medium text-xs hover:bg-slate-50 rounded-lg cursor-pointer">
          <History className="w-4 h-4 text-slate-400" /> Historical FIA Archive
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 text-slate-500 font-medium text-xs hover:bg-slate-50 rounded-lg cursor-pointer">
          <ShieldCheck className="w-4 h-4 text-slate-400" /> Deterministic Evidence Gate
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 mt-2">
        <div className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400 mb-4">Today's Sessions</div>
        <div className="space-y-1 mb-8">
           <div className="text-xs text-black font-semibold px-2 py-1.5 bg-rose-50/50 border border-rose-100/50 rounded flex items-center gap-2 cursor-pointer"><div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div> Sainz pit telemetry · Monaco 2026</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Hamilton vs Russell S2 delta</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Silverstone crossover lap 32 forecast</div>
        </div>
        
        <div className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400 mb-4">Yesterday</div>
        <div className="space-y-1 mb-8">
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Leclerc apex speed comparison T3</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Red Bull front wing aero wake balance</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Verstappen pit stop stationary vs in-lap</div>
        </div>

        <div className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-slate-400 mb-4">Prior Grands Prix</div>
        <div className="space-y-1 mb-8">
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Miami DRS train degradation model</div>
           <div className="text-xs font-medium text-slate-500 px-3 py-1.5 hover:text-black cursor-pointer">Spa-Francorchamps Eau Rouge vMin</div>
        </div>
      </div>

      <div className="p-5 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
         <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#1A1A1A] flex items-center justify-center text-white text-[10px] font-bold">CS</div>
            <div>
               <div className="text-xs font-bold text-black">Chief Strategist</div>
               <div className="text-[10px] text-slate-400 font-mono mt-0.5">Telemetry Unit 01</div>
            </div>
         </div>
         <Radio className="w-4 h-4 text-slate-300" />
      </div>
    </div>
  )

  return (
    <div className="agent-page-root flex h-screen w-full bg-[#FDFDFD] text-slate-900 font-sans overflow-hidden">
      
      {/* ── Mobile sidebar drawer overlay ──────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-300 sm:hidden ${
          sidebarOpen ? 'flex translate-x-0' : 'hidden -translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
           <div className="text-xs font-bold">Menu</div>
           <button onClick={() => setSidebarOpen(false)} className="p-1"><X className="w-4 h-4" /></button>
        </div>
        {SidebarContent}
      </aside>

      {/* ── Main 2-col layout ────────────────────────── */}
      
      {/* ── Left sidebar (desktop only) ───────────── */}
      <aside className="hidden sm:flex flex-col w-[280px] shrink-0 border-r border-slate-200 bg-white shadow-[10px_0_40px_rgba(0,0,0,0.02)] z-10">
        {SidebarContent}
      </aside>

      {/* ── Center panel (chat) ──────────── */}
      <section className="flex flex-col flex-1 bg-[#FAFAFA] min-w-0 h-full relative">
        
        {/* Topbar */}
        <div className="h-16 px-8 border-b border-slate-100 flex items-center justify-between bg-white shrink-0 absolute top-0 left-0 right-0 z-20">
           <div className="flex items-center gap-6">
              <button onClick={() => setSidebarOpen(true)} className="sm:hidden p-1 -ml-2"><Menu className="w-5 h-5 text-slate-500" /></button>
              <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-black">
                 <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                 STRATEGY_BOT // ACTIVE SESSION
              </div>
              <div className="w-px h-4 bg-slate-200 hidden sm:block"></div>
              <div className="text-xs text-slate-500 font-medium hidden sm:block">2026 Monaco Grand Prix</div>
           </div>
           <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 text-[11px] font-bold text-slate-600 bg-slate-50/50">
                 <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                 FIA Feed 12ms
              </div>
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 bg-white shadow-sm">
                 <Database className="w-3.5 h-3.5 text-rose-500" />
                 Telemetry Hybrid Engine v2.4
                 <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
              </div>
              <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 bg-white hover:bg-slate-50 shadow-sm transition-colors">
                 <Download className="w-3.5 h-3.5" />
                 <span className="hidden sm:inline">Export Stint Data</span>
              </button>
           </div>
        </div>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto pt-16 pb-32 scroll-smooth" ref={chatScrollRef}>
            
            {/* Idle State */}
            {turns.length === 0 && !loadingQuestion && (
              <div className="flex flex-col items-center justify-center min-h-full p-8 max-w-4xl mx-auto w-full pt-20">
                 <div className="w-24 h-24 mb-10 rounded-full bg-rose-50/50 flex items-center justify-center relative">
                    <div className="absolute inset-0 rounded-full bg-rose-100/30 blur-xl"></div>
                    <div className="absolute inset-2 rounded-full border border-rose-200/50 shadow-[0_0_30px_rgba(244,63,94,0.2)]"></div>
                    <Flame className="w-8 h-8 text-rose-500 relative z-10" strokeWidth={1.5} />
                 </div>
                 
                 <h1 className="text-[44px] text-center mb-5 text-black tracking-tight leading-tight">
                    <span className="font-serif text-slate-700">Hello, </span>
                    <span className="font-serif italic text-slate-800">Chief Strategist</span>
                    <br />
                    <span className="font-medium text-slate-900">How can the pit wall assist you today?</span>
                 </h1>
                 
                 <p className="text-slate-500 text-center max-w-2xl mb-16 text-[13px] font-medium leading-relaxed">
                    Deterministic sensor calculations paired with multi-step reasoning. Real-time sector times,<br/>tyre degradation degradation vectors, and pit window models.
                 </p>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-rose-200 transition-all cursor-pointer group" onClick={() => fillSuggestion("Compare Hard (C3) vs Medium (C4) wear degradation slopes for Ferrari past Lap 35 under green flag.")}>
                       <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 group-hover:scale-125 transition-transform"></div>
                          <div className="text-[13px] font-bold text-slate-800">Synthesize Tyre Degradation</div>
                       </div>
                       <p className="text-[11px] text-slate-500 font-medium leading-relaxed pl-3.5">Compare Hard (C3) vs Medium (C4) wear degradation slopes for Ferrari past Lap 35 under green flag.</p>
                    </div>
                    
                    <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all cursor-pointer group" onClick={() => fillSuggestion("Calculate minimum gap requirement for Sainz to jump Verstappen at Monaco Saint-Dévote.")}>
                       <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 group-hover:scale-125 transition-transform"></div>
                          <div className="text-[13px] font-bold text-slate-800">Pit Window Undercut Solver</div>
                       </div>
                       <p className="text-[11px] text-slate-500 font-medium leading-relaxed pl-3.5">Calculate minimum gap requirement for Sainz to jump Verstappen at Monaco Saint-Dévote.</p>
                    </div>
                    
                    <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-amber-200 transition-all cursor-pointer group" onClick={() => fillSuggestion("Overlay Norris vs Leclerc minimum cornering speeds across Rascasse and the Swimming Pool chicane.")}>
                       <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 group-hover:scale-125 transition-transform"></div>
                          <div className="text-[13px] font-bold text-slate-800">Apex Speed Delta Overlay</div>
                       </div>
                       <p className="text-[11px] text-slate-500 font-medium leading-relaxed pl-3.5">Overlay Norris vs Leclerc minimum cornering speeds across Rascasse and the Swimming Pool chicane.</p>
                    </div>
                    
                    <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group" onClick={() => fillSuggestion("Model 4°C track temperature drop impact on front-left graining threshold within 12 laps.")}>
                       <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 group-hover:scale-125 transition-transform"></div>
                          <div className="text-[13px] font-bold text-slate-800">Weather Radar Stint Impact</div>
                       </div>
                       <p className="text-[11px] text-slate-500 font-medium leading-relaxed pl-3.5">Model 4°C track temperature drop impact on front-left graining threshold within 12 laps.</p>
                    </div>
                 </div>
              </div>
            )}

            {/* Active Stream Divider */}
            {turns.length > 0 && (
              <div className="max-w-4xl mx-auto px-8 py-10 flex items-center justify-center gap-4">
                 <div className="h-px bg-slate-200 flex-1"></div>
                 <div className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-400">Active Stream</div>
                 <div className="h-px bg-slate-200 flex-1"></div>
              </div>
            )}

            {/* Chat Turns */}
            <div className="max-w-4xl mx-auto px-6 sm:px-8 space-y-12 pb-10">
              {turns.map((turn) => (
                <div key={turn.id} className="flex flex-col gap-6">
                  
                  {/* User bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] border border-slate-200 bg-white rounded-2xl rounded-tr-sm px-6 py-5 shadow-sm flex flex-col gap-3">
                      <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                        <span>CHIEF_STRATEGIST · {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                      </div>
                      <p className="text-[14px] font-medium leading-relaxed text-slate-800">{turn.question}</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center text-[10px] font-bold shrink-0 ml-4 mt-2">CS</div>
                  </div>

                  {/* Agent Response */}
                  {(turn.nodes.length > 0 || turn.reply) && (
                    <div className="flex gap-4 w-full">
                       <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 mt-1 shadow-md shadow-rose-500/20">
                          <Zap className="w-4 h-4" />
                       </div>
                       
                       <div className="flex-1 flex flex-col gap-4">
                          
                          {/* Final Answer Text */}
                          {turn.reply && (
                            <>
                              <div className="pitwall-prose answer-reveal bg-white rounded-2xl p-6 border border-slate-100 shadow-sm text-[15px] leading-relaxed text-slate-700">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.reply.answer}</ReactMarkdown>
                              </div>
                              {turn.nodes.length > 0 && (
                                <div className="flex items-center gap-3 pl-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCanvasTurnId(turn.id)
                                      setSelectedNodeId(null)
                                      setCanvasPhase('expanded')
                                    }}
                                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-rose-200 hover:text-rose-600"
                                    aria-label={`View execution graph for ${turn.question}`}
                                  >
                                    <CircuitBoard className="h-3.5 w-3.5 text-rose-500" />
                                    View execution flow
                                    <span className="border-l border-slate-200 pl-2 text-[10px] font-medium text-slate-400">
                                      {turn.nodes.length} steps
                                    </span>
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          
                       </div>
                    </div>
                  )}

                </div>
              ))}
              
              {loadingQuestion && !turns.find(t => t.question === loadingQuestion)?.reply && (
                <div className="flex justify-end opacity-60">
                   <div className="max-w-[85%] border border-slate-200 bg-white rounded-2xl rounded-tr-sm px-6 py-4 flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce"></div>
                      <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce delay-75"></div>
                      <div className="w-2 h-2 rounded-full bg-rose-500 animate-bounce delay-150"></div>
                   </div>
                   <div className="w-8 h-8 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center text-[10px] font-bold shrink-0 ml-4">CS</div>
                </div>
              )}
            </div>
            
        </div>
        
        {/* Floating Input area */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#FAFAFA] via-[#FAFAFA]/90 to-transparent pointer-events-none">
          <form
            onSubmit={ask}
            className="mx-auto max-w-3xl relative bg-white border border-slate-200 rounded-2xl shadow-[0_8px_40px_rgb(0,0,0,0.08)] p-3 flex flex-col gap-3 pointer-events-auto transition-shadow hover:shadow-[0_8px_40px_rgb(0,0,0,0.12)]"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="In British GP 2024, when did Carlos pit?"
              className="w-full text-[15px] font-medium bg-transparent border-none px-3 pt-2 pb-1 focus:ring-0 focus:outline-none placeholder-slate-400 text-slate-800"
            />
            <div className="flex items-center justify-between px-2">
               <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 text-slate-500 rounded-md flex shrink-0 text-[11px] font-bold border border-slate-100">
                     <Database className="w-3 h-3 text-rose-500" /> Telemetry Ingestion
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 text-slate-500 rounded-md shrink-0 text-[11px] font-bold border border-slate-100">
                     <Map className="w-3 h-3 text-slate-400" /> Silverstone Circuit
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-100 rounded-md shrink-0 text-[11px] font-bold">
                     Multi-Stint Delta
                  </div>
               </div>
               <div className="flex items-center gap-3 shrink-0 ml-4">
                  <Mic className="w-5 h-5 text-slate-300 cursor-pointer hover:text-slate-600 transition-colors" />
                  <button type="submit" disabled={!question.trim() || loadingQuestion} className="w-10 h-10 rounded-full bg-rose-600 flex items-center justify-center text-white hover:bg-rose-500 transition-all disabled:opacity-50 disabled:hover:bg-rose-600 shadow-md shadow-rose-500/20">
                     {loadingQuestion ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                  </button>
               </div>
            </div>
          </form>
          <div className="text-center mt-4 mb-2 text-[9px] text-slate-400 font-mono tracking-widest uppercase">
             Slipstream Neural Kernel 2.4. Telemetry verified via FIA Technical Regulation Appx L.
          </div>
        </div>
        {canvasVisible && (
          <div
            className={`absolute inset-x-0 bottom-0 top-16 z-30 flex flex-col bg-[#F2F4FA] ${
              canvasPhase === 'completing' ? 'canvas-dissolving' : ''
            }`}
            aria-label="Agent execution graph"
          >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 sm:px-7">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-rose-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${canvasPhase === 'running' ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'}`} />
                  {canvasPhase === 'running'
                    ? activeTurnHasProgress
                      ? 'Live execution'
                      : 'Planning execution'
                    : canvasPhase === 'completing'
                      ? 'Result ready'
                      : 'Completed execution'}
                </div>
                <h2 className="mt-1 text-sm font-bold uppercase tracking-[0.06em] text-slate-800">
                  Directed Acyclic Graph Canvas
                </h2>
                <p className="mt-1 truncate text-[11px] text-slate-500">{activeQuestion}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-500">
                  {canvasTurn?.nodes.length ?? 0} NODES
                </span>
                {canvasPhase === 'expanded' && (
                  <button
                    type="button"
                    onClick={() => {
                      setCanvasPhase('minimap')
                      setSelectedNodeId(null)
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:text-rose-600"
                  >
                    Back to answer
                  </button>
                )}
              </div>
            </div>

            <div className="relative min-h-0 flex-1">
              <ReasoningGraphCanvas
                nodes={canvasTurn?.nodes ?? []}
                edges={canvasTurn?.edges ?? []}
                states={canvasTurn?.nodeStates ?? {}}
                onSelectNode={setSelectedNodeId}
                selectedNodeId={selectedNodeId}
                phase={canvasPhase === 'completing' ? 'completing' : canvasPhase === 'expanded' ? 'expanded' : 'running'}
                animationIndex={animationIndex}
                question={activeQuestion}
                intent={activeIntent}
              />
              <NodeInspectorDrawer view={selectedNodeView} onClose={() => setSelectedNodeId(null)} />
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
