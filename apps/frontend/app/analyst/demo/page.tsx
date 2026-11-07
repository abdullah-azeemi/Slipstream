'use client'

import { useEffect, useMemo, useState } from 'react'
import '@/components/landing/landing.css'
import AnalystCanvas from '@/components/analyst/AnalystCanvas'
import AnswerPanel from '@/components/analyst/AnswerPanel'
import { useReplay } from '@/components/analyst/useReplay'
import { reduceEvents } from '@/lib/analyst-graph'
import demoRun from '@/lib/analyst-demo-run.json'
import type { AnalystEvent } from '@/types/analyst'

/** Public sample run: real computation on 2026 Singapore GP data, scripted model turns. */
export default function AnalystDemoPage() {
  const { events, playing, play } = useReplay()
  const run = useMemo(() => reduceEvents(events), [events])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    play(demoRun as AnalystEvent[], 1.4)
  }, [play])

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col">
      <div className="an-mono border-b border-[#e3e6e3] bg-[#f6f4ef] px-4 py-2 text-[12px] text-[#5a666b]">
        Sample run. The numbers are computed for real from 2026 Singapore GP lap data in a sandbox; the model&apos;s narration is scripted.
        <button onClick={() => play(demoRun as AnalystEvent[], 1.4)} disabled={playing} className="ml-3 rounded border border-[#b9c4c6] bg-white px-2 py-0.5 disabled:opacity-50">
          {playing ? 'playing…' : 'replay'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[360px] flex-1">
          <AnalystCanvas run={run} selectedId={selected} onSelect={setSelected} />
        </div>
        <aside className="w-full border-t border-[#e3e6e3] bg-white lg:w-[440px] lg:border-l lg:border-t-0">
          <AnswerPanel run={run} selectedId={selected} onSelect={setSelected} />
        </aside>
      </div>
    </div>
  )
}
