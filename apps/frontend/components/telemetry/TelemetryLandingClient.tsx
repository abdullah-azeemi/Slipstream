'use client'

import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Monitor, Gauge, Zap, Activity, Filter } from 'lucide-react'
import type { Session } from '@/types/f1'

type Props = { initialSessions: Session[] }

const LENS_MODES = [
  { icon: <Gauge size={13} />, label: 'Speed & Throttle Trace', active: true },
  { icon: <Activity size={13} />, label: 'Braking & Deceleration S' },
  { icon: <Zap size={13} />, label: 'Gears & RPM Cadence' },
  { icon: <Monitor size={13} />, label: 'Time Delta & Micro-Sectors' },
]

const TRACK_LABELS = [
  { pct: 4,   label: 'T1 ST.\nDEVOTE' },
  { pct: 22,  label: 'T4\nCASINO' },
  { pct: 42,  label: 'T6\nHAIRPIN\n(GM HOTEL)' },
  { pct: 60,  label: 'T10\nCHICANE\n(POOL)' },
  { pct: 76,  label: 'T13\nTABAC' },
  { pct: 90,  label: 'T16\nRASSCASSE' },
]

// Simulated speed trace (300 points each, 0-100% track distance)
function makeTrace(seed: number, base: number, variance: number) {
  const pts = []
  for (let i = 0; i <= 300; i++) {
    const x = i / 300
    const v =
      base +
      Math.sin(x * 12 + seed) * variance * 0.6 +
      Math.sin(x * 31 + seed * 2) * variance * 0.25 +
      Math.sin(x * 7 + seed * 0.5) * variance * 0.15 -
      Math.abs(Math.sin(x * 19 + seed)) * variance * 0.4
    pts.push(Math.max(80, Math.min(310, v)))
  }
  return pts
}

const GAS_TRACE = makeTrace(1.2, 210, 120)
const RUS_TRACE = makeTrace(2.7, 205, 118)

const MICRO_SEGMENTS = Array.from({ length: 25 }, (_, i) => {
  const g = GAS_TRACE[Math.floor((i / 25) * 300)]
  const r = RUS_TRACE[Math.floor((i / 25) * 300)]
  return g > r ? 'gas' : 'rus'
})

const CORNER_DATA = [
  {
    num: '01',
    name: 'SAINTE DÉVOTE (TURN 1)',
    sub: 'HEAVY BRAKING ZONE • 90° RIGHT HANDER',
    tag: 'GAS +3 MH/H APEX',
    tagColor: '#E8002D',
    tagBg: '#FEE2E2',
    stats: [
      { label: 'ENTRY BRAKING', gasVal: '92s', rusVal: '98s' },
      { label: 'MIN APEX SPEED', gasVal: '82 km/h', rusVal: '79 km/h' },
      { label: 'EXIT THROTTLE', gasVal: '100% @ Apex+8m', rusVal: '' },
    ],
    barLabel: 'Throttle Commitment',
    barVal: 88,
    barColor: '#E8002D',
    barNote: '',
  },
  {
    num: '06',
    name: 'FAIRMONT GRAND HOTEL HAIRPIN',
    sub: 'TIGHTEST F1 CORNER • FULL LOCK STEERING',
    tag: 'RUS +2 MH/H APEX',
    tagColor: '#1D4ED8',
    tagBg: '#EFF6FF',
    stats: [
      { label: 'STEERING ROTATION', gasVal: '294°', rusVal: '382°' },
      { label: 'MIN APEX SPEED', gasVal: '51 km/h', rusVal: '48 km/h' },
      { label: 'ROTATIONAL TIME', gasVal: '', rusVal: '-8.042s (RUS)' },
    ],
    barLabel: 'Braking Modulation',
    barVal: 62,
    barColor: '#1D4ED8',
    barNote: 'F4 Smoothness',
  },
  {
    num: '18',
    name: 'NOUVELLE CHICANE (TUNNEL EXIT)',
    sub: 'HIGH DOWNHILL BRAKING • 293 KM/H TO 65 KM/H',
    tag: '-4.66 BREEL',
    tagColor: '#374151',
    tagBg: '#F3F4F6',
    stats: [
      { label: 'ENTRY BRAKING', gasVal: '132 BAR (GAS)', rusVal: '' },
      { label: 'STOPPING DISTANCE', gasVal: '64.2m', rusVal: '66.8m' },
      { label: 'AERO STRING STABILITY', gasVal: '', rusVal: '+0.015s (RUS)' },
    ],
    barLabel: 'Deceleration Load',
    barVal: 44,
    barColor: '#374151',
    barNote: '-4.4 G',
  },
]

const ENG_LOGS = [
  {
    tag: 'APEX-DIFF @ T94',
    time: 'T+26.817s',
    body: 'Gasly achieves apex minimum of 344 km/h vs Russell 316 km/h. Alpine floor stability allowed earlier lateral rotation with zero micro-correction.',
  },
  {
    tag: 'CHICANE-HERB @ T54',
    time: 'T+54.432s',
    body: 'Russell carried +2.1 km/h through second sausage kerb. Mercedes damper rebound compliant, netting -6.040s gain before Tabac.',
  },
  {
    tag: 'GEAR RATIOS & TIP SPEED',
    time: 'T+11.498s',
    body: 'Both cars ran 7th gear at 295 km/h peak speed into tunnel crest. Alpine deployment battery SOC +1.4% higher at finish line.',
  },
]

// SVG chart helpers
const W = 880, H = 220
function ptToSVG(i: number, v: number, total: number) {
  const x = (i / total) * W
  const y = H - ((v - 60) / 270) * H
  return `${x.toFixed(1)},${y.toFixed(1)}`
}

function buildPath(trace: number[]) {
  return trace.map((v, i) => (i === 0 ? 'M' : 'L') + ptToSVG(i, v, trace.length - 1)).join(' ')
}

export default function TelemetryLandingClient({ initialSessions }: Props) {
  const router = useRouter()
  const [activeLens, setActiveLens] = useState(0)
  const [selectedYear, setSelectedYear] = useState<number | null>(
    initialSessions[0]?.year ?? null,
  )

  const years = useMemo(
    () => Array.from(new Set(initialSessions.map(s => s.year))).sort((a, b) => b - a),
    [initialSessions],
  )

  const gpsForYear = useMemo(() => {
    if (!selectedYear) return []
    return initialSessions
      .filter(s => s.year === selectedYear)
      .sort((a, b) => new Date(a.date_start ?? 0).getTime() - new Date(b.date_start ?? 0).getTime())
  }, [initialSessions, selectedYear])

  const handleLaunch = (sessionKey: number) => router.push(`/sessions/${sessionKey}/telemetry`)

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 20px 80px' }}>

        {/* ── DECISIVE LAP APEX DELTA eyebrow ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <span style={{
            background: '#E8002D', color: '#FFFFFF',
            fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
            padding: '4px 10px', borderRadius: 4,
          }}>
            DECISIVE LAP APEX DELTA
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            CIRCUIT DISTANCE: 3,337 METERS
          </span>
        </div>

        {/* ── Hero ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 32, marginBottom: 32, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 380px' }}>
            <h1 style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: 'clamp(36px, 6vw, 54px)',
              fontWeight: 700,
              color: '#111827',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              margin: '0 0 8px',
            }}>
              GAS beats RUS by
            </h1>
            <div style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontStyle: 'italic',
              fontSize: 'clamp(36px, 6vw, 54px)',
              fontWeight: 700,
              color: '#E8002D',
              lineHeight: 1,
              marginBottom: 16,
            }}>
              +0.060s
            </div>
            <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.75, maxWidth: 440, margin: 0 }}>
              Pierre Gasly (#10 Alpine) unlocked decisive exit traction at Casino Square (+8 km/h) and held +0.188s through Sainte Dévote braking. George Russell (#63 Mercedes) recovered in the Swimming Pool chicane but ran out of track distance.
            </p>
          </div>

          {/* Driver comparison cards */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* GAS card */}
            <div style={{
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: 12,
              padding: '14px 18px',
              minWidth: 130,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#E8002D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#FFFFFF' }}>10</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', letterSpacing: '0.04em' }}>GASLY</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em' }}>ALP</div>
                </div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', fontFamily: 'monospace', letterSpacing: '-0.03em' }}>1:11.494</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#E8002D', marginTop: 2 }}>POLE</div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.04em' }}>VS</div>

            {/* RUS card */}
            <div style={{
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: 12,
              padding: '14px 18px',
              minWidth: 130,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#FFFFFF' }}>63</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#111827', letterSpacing: '0.04em' }}>RUSSELL</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em' }}>MER</div>
                </div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', fontFamily: 'monospace', letterSpacing: '-0.03em' }}>1:11.554</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', marginTop: 2 }}>+0.060s</div>
            </div>
          </div>
        </div>

        {/* ── Sector Breakdown ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 28 }}>
          {[
            { num: 1, name: 'BEAR RAVAGE', gasT: '26.817s', rusT: '27.086s', delta: 'GAS +0.169s', deltaColor: '#E8002D' },
            { num: 2, name: 'LINES & TUNNEL', gasT: '27.996s', rusT: '27.796s', delta: 'RUS +0.134s', deltaColor: '#1D4ED8' },
            { num: 3, name: 'CHICANE TO LINE', gasT: '27.081s', rusT: '27.100s', delta: 'RUS +0.025s', deltaColor: '#1D4ED8' },
          ].map(s => (
            <div key={s.num} style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  SECTOR {s.num} • {s.name}
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: s.deltaColor === '#E8002D' ? '#FEE2E2' : '#EFF6FF',
                  color: s.deltaColor,
                  padding: '2px 8px', borderRadius: 4,
                }}>
                  {s.delta}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', fontFamily: 'monospace' }}>{s.gasT}</div>
                  <div style={{ height: 3, background: '#E8002D', borderRadius: 9999, marginTop: 4 }} />
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' }}>RUS: {s.rusT}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Lens Mode Selector ── */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E5E7EB',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 6,
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 8 }}>
            LENS MODE:
          </span>
          {LENS_MODES.map((m, i) => (
            <button
              key={i}
              onClick={() => setActiveLens(i)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 12px',
                borderRadius: 7,
                border: activeLens === i ? '1.5px solid #E8002D' : '1px solid #E5E7EB',
                background: activeLens === i ? '#FEE2E2' : 'transparent',
                color: activeLens === i ? '#E8002D' : '#6B7280',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 150ms',
              }}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#9CA3AF', cursor: 'pointer' }}>
            <Filter size={12} />
            Telemetry Filters
          </div>
        </div>

        {/* ── Telemetry Chart Panel ── */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E5E7EB',
          borderRadius: 14,
          overflow: 'hidden',
          marginBottom: 36,
        }}>
          {/* Chart Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            padding: '14px 18px',
            borderBottom: '1px solid #F3F4F6',
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E8002D' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>GASLY #10</span>
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>(ALP)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1E293B' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>RUSSELL #63</span>
              <span style={{ fontSize: 10, color: '#9CA3AF' }}>(MER)</span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>TRACK DISTANCE: 0 – 3,337m</div>
              </div>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>DIST:</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', fontFamily: 'monospace' }}>1,319m</div>
              </div>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>GAS:</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#E8002D', fontFamily: 'monospace' }}>293 km/h <span style={{ fontWeight: 400, color: '#9CA3AF', fontSize: 10 }}>(100% Thr)</span></div>
              </div>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>RUS:</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', fontFamily: 'monospace' }}>286 km/h <span style={{ fontWeight: 400, color: '#9CA3AF', fontSize: 10 }}>(100% Thr)</span></div>
              </div>
              <div style={{ background: '#E8002D', color: '#FFFFFF', padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 800, fontFamily: 'monospace' }}>
                +7<br /><span style={{ fontSize: 8 }}>km/h</span>
              </div>
            </div>
          </div>

          {/* Mini-segment dominance bar */}
          <div style={{ padding: '8px 18px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                MINI-SECTOR DOMINANCE (25 MICRO-SEGMENTS)
              </span>
              <span style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                GAS: {MICRO_SEGMENTS.filter(x => x === 'gas').length} SEGMENTS | RUS: {MICRO_SEGMENTS.filter(x => x === 'rus').length} SEGMENTS
              </span>
            </div>
            <div style={{ display: 'flex', gap: 2, height: 12, borderRadius: 4, overflow: 'hidden' }}>
              {MICRO_SEGMENTS.map((seg, i) => (
                <div key={i} style={{ flex: 1, background: seg === 'gas' ? '#E8002D' : '#1E293B', borderRadius: 2 }} />
              ))}
            </div>
          </div>

          {/* Track labels */}
          <div style={{ position: 'relative', height: 28, padding: '0 18px', borderBottom: '1px solid #F3F4F6', overflow: 'hidden' }}>
            {TRACK_LABELS.map((tl, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `calc(${tl.pct}% + 18px)`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 8,
                fontWeight: 700,
                color: '#9CA3AF',
                letterSpacing: '0.06em',
                textAlign: 'center',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                {tl.label.split('\n')[0]}
              </div>
            ))}
          </div>

          {/* SVG Speed Trace Chart */}
          <div style={{ padding: '8px 0', overflowX: 'auto' }}>
            <div style={{ minWidth: 600, position: 'relative' }}>
              {/* Y-axis labels */}
              <div style={{ position: 'absolute', left: 0, top: 0, width: 44, height: H + 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '8px 0', pointerEvents: 'none' }}>
                {[300, 250, 200, 150, 100].map(v => (
                  <div key={v} style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', textAlign: 'right', paddingRight: 8, fontFamily: 'monospace' }}>{v}</div>
                ))}
              </div>

              <svg
                viewBox={`0 0 ${W} ${H}`}
                width="100%"
                height={H + 16}
                style={{ display: 'block', padding: '8px 18px 0 44px', boxSizing: 'border-box' }}
                preserveAspectRatio="none"
              >
                {/* Grid lines */}
                {[300, 250, 200, 150, 100].map(v => {
                  const y = H - ((v - 60) / 270) * H
                  return <line key={v} x1={0} y1={y} x2={W} y2={y} stroke="#F3F4F6" strokeWidth={1} />
                })}

                {/* Track reference lines for corners */}
                {TRACK_LABELS.map((tl, i) => {
                  const x = (tl.pct / 100) * W
                  return <line key={i} x1={x} y1={0} x2={x} y2={H} stroke="#E5E7EB" strokeWidth={1} strokeDasharray="4 3" />
                })}

                {/* GAS trace - Red */}
                <path
                  d={buildPath(GAS_TRACE)}
                  fill="none"
                  stroke="#E8002D"
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />

                {/* RUS trace - Dark */}
                <path
                  d={buildPath(RUS_TRACE)}
                  fill="none"
                  stroke="#1E293B"
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray="6 3"
                />

                {/* Throttle overlay (simplified, lighter area) */}
                <path
                  d={`${buildPath(GAS_TRACE)} L${W},${H} L0,${H} Z`}
                  fill="#E8002D"
                  fillOpacity={0.04}
                />
              </svg>

              {/* Legend */}
              <div style={{ display: 'flex', gap: 20, padding: '8px 18px 12px 54px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#6B7280' }}>
                  <div style={{ width: 20, height: 2, background: '#E8002D', borderRadius: 1 }} />
                  GAS Speed
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#6B7280' }}>
                  <div style={{ width: 16, height: 2, background: '#1E293B', borderRadius: 1, borderTop: '2px dashed #1E293B' }} />
                  RUS Speed
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#6B7280' }}>
                  <div style={{ width: 10, height: 10, background: '#FEE2E2', borderRadius: 2 }} />
                  Throttle/Brake
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom: 2-column layout ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 28, marginBottom: 36 }}>

          {/* ── LEFT: Apex & Corner Attack Matrix ── */}
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#E8002D' }} />
                <h2 style={{
                  fontFamily: "'Playfair Display', Georgia, serif",
                  fontSize: 22,
                  fontWeight: 700,
                  fontStyle: 'italic',
                  color: '#111827',
                  margin: 0,
                }}>
                  Apex &amp; Corner Attack Matrix
                </h2>
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase', marginLeft: 16 }}>
                Circuit Sectors: 1–19 Corners
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {CORNER_DATA.map(corner => (
                <div key={corner.num} style={{
                  background: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  borderRadius: 12,
                  padding: '14px 16px',
                }}>
                  {/* Corner header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#E8002D', fontFamily: 'monospace', lineHeight: 1, minWidth: 24 }}>
                        {corner.num}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', letterSpacing: '0.02em' }}>{corner.name}</div>
                        <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>{corner.sub}</div>
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      background: corner.tagBg,
                      color: corner.tagColor,
                      padding: '3px 8px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                    }}>
                      {corner.tag}
                    </span>
                  </div>

                  {/* Stats grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                    {corner.stats.map(stat => (
                      <div key={stat.label}>
                        <div style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>{stat.label}</div>
                        {stat.gasVal && <div style={{ fontSize: 11, fontWeight: 700, color: '#E8002D', fontFamily: 'monospace' }}>{stat.gasVal}</div>}
                        {stat.rusVal && <div style={{ fontSize: 11, fontWeight: 700, color: '#1E293B', fontFamily: 'monospace' }}>{stat.rusVal}</div>}
                      </div>
                    ))}
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{corner.barLabel}</span>
                      {corner.barNote && <span style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF' }}>{corner.barNote}</span>}
                    </div>
                    <div style={{ height: 5, background: '#F1F5F9', borderRadius: 9999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${corner.barVal}%`, background: corner.barColor, borderRadius: 9999 }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Track Map + Eng Log + Session Browser ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Monaco Track Map */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#E8002D' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Circuit de Monaco Track Map
                  </span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', fontFamily: 'monospace' }}>3,337 KM</span>
              </div>

              {/* Monaco SVG Track Map */}
              <svg viewBox="0 0 280 180" width="100%" style={{ display: 'block' }}>
                {/* Simplified Monaco circuit outline */}
                <path
                  d="M 60,30 L 200,30 Q 240,30 240,60 L 240,80 Q 240,100 220,110 L 190,120 Q 170,130 160,150 L 140,160 Q 120,170 100,160 L 70,145 Q 50,135 45,115 L 40,90 Q 38,70 50,55 Z"
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="18"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* Sector 1 - Red (GAS) */}
                <path
                  d="M 60,30 L 200,30 Q 240,30 240,60 L 240,80"
                  fill="none"
                  stroke="#E8002D"
                  strokeWidth="18"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeOpacity="0.85"
                />
                {/* Sector 2 - Blue (RUS) */}
                <path
                  d="M 240,80 Q 240,100 220,110 L 190,120 Q 170,130 160,150 L 140,160"
                  fill="none"
                  stroke="#1D4ED8"
                  strokeWidth="18"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeOpacity="0.85"
                />
                {/* Sector 3 - Blue (RUS) */}
                <path
                  d="M 140,160 Q 120,170 100,160 L 70,145 Q 50,135 45,115 L 40,90 Q 38,70 50,55 L 60,30"
                  fill="none"
                  stroke="#1D4ED8"
                  strokeWidth="18"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeOpacity="0.85"
                />
                {/* Track center line */}
                <path
                  d="M 60,30 L 200,30 Q 240,30 240,60 L 240,80 Q 240,100 220,110 L 190,120 Q 170,130 160,150 L 140,160 Q 120,170 100,160 L 70,145 Q 50,135 45,115 L 40,90 Q 38,70 50,55 Z"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  strokeDasharray="8 6"
                  strokeOpacity="0.6"
                />
              </svg>

              {/* Sector Legend */}
              <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Sec 1: GAS', color: '#E8002D', delta: '-0.189' },
                  { label: 'Sec 2: RUS', color: '#1D4ED8', delta: '-0.119' },
                  { label: 'Sec 3: RUS', color: '#1D4ED8', delta: '-0.819' },
                ].map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                    <span style={{ fontSize: 9, fontWeight: 600, color: '#374151' }}>{s.label}</span>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#9CA3AF' }}>{s.delta}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Engineering Telemetry Log */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#0D9488' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Engineering Telemetry Log
                  </span>
                </div>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  LIVE F1A TELEMETRY SYNC
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {ENG_LOGS.map(log => (
                  <div key={log.tag} style={{ borderLeft: '2px solid #E5E7EB', paddingLeft: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#374151' }}>
                        [{log.tag}]
                      </span>
                      <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#0D9488', fontWeight: 700 }}>
                        {log.time}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.65, margin: 0 }}>
                      {log.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Session Browser (compact) */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: '16px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                Session Browser
              </div>

              {/* Year tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {years.slice(0, 5).map(y => (
                  <button
                    key={y}
                    onClick={() => setSelectedYear(y)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 7,
                      border: selectedYear === y ? '1.5px solid #111827' : '1px solid #E5E7EB',
                      background: selectedYear === y ? '#111827' : 'transparent',
                      color: selectedYear === y ? '#FFFFFF' : '#6B7280',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>

              {/* Sessions list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {gpsForYear.slice(0, 8).map(s => (
                  <button
                    key={s.session_key}
                    onClick={() => handleLaunch(s.session_key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #F1F5F9',
                      background: '#F9FAFB',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 150ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#F1F5F9'; e.currentTarget.style.borderColor = '#E5E7EB' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#F9FAFB'; e.currentTarget.style.borderColor = '#F1F5F9' }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{s.gp_name.replace(' Grand Prix', '')}</div>
                      <div style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>
                        {s.year} · Qualifying
                      </div>
                    </div>
                    <ChevronRight size={14} color="#9CA3AF" />
                  </button>
                ))}
                {gpsForYear.length === 0 && (
                  <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', padding: '20px 0' }}>
                    No sessions available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 0 0',
          borderTop: '1px solid #E2E8F0',
          fontSize: 10,
          color: '#64748B',
          fontWeight: 600,
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <div style={{ color: '#0F172A', fontWeight: 700, fontSize: 11 }}>SLIPSTREAM PRO TELEMETRY CORP</div>
            <div style={{ color: '#94A3B8', fontSize: 9, marginTop: 1 }}>© 2026 FIA PRECISION MOTORSPORT ANALYTICS ENGINE. CALIBRATED 20HZ TOLERANCE.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <span>LATENCY: <strong style={{ color: '#0F172A', fontFamily: 'monospace' }}>3MS</strong></span>
            <span>ENCRYPTION: <strong style={{ color: '#0D9488', fontFamily: 'monospace' }}>HARDENED TLS</strong></span>
            <span>NODE: EU_CENTRAL</span>
          </div>
        </div>

      </div>
    </div>
  )
}
