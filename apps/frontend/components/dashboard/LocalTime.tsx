'use client'

import { useEffect, useState } from 'react'

/** Formats a UTC ISO time in the viewer's own timezone (after mount, so server and client agree). */
export default function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    const d = new Date(iso)
    setText(
      Number.isNaN(d.getTime())
        ? 'Time to be confirmed'
        : d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    )
  }, [iso])
  return <time dateTime={iso} className={className}>{text ?? ' '}</time>
}
