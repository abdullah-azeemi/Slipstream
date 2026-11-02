'use client'

import { useEffect } from 'react'

/**
 * Adds scroll reveals to every `.reveal` element inside `.lp`.
 * Each element reveals once, using a single IntersectionObserver.
 * Without JavaScript the elements stay visible (the hidden state is gated on `.js`).
 */
export default function RevealController() {
  useEffect(() => {
    const root = document.querySelector('.lp')
    if (!root) return
    root.classList.add('js')

    const targets = Array.from(root.querySelectorAll('.reveal'))
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    targets.forEach(el => observer.observe(el))

    return () => observer.disconnect()
  }, [])

  return null
}
