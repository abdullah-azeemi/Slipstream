import type { AnalystEvent } from '@/types/analyst'

/**
 * Delay (ms) before each event when replaying a stored run. Real gaps are kept
 * proportionally but capped, so a 20 s sandbox call replays in a couple of seconds.
 */
export function replayDelays(events: AnalystEvent[], speed = 1, maxGapMs = 1400, minGapMs = 120): number[] {
  return events.map((ev, i) => {
    if (i === 0) return 0
    const gap = ev.t_ms - events[i - 1].t_ms
    return Math.round(Math.min(Math.max(gap, minGapMs), maxGapMs) / speed)
  })
}
