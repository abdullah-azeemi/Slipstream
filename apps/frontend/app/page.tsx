'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Zap, ChevronDown } from 'lucide-react'

function LandingHeroMedia() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [shouldRenderVideo, setShouldRenderVideo] = useState(false)
  const [videoReady, setVideoReady] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    const syncMotionPreference = () => {
      setShouldRenderVideo(!mediaQuery.matches)
    }

    syncMotionPreference()
    mediaQuery.addEventListener('change', syncMotionPreference)

    return () => {
      mediaQuery.removeEventListener('change', syncMotionPreference)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current

    if (!video || !shouldRenderVideo) {
      setVideoReady(false)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void video.play().catch(() => {})
          return
        }

        video.pause()
      },
      { threshold: 0.35 },
    )

    observer.observe(video)

    return () => {
      observer.disconnect()
      video.pause()
    }
  }, [shouldRenderVideo])

  return (
    <>
      <Image
        src="/LandingPage3-poster.jpg"
        alt="Pitwall landing page hero preview"
        fill
        priority
        sizes="(max-width: 768px) 100vw, 1000px"
        style={{ objectFit: 'cover' }}
      />
      {shouldRenderVideo ? (
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          poster="/LandingPage3-poster.jpg"
          aria-hidden="true"
          onCanPlay={() => setVideoReady(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: videoReady ? 1 : 0,
            transition: 'opacity 300ms ease',
          }}
        >
          <source src="/LandingPage3.webm" type="video/webm" />
          <source src="/LandingPage3.mp4" type="video/mp4" />
        </video>
      ) : null}
    </>
  )
}

export default function LandingPage() {
  const [activeObjective, setActiveObjective] = useState<number>(0)

  const objectives = [
    {
      title: 'Automated Lap Delta Analysis',
      subtitle: 'Identify exact corner numbers where drivers gain or lose lap time.',
      matchup: 'VER (Red Bull) vs NOR (McLaren)',
      metric: '-0.142s Delta',
      discipline: 'High Frequency 100Hz Sync',
    },
    {
      title: 'Tyre Degradation & Compound Wear',
      subtitle: 'Real-time thermal degradation curves for Soft, Medium, and Hard compounds.',
      matchup: 'LEC (Ferrari) vs RUS (Mercedes)',
      metric: '0.08s / lap wear rate',
      discipline: 'Pirelli C3 Soft Model',
    },
    {
      title: 'Predictive Pit Stop Windows',
      subtitle: 'Undercut and overcut window warnings calculated live during the race.',
      matchup: 'HAM (Ferrari) vs PIA (McLaren)',
      metric: 'Lap 24-27 Pit Window',
      discipline: 'Monte Carlo 10k Sims',
    },
  ]

  return (
    <div style={{ background: '#FFFFFF', color: '#111827', width: '100%', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>

      {/* Responsive Stylesheet */}
      <style>{`
        @media (max-width: 1024px) {
          .hero-section { padding: 4px 20px 24px !important; }
          .spotlight-grid { grid-template-columns: 1fr !important; gap: 40px !important; }
          .spotlight-left { grid-column: span 12 !important; padding: 32px 24px !important; min-height: auto !important; }
          .spotlight-right { grid-column: span 12 !important; }
        }

        @media (max-width: 768px) {
          .landing-header { padding: 0 16px !important; height: 52px !important; }
          .hidden-mobile { display: none !important; }
          .hero-title { font-size: 1.8rem !important; margin-bottom: 16px !important; line-height: 1.15 !important; }
          .hero-video-box { height: auto !important; aspect-ratio: 16 / 9 !important; border-radius: 16px !important; margin-bottom: 24px !important; }
          .hero-subtitle { font-size: 13.5px !important; margin-bottom: 40px !important; }
          .partners-band { padding: 16px 16px !important; margin-bottom: 48px !important; }
          .partners-grid { justify-content: center !important; gap: 16px 24px !important; }
          .spotlight-section { margin-bottom: 64px !important; padding: 0 16px !important; }
          .spotlight-left { padding: 20px 14px !important; border-radius: 18px !important; }
          .mockup-card { padding: 18px 14px !important; border-radius: 14px !important; }
          .mockup-grid { grid-template-columns: 1fr !important; gap: 10px !important; }
          .landing-footer { flex-direction: column !important; text-align: center !important; gap: 16px !important; padding: 24px 16px !important; }
        }

        @media (max-width: 480px) {
          .hidden-xs { display: none !important; }
          .get-started-btn { padding: 7px 14px !important; font-size: 12px !important; }
          .hero-title { font-size: 1.6rem !important; }
        }
      `}</style>

      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      <section className="hero-section" style={{
        maxWidth: 1040,
        margin: '0 auto',
        padding: '4px 24px 24px',
      }}>
        {/* Main Title in Playfair Display Serif */}
        <h1 className="hero-title" style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 'clamp(2.4rem, 4.2vw, 3.6rem)',
          fontWeight: 400,
          letterSpacing: '-0.02em',
          color: '#111827',
          lineHeight: 1.12,
          maxWidth: 840,
          marginBottom: 28,
        }}>
          Master Precision in Motorsport Intelligence
        </h1>

        {/* Hero Video Card (Fluidly Responsive) */}
        <div className="hero-video-box" style={{
          position: 'relative',
          width: '100%',
          maxWidth: 1000,
          height: 'clamp(280px, 50vh, 460px)',
          margin: '0 auto 36px',
          borderRadius: 22,
          overflow: 'hidden',
          background: '#F3F4F6',
          boxShadow: '0 6px 28px rgba(0, 0, 0, 0.07)',
        }}>
          <LandingHeroMedia />
        </div>

        {/* Subtitle Paragraph */}
        <div className="hero-subtitle" style={{ maxWidth: 640, marginBottom: 56 }}>
          <p style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: '#6B7280',
            fontWeight: 400,
          }}>
            This comprehensive platform strips away the unnecessary, focusing on core principles of spatial track relationship, high-frequency telemetry, and real-time pit strategy. Discover how sub-millisecond precision creates superior race execution.
          </p>
        </div>
      </section>

      {/* ── LOGO MARQUEE / PARTNERS BAND ────────────────────────────────────── */}
      <section className="partners-band" style={{
        background: '#FAFAFA',
        borderTop: '1px solid #F3F4F6',
        borderBottom: '1px solid #F3F4F6',
        padding: '20px 5vw',
        marginBottom: 80,
      }}>
        <div className="partners-grid" style={{
          maxWidth: 1040,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 32,
          flexWrap: 'wrap',
          opacity: 0.6,
        }}>
          {['FASTF1', 'OPENF1', 'JOLPICA', 'TIMESCALEDB', 'KAFKA', 'FASTF1'].map((brand, i) => (
            <span key={i} style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.12em',
              color: '#374151',
              fontFamily: 'Inter, sans-serif',
            }}>
              {brand}
            </span>
          ))}
        </div>
      </section>

      {/* ── FEATURE SPOTLIGHT (SMART INSIGHTS) ────────────────────────────── */}
      <section className="spotlight-section" style={{
        maxWidth: 1040,
        margin: '0 auto 120px',
        padding: '0 24px',
      }}>
        <div className="spotlight-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: 56,
          alignItems: 'center',
        }}>

          {/* Left Side: Soft Gray Frame with Floating UI Card */}
          <div className="spotlight-left" style={{
            gridColumn: 'span 7',
            background: '#F3F4F6',
            borderRadius: 24,
            padding: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 440,
          }}>
            {/* White Floating UI Card */}
            <div className="mockup-card" style={{
              width: '100%',
              maxWidth: 420,
              background: '#FFFFFF',
              borderRadius: 16,
              padding: 24,
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.06)',
              border: '1px solid #E5E7EB',
            }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9CA3AF' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                  Generate Insight
                </span>
              </div>

              {/* Form Inputs */}
              <div className="mockup-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
                    Matchup
                  </div>
                  <div style={{ background: '#F9FAFB', padding: '9px 11px', borderRadius: 8, fontSize: 11, color: '#374151', fontWeight: 500, border: '1px solid #F3F4F6' }}>
                    {objectives[activeObjective].matchup}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
                    Metric
                  </div>
                  <div style={{ background: '#F9FAFB', padding: '9px 11px', borderRadius: 8, fontSize: 11, color: '#111827', fontWeight: 600, border: '1px solid #F3F4F6' }}>
                    {objectives[activeObjective].metric}
                  </div>
                </div>
              </div>

              <div className="mockup-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
                    Discipline
                  </div>
                  <div style={{ background: '#F9FAFB', padding: '9px 11px', borderRadius: 8, fontSize: 11, color: '#374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #F3F4F6' }}>
                    Telemetry <ChevronDown size={12} color="#9CA3AF" />
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
                    Research Direction
                  </div>
                  <div style={{ background: '#F9FAFB', padding: '9px 11px', borderRadius: 8, fontSize: 11, color: '#374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #F3F4F6' }}>
                    Synthesize <ChevronDown size={12} color="#9CA3AF" />
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
                  What do you want to know from the insight?
                </div>
                <div style={{ background: '#F9FAFB', padding: 12, borderRadius: 8, fontSize: 11, color: '#4B5563', lineHeight: 1.5, minHeight: 64, border: '1px solid #F3F4F6' }}>
                  {objectives[activeObjective].subtitle}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 12, color: '#6B7280', cursor: 'pointer', fontWeight: 500 }}>
                  Cancel
                </span>
                <button style={{
                  padding: '9px 18px',
                  background: '#000000',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 9999,
                  border: 'none',
                  cursor: 'pointer',
                }}>
                  Create insight
                </button>
              </div>

            </div>
          </div>

          {/* Right Side: Editorial Text & Objective Selector */}
          <div className="spotlight-right" style={{ gridColumn: 'span 5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Zap size={16} color="#111827" />
              <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 400, color: '#111827', letterSpacing: '-0.02em' }}>
                Smart Insights
              </h2>
            </div>

            <p style={{
              fontSize: 14,
              color: '#6B7280',
              lineHeight: 1.7,
              marginBottom: 28,
            }}>
              Your environment will surface patterns and uncover root causes, then offer pathways on how to structure your studies to improve race execution based on the telemetry objectives you choose.
            </p>

            <button style={{
              padding: '11px 24px',
              borderRadius: 9999,
              border: '1px solid #E5E7EB',
              background: '#FFFFFF',
              fontSize: 13,
              fontWeight: 600,
              color: '#111827',
              cursor: 'pointer',
              marginBottom: 36,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              Explore Smart Insights
            </button>

            {/* Divider Line */}
            <div style={{ height: 1, background: '#E5E7EB', marginBottom: 24 }} />

            {/* Objective Options List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {objectives.map((obj, idx) => (
                <div
                  key={idx}
                  onClick={() => setActiveObjective(idx)}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{
                    fontSize: 14,
                    fontWeight: activeObjective === idx ? 700 : 500,
                    color: activeObjective === idx ? '#111827' : '#9CA3AF',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    {activeObjective === idx && (
                      <span style={{ width: 16, height: 2, background: '#111827' }} />
                    )}
                    {obj.title}
                  </div>
                </div>
              ))}
            </div>

          </div>

        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="landing-footer" style={{
        borderTop: '1px solid #F3F4F6',
        padding: '32px 5vw',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 20,
        fontSize: 12,
        color: '#6B7280',
      }}>
        <div style={{ fontWeight: 700, color: '#111827', fontSize: 14 }}>
          Slipstream
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          {['Telemetry', 'Sessions', 'Schedule', 'Predictions', 'GitHub'].map(link => (
            <Link key={link} href={link === 'GitHub' ? 'https://github.com/abdullah-azeemi/Slipstream' : `/${link.toLowerCase()}`} style={{
              color: '#6B7280',
              textDecoration: 'none',
            }}>
              {link}
            </Link>
          ))}
        </div>

        <div>
          © 2026 Motorsport Platform. Built with intention.
        </div>
      </footer>
    </div>
  )
}
