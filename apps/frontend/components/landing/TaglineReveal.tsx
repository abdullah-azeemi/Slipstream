'use client'

import { useEffect, useRef } from 'react'

/**
 * Large type moment. Words start muted and switch to full colour one at a
 * time as each one crosses a trigger line 60% down the viewport.
 */
export default function TaglineReveal({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const words = Array.from(el.querySelectorAll<HTMLElement>('.word'))

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      words.forEach(w => w.classList.add('on'))
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('on')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -40% 0px', threshold: 0 },
    )
    words.forEach(w => observer.observe(w))
    return () => observer.disconnect()
  }, [])

  return (
    <p ref={ref} className="heading-2" aria-label={text}>
      {text.split(' ').map((word, i) => (
        <span key={`${word}-${i}`}>
          {i > 0 ? ' ' : null}
          <span className="word" aria-hidden="true">{word}</span>
        </span>
      ))}
    </p>
  )
}
