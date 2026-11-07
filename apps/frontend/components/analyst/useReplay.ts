'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalystEvent } from '@/types/analyst'
import { replayDelays } from '@/lib/analyst-replay'

/** Feeds a stored event log into state with (capped) original timing. */
export function useReplay() {
  const [events, setEvents] = useState<AnalystEvent[]>([])
  const [playing, setPlaying] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setPlaying(false)
  }, [])

  const play = useCallback(
    (log: AnalystEvent[], speed = 1) => {
      stop()
      setEvents([])
      if (!log.length) return
      const delays = replayDelays(log, speed)
      setPlaying(true)
      const step = (i: number) => {
        setEvents(log.slice(0, i + 1))
        if (i + 1 >= log.length) {
          setPlaying(false)
          return
        }
        timer.current = setTimeout(() => step(i + 1), delays[i + 1])
      }
      step(0)
    },
    [stop]
  )

  useEffect(() => stop, [stop])

  return { events, setEvents, playing, play, stop }
}
