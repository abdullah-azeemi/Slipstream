'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

export default function HeroMedia() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [renderVideo, setRenderVideo] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setRenderVideo(!mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !renderVideo) {
      setReady(false)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => {})
        else video.pause()
      },
      { threshold: 0.35 },
    )
    observer.observe(video)
    return () => {
      observer.disconnect()
      video.pause()
    }
  }, [renderVideo])

  return (
    <div className="media-box">
      <Image
        src="/LandingPage3-poster.jpg"
        alt="Two Formula 1 cars racing through a corner, shown as a preview of the Slipstream telemetry view"
        fill
        priority
        sizes="(max-width: 1000px) 100vw, 1000px"
        style={{ objectFit: 'cover' }}
      />
      {renderVideo ? (
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          poster="/LandingPage3-poster.jpg"
          aria-hidden="true"
          onCanPlay={() => setReady(true)}
          style={{ opacity: ready ? 1 : 0 }}
        >
          <source src="/LandingPage3.webm" type="video/webm" />
          <source src="/LandingPage3.mp4" type="video/mp4" />
        </video>
      ) : null}
    </div>
  )
}
