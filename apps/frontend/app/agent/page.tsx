'use client'

import { useAuth, UserButton } from '@clerk/nextjs'
import { useState } from 'react'
import { API_URL } from '@/lib/api'

type AgentResponse = {
  answer: string
  refusals: string[]
}

export default function AgentPage() {
  const { getToken } = useAuth()
  const [question, setQuestion] = useState('')
  const [reply, setReply] = useState<AgentResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const resp = await fetch(`${API_URL}/api/v1/agent/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => null)
        throw new Error(body?.error ?? `Request failed (${resp.status})`)
      }
      setReply(await resp.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Race Engineer</h1>
        <UserButton />
      </div>

      <form onSubmit={ask} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Where did Sainz pit in Monaco 2026?"
          className="flex-1 rounded border px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {error && <p className="mt-4 rounded bg-red-100 p-3 text-red-700">{error}</p>}
      {reply && (
        <div className="mt-4 rounded bg-slate-100 p-3">
          <p>{reply.answer}</p>
          {reply.refusals.length > 0 && (
            <p className="mt-2 text-sm text-amber-700">Refusals: {reply.refusals.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}