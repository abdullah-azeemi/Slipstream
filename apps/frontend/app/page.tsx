import Link from 'next/link'
import { ArrowRight, Zap, BarChart2, Brain, Globe, ChevronRight, Activity, Play } from 'lucide-react'

export default function LandingPage() {
  return (
    <div style={{ background: '#FAFAFA', overflowX: 'hidden', width: '100%', paddingTop: 60 }}>

      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      <section style={{
        maxWidth: 1100,
        margin: '8px auto 60px',
        padding: '0 24px',
        textAlign: 'center',
      }}>
        {/* Video / Image Card */}
        <div style={{
          position: 'relative',
          width: '100%',
          maxWidth: 840,
          margin: '0 auto 28px',
          aspectRatio: '16 / 6',
          borderRadius: 24,
          overflow: 'hidden',
          boxShadow: '0 24px 48px -12px rgba(15, 23, 42, 0.12)',
          background: '#F1F5F9',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url('https://images.unsplash.com/photo-1728116693268-125c5d6ad9e2?q=80&w=2129&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center 40%',
          }} />

          {/* Play Button Overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.05)',
          }}>
            <div style={{
              width: 56, height: 56,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              cursor: 'pointer',
              transition: 'transform 200ms ease',
            }} className="play-btn">
              <Play size={24} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 3 }} />
            </div>
          </div>
        </div>

        {/* Hero Text Content */}
        <div style={{ maxWidth: 800, margin: '0 auto' }}>

          <h1 style={{
            fontFamily: 'Inter, sans-serif',
            fontWeight: 900,
            fontSize: 'clamp(2.2rem, 5.5vw, 4rem)',
            lineHeight: 1.0,
            letterSpacing: '-0.05em',
            color: '#0F172A',
            marginBottom: 20,
            textTransform: 'uppercase',
          }}>
            PRECISION IN <em style={{ fontStyle: 'italic', fontWeight: 700, color: '#0F172A' }}>EVERY</em>
            <br />
            <em style={{ fontStyle: 'italic', fontWeight: 700, color: '#0F172A' }}>MILLISECOND.</em>
          </h1>

          <p style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 17,
            lineHeight: 1.6,
            color: '#64748B',
            marginBottom: 32,
            maxWidth: 540,
            margin: '0 auto 32px',
          }}>
            Unlock elite-level race analytics. From real-time telemetry to
            predictive race strategy, dominate the grid with the world's most
            advanced motorsport data archive.
          </p>
        </div>

        {/* Partners / Data sources strip */}
        <div style={{ marginTop: 48 }}>
          <p style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 10, fontWeight: 700,
            letterSpacing: '0.16em', textTransform: 'uppercase',
            color: '#CBD5E1', marginBottom: 16,
          }}>
            DATA FROM
          </p>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 40,
            flexWrap: 'wrap',
          }}>
            {['FastF1', 'OpenF1', 'Jolpica', 'Zapoff Racing'].map(name => (
              <span key={name} style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 14, fontWeight: 600,
                color: '#CBD5E1',
                letterSpacing: '-0.01em',
              }}>
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES SECTION ─────────────────────────────────────────────── */}
      <section style={{ padding: '120px 5vw', width: '100%', background: '#F4F6F8', borderTop: '1px solid #E2E8F0' }}>

        {/* Section header */}
        <div style={{ marginBottom: 64, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 24 }}>
          <div style={{ maxWidth: 500 }}>
            <h2 style={{
              fontFamily: 'Inter, sans-serif',
              fontWeight: 900,
              fontSize: 'clamp(2rem, 4vw, 2.8rem)',
              letterSpacing: '-0.04em',
              color: '#0F172A',
              lineHeight: 1.1,
              marginBottom: 16,
              textTransform: 'uppercase',
            }}>
              TECHNICAL MASTERY
            </h2>
            <p style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 16, color: '#64748B', lineHeight: 1.6,
            }}>
              Strip away the drag from your decision-making process with high-fidelity telemetry architecture.
            </p>
          </div>
          <Link href="/telemetry" style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'Space Grotesk, sans-serif', fontSize: 11, fontWeight: 700,
            color: '#E8002D', textDecoration: 'none', whiteSpace: 'nowrap',
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            VIEW CAPABILITIES <ArrowRight size={14} />
          </Link>
        </div>

        {/* Feature grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: 16,
        }}>

          {/* TELEMETRY — large, spans 8 cols */}
          <div style={{
            gridColumn: 'span 8',
            background: '#FAFAFA',
            borderRadius: 24,
            overflow: 'hidden',
            display: 'flex',
            minHeight: 460,
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
          }}>
            <div style={{ padding: 48, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Activity size={18} color="#E8002D" />
                <span style={{
                  fontFamily: 'Space Grotesk, sans-serif', fontSize: 11,
                  fontWeight: 800, letterSpacing: '0.12em', color: '#E8002D', textTransform: 'uppercase',
                }}>Telemetry</span>
              </div>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#64748B', lineHeight: 1.6, maxWidth: 320, marginBottom: 24 }}>
                Live data streams from over 300 sensors per vehicle, processed with sub-millisecond latency for instant technical insight.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {['REAL-TIME', '2.4GB/S'].map(t => (
                  <span key={t} style={{
                    fontFamily: 'Space Grotesk, sans-serif', fontSize: 10,
                    padding: '6px 12px', borderRadius: 4,
                    background: '#F8FAFC', color: '#0F172A', fontWeight: 700,
                    border: '1px solid #E2E8F0',
                  }}>{t}</span>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, position: 'relative', background: '#0F172A' }}>
              <div style={{
                position: 'absolute', inset: 0,
                backgroundImage: `url('https://images.unsplash.com/photo-1522519972666-d8677d9d3e67?q=80&w=988&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                opacity: 0.6,
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(90deg, #FFFFFF 0%, rgba(255, 255, 255, 0) 40%)',
              }} />
            </div>
          </div>

          {/* STRATEGY — 4 cols */}
          <div style={{
            gridColumn: 'span 4',
            background: '#FFFFFF',
            borderRadius: 24,
            padding: 48,
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Zap size={18} color="#E8002D" />
              <span style={{
                fontFamily: 'Space Grotesk, sans-serif', fontSize: 11,
                fontWeight: 800, letterSpacing: '0.12em', color: '#E8002D', textTransform: 'uppercase',
              }}>Strategy</span>
            </div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#64748B', lineHeight: 1.6, marginBottom: 32 }}>
              Monte Carlo simulations run in the cloud to provide optimal pit-stop windows and tyre compound selections.
            </p>
            {/* Strategy Chart UI Placeholder */}
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', gap: 6, height: 100 }}>
              {[40, 60, 100, 80, 50].map((h, i) => (
                <div key={i} style={{ flex: 1, height: `${h}%`, background: h === 100 ? '#E8002D' : '#FEE2E7', borderRadius: 4 }} />
              ))}
            </div>
          </div>

          {/* PREDICTIONS — 4 cols */}
          <div style={{
            gridColumn: 'span 4',
            background: '#FFFFFF',
            borderRadius: 24,
            padding: 40,
            minHeight: 240,
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Brain size={18} color="#E8002D" />
              <span style={{
                fontFamily: 'Space Grotesk, sans-serif', fontSize: 11,
                fontWeight: 800, letterSpacing: '0.12em', color: '#E8002D', textTransform: 'uppercase',
              }}>Predictions</span>
            </div>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#64748B', lineHeight: 1.6 }}>
              Neural networks trained on 70 years of historical race data to predict overtaking probability and engine fatigue.
            </p>
          </div>

          {/* GLOBAL SYNC — 8 cols, dark */}
          <div style={{
            gridColumn: 'span 8',
            background: '#0F172A',
            borderRadius: 24,
            padding: 48,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            minHeight: 240,
          }}>
            <div style={{ maxWidth: 400 }}>
              <h3 style={{
                fontFamily: 'Inter, sans-serif', fontSize: 18, fontWeight: 800,
                color: '#FFFFFF', marginBottom: 12, textTransform: 'uppercase',
              }}>Global Sync</h3>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, color: '#94A3B8', lineHeight: 1.6 }}>
                Connect your factory floor directly to the pit wall with our proprietary low-orbit satellite uplink.
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'Inter, sans-serif', fontWeight: 900,
                fontSize: 56, color: '#10B981',
                letterSpacing: '-0.04em', lineHeight: 1,
              }}>
                99.99%
              </div>
              <div style={{
                fontFamily: 'Space Grotesk, sans-serif', fontSize: 10,
                fontWeight: 700, color: '#10B981', opacity: 0.8,
                letterSpacing: '0.15em', textTransform: 'uppercase', marginTop: 8,
              }}>
                Uptime Reliability
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── CTA SECTION ─────────────────────────────────────────────────── */}
      <section style={{ padding: '140px 5vw', textAlign: 'center', background: '#FAFAFA', borderTop: '1px solid #F1F5F9' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{
            fontFamily: 'Inter, sans-serif', fontWeight: 900,
            fontSize: 'clamp(2.5rem, 5vw, 3.8rem)',
            letterSpacing: '-0.05em', color: '#0F172A',
            lineHeight: 1.0, marginBottom: 24,
            textTransform: 'uppercase',
          }}>
            READY TO SET<br />THE PACE?
          </h2>
          <p style={{
            fontFamily: 'Inter, sans-serif', fontSize: 18,
            color: '#64748B', lineHeight: 1.6, marginBottom: 48,
          }}>
            Deployment takes less than a race weekend. Get your<br />team on the Slipstream grid today.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/sessions" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '16px 36px',
              background: '#E8002D', color: '#fff',
              fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 800,
              borderRadius: 8, textDecoration: 'none',
              textTransform: 'uppercase', letterSpacing: '0.02em',
              boxShadow: '0 12px 24px -6px rgba(232,0,45,0.4)',
            }}>
              Request Access
            </Link>
            <Link href="/predictions" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '16px 36px',
              background: '#E0E7FF', color: '#4F46E5',
              fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 800,
              borderRadius: 8, textDecoration: 'none',
              textTransform: 'uppercase', letterSpacing: '0.02em',
            }}>
              Book a Demo
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer style={{
        background: '#F4F6F8',
        borderTop: '1px solid #E2E8F0',
        padding: '60px 5vw 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 18,
            color: '#0F172A', letterSpacing: '-0.04em', textTransform: 'uppercase', fontStyle: 'italic',
          }}>
            Slipstream
          </span>
        </div>
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', justifyContent: 'center' }}>
          {['TELEMETRY', 'ARCHIVE', 'STANDINGS', 'TEAMS'].map(l => (
            <Link key={l} href={`/${l.toLowerCase()}`} style={{
              fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700,
              color: '#CBD5E1', textDecoration: 'none', letterSpacing: '0.05em',
            }}>{l}</Link>
          ))}
        </div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#CBD5E1', fontWeight: 500 }}>
          © 2026 SLIPSTREAM DATA SYSTEMS · APACHE 2.0
        </div>
      </footer>

      {/* Mobile responsiveness & Hover effects */}
      <style>{`
        .play-btn:hover { transform: scale(1.1); }
        @media (max-width: 1024px) {
          [style*="span 8"], [style*="span 4"] {
            grid-column: span 12 !important;
          }
        }
      `}</style>
    </div>
  )
}