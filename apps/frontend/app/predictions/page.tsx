'use client'

import React, { useState, useMemo } from 'react'
import {
  RotateCw,
  Database,
  RefreshCw,
  CheckCircle2,
  Box,
  Activity,
  Download,
  Maximize2,
  ChevronDown
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PodiumCandidate {
  rank: number
  rankLabel: string
  carNumber: number
  teamName: string
  driverName: string
  podiumProb: number
  podiumColor: string
  winProb: number
  p2Prob: number
  p3Prob: number
  metric1Label: string
  metric1Val: string
  metric1Color?: string
  metric2Label: string
  metric2Val: string
  metric2Color?: string
}

interface HeatmapRow {
  driver: string
  constructor: string
  teamColor: string
  s1: { val: string; bg: string; color: string }
  s2: { val: string; bg: string; color: string }
  s3: { val: string; bg: string; color: string }
  drag: { val: string; bg: string; color: string }
  tyre: { val: string; bg: string; color: string }
  brake: { val: string; bg: string; color: string }
  degrade: { val: string; bg: string; color: string }
  longRun: { val: string; bg: string; color: string }
  winBias: { val: string; bg: string; color: string }
}

interface GridDriver {
  pred: string
  grid: string
  delta: string
  deltaType: 'up' | 'down' | 'same'
  driver: string
  team: string
  teamColor: string
  podiumProb: number
  podiumColor: string
  winProb: number
  curveBars: number[]
  status: string
  statusColor: string
}

// ── Static Mock Data ──────────────────────────────────────────────────────────

const PODIUM_CANDIDATES: PodiumCandidate[] = [
  {
    rank: 1,
    rankLabel: 'P1 FAVORITE',
    carNumber: 16,
    teamName: 'SCUDERIA FERRARI',
    driverName: 'Charles Leclerc',
    podiumProb: 77.7,
    podiumColor: '#E8002D',
    winProb: 45.0,
    p2Prob: 21.4,
    p3Prob: 11.3,
    metric1Label: 'LONG-RUN PACE DELTA',
    metric1Val: '-0.184s / lap',
    metric2Label: 'QUALIFYING PACE',
    metric2Val: 'SEC-1 PURPLE',
    metric2Color: '#7C3AED',
  },
  {
    rank: 2,
    rankLabel: 'P2 CHALLENGER',
    carNumber: 1,
    teamName: 'RED BULL RACING',
    driverName: 'Max Verstappen',
    podiumProb: 69.8,
    podiumColor: '#1E293B',
    winProb: 36.8,
    p2Prob: 20.1,
    p3Prob: 12.9,
    metric1Label: 'TOP SPEED (SPEED TRAP)',
    metric1Val: '349.2 km/h',
    metric2Label: 'RACE SIM ORDER',
    metric2Val: 'P2 (+0.091s)',
    metric2Color: '#1E293B',
  },
  {
    rank: 3,
    rankLabel: 'P3 WILDCARD',
    carNumber: 12,
    teamName: 'MERCEDES-AMG',
    driverName: 'Kimi Antonelli',
    podiumProb: 40.7,
    podiumColor: '#0D9488',
    winProb: 9.1,
    p2Prob: 15.8,
    p3Prob: 15.8,
    metric1Label: 'BRAKING STABILITY',
    metric1Val: '99.1% INDEX',
    metric1Color: '#0284C7',
    metric2Label: 'CHEVRON DELTA',
    metric2Val: '+0.248s',
  },
]

// Heatmap palette helpers
const C_APEX = '#1E3A8A' // dark navy
const C_HIGH = '#2563EB' // royal blue
const C_MED = '#60A5FA'  // medium blue
const C_LOW = '#93C5FD'  // light blue
const C_IMPUTE = '#F1F5F9' // grey
const C_RED = '#DC2626'   // red for Leclerc win bias
const C_TEAL = '#0D9488'  // teal for Antonelli win bias
const C_CYAN = '#0284C7'  // cyan

const HEATMAP_DATA: HeatmapRow[] = [
  {
    driver: 'Leclerc',
    constructor: 'FER',
    teamColor: '#E8002D',
    s1: { val: '.98', bg: C_APEX, color: '#FFFFFF' },
    s2: { val: '.89', bg: C_HIGH, color: '#FFFFFF' },
    s3: { val: '.56', bg: C_MED, color: '#FFFFFF' },
    drag: { val: '.98', bg: C_APEX, color: '#FFFFFF' },
    tyre: { val: '.41', bg: C_LOW, color: '#1E293B' },
    brake: { val: '.88', bg: C_HIGH, color: '#FFFFFF' },
    degrade: { val: '.51', bg: C_MED, color: '#FFFFFF' },
    longRun: { val: '.92', bg: C_APEX, color: '#FFFFFF' },
    winBias: { val: '.78', bg: C_RED, color: '#FFFFFF' },
  },
  {
    driver: 'Verstappen',
    constructor: 'RBR',
    teamColor: '#3671C6',
    s1: { val: '.92', bg: C_APEX, color: '#FFFFFF' },
    s2: { val: '.97', bg: C_APEX, color: '#FFFFFF' },
    s3: { val: '.81', bg: C_HIGH, color: '#FFFFFF' },
    drag: { val: '.76', bg: C_HIGH, color: '#FFFFFF' },
    tyre: { val: '.71', bg: C_HIGH, color: '#FFFFFF' },
    brake: { val: '.82', bg: C_HIGH, color: '#FFFFFF' },
    degrade: { val: '.46', bg: C_MED, color: '#FFFFFF' },
    longRun: { val: '.74', bg: C_HIGH, color: '#FFFFFF' },
    winBias: { val: '.73', bg: C_APEX, color: '#FFFFFF' },
  },
  {
    driver: 'Antonelli',
    constructor: 'MER',
    teamColor: '#27F4D2',
    s1: { val: '.87', bg: C_HIGH, color: '#FFFFFF' },
    s2: { val: '.74', bg: C_HIGH, color: '#FFFFFF' },
    s3: { val: '.90', bg: C_APEX, color: '#FFFFFF' },
    drag: { val: '.81', bg: C_HIGH, color: '#FFFFFF' },
    tyre: { val: '.68', bg: C_MED, color: '#FFFFFF' },
    brake: { val: '.99', bg: C_APEX, color: '#FFFFFF' },
    degrade: { val: '.38', bg: C_LOW, color: '#1E293B' },
    longRun: { val: '.77', bg: C_HIGH, color: '#FFFFFF' },
    winBias: { val: '.41', bg: C_TEAL, color: '#FFFFFF' },
  },
  {
    driver: 'Norris',
    constructor: 'MCL',
    teamColor: '#FF8000',
    s1: { val: '.81', bg: C_HIGH, color: '#FFFFFF' },
    s2: { val: '.91', bg: C_APEX, color: '#FFFFFF' },
    s3: { val: '.84', bg: C_HIGH, color: '#FFFFFF' },
    drag: { val: '.72', bg: C_HIGH, color: '#FFFFFF' },
    tyre: { val: 'N/A', bg: C_IMPUTE, color: '#94A3B8' },
    brake: { val: '.84', bg: C_HIGH, color: '#FFFFFF' },
    degrade: { val: '.61', bg: C_MED, color: '#FFFFFF' },
    longRun: { val: '.82', bg: C_HIGH, color: '#FFFFFF' },
    winBias: { val: '.31', bg: C_CYAN, color: '#FFFFFF' },
  },
  {
    driver: 'Hamilton',
    constructor: 'FER',
    teamColor: '#E8002D',
    s1: { val: '.86', bg: C_HIGH, color: '#FFFFFF' },
    s2: { val: '.78', bg: C_HIGH, color: '#FFFFFF' },
    s3: { val: '.65', bg: C_MED, color: '#FFFFFF' },
    drag: { val: '.95', bg: C_APEX, color: '#FFFFFF' },
    tyre: { val: '.44', bg: C_LOW, color: '#1E293B' },
    brake: { val: '.89', bg: C_HIGH, color: '#FFFFFF' },
    degrade: { val: 'N/A', bg: C_IMPUTE, color: '#94A3B8' },
    longRun: { val: '.85', bg: C_HIGH, color: '#FFFFFF' },
    winBias: { val: '.29', bg: C_CYAN, color: '#FFFFFF' },
  },
]

const GRID_DRIVERS: GridDriver[] = [
  {
    pred: 'P1',
    grid: 'P1',
    delta: '±0',
    deltaType: 'same',
    driver: 'Charles Leclerc',
    team: 'Scuderia Ferrari',
    teamColor: '#E8002D',
    podiumProb: 77.7,
    podiumColor: '#E8002D',
    winProb: 45.0,
    curveBars: [24, 18, 12, 6, 3],
    status: 'POLE FAVORITE',
    statusColor: '#059669',
  },
  {
    pred: 'P2',
    grid: 'P2',
    delta: '±0',
    deltaType: 'same',
    driver: 'Max Verstappen',
    team: 'Red Bull Racing',
    teamColor: '#1E293B',
    podiumProb: 69.8,
    podiumColor: '#1E293B',
    winProb: 36.8,
    curveBars: [16, 22, 14, 8, 4],
    status: 'IN HUNTER SEAT',
    statusColor: '#1E293B',
  },
  {
    pred: 'P3',
    grid: 'P4',
    delta: '+1',
    deltaType: 'up',
    driver: 'Kimi Antonelli',
    team: 'Mercedes-AMG',
    teamColor: '#0D9488',
    podiumProb: 40.7,
    podiumColor: '#0D9488',
    winProb: 9.1,
    curveBars: [6, 12, 20, 16, 8],
    status: 'ASCENDING',
    statusColor: '#0D9488',
  },
  {
    pred: 'P4',
    grid: 'P3',
    delta: '-1',
    deltaType: 'down',
    driver: 'Lando Norris',
    team: 'McLaren F1',
    teamColor: '#64748B',
    podiumProb: 38.2,
    podiumColor: '#475569',
    winProb: 5.8,
    curveBars: [4, 8, 16, 22, 12],
    status: 'DEGRADATION RISK',
    statusColor: '#D97706',
  },
  {
    pred: 'P5',
    grid: 'P5',
    delta: '±0',
    deltaType: 'same',
    driver: 'Lewis Hamilton',
    team: 'Scuderia Ferrari',
    teamColor: '#64748B',
    podiumProb: 29.4,
    podiumColor: '#64748B',
    winProb: 2.4,
    curveBars: [2, 6, 10, 14, 20],
    status: 'LONG STINT SPEC',
    statusColor: '#64748B',
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function PredictionsPage() {
  const [selectedCircuit, setSelectedCircuit] = useState('Autodromo Nazionale Monza')
  const [isSimulating, setIsSimulating] = useState(false)
  const [sortBy, setSortBy] = useState<'pred' | 'uci' | 'delta'>('pred')

  const handleRerunSim = () => {
    setIsSimulating(true)
    setTimeout(() => setIsSimulating(false), 800)
  }

  const sortedGrid = useMemo(() => {
    const list = [...GRID_DRIVERS]
    if (sortBy === 'uci') {
      return list.sort((a, b) => b.winProb - a.winProb)
    }
    if (sortBy === 'delta') {
      return list.sort((a, b) => {
        const deltaA = parseInt(a.delta.replace('±', '0')) || 0
        const deltaB = parseInt(b.delta.replace('±', '0')) || 0
        return deltaB - deltaA
      })
    }
    return list
  }, [sortBy])

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh', paddingBottom: 64 }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '36px 20px 0' }}>

        {/* ── Top Eyebrow & Circuit Tag ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#E8002D', textTransform: 'uppercase' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E8002D' }} />
            PREDICTION LAB // SYNTHESIS
          </span>
          <span style={{ color: '#CBD5E1', fontSize: 11 }}>|</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#64748B', textTransform: 'uppercase' }}>
            FIA SYNC LINE
          </span>
          <span style={{ color: '#CBD5E1', fontSize: 11 }}>|</span>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#0284C7', textTransform: 'uppercase' }}>
            MONZA SPEED BOWL • GP-16
          </span>
        </div>

        {/* ── Headline & Simulation Trigger ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 28 }}>
          <div style={{ flex: '1 1 480px' }}>
            <h1 style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: 'clamp(32px, 5vw, 48px)',
              fontWeight: 700,
              color: '#111827',
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              margin: '0 0 10px',
            }}>
              Race Predictions <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 300, color: '#64748B' }}>&amp;</span><br />
              <span style={{ fontStyle: 'italic', fontWeight: 500 }}>Probability Matrix</span>
            </h1>
            <p style={{ fontSize: 13, color: '#64748B', lineHeight: 1.65, maxWidth: 540, margin: 0 }}>
              Qualifying-led probabilistic forecasts with Monte Carlo variance, live DAG pipeline attribution, and multi-dimensional session feature density for the Italian Grand Prix.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            {/* Circuit Selector */}
            <div style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              padding: '4px 12px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              position: 'relative',
            }}>
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94A3B8' }}>
                CIRCUIT CALIBRATION
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <select
                  value={selectedCircuit}
                  onChange={(e) => setSelectedCircuit(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#0F172A',
                    outline: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    margin: 0,
                    appearance: 'none',
                    paddingRight: 16,
                  }}
                >
                  <option value="Autodromo Nazionale Monza">Autodromo Nazionale Monza</option>
                  <option value="Silverstone Circuit">Silverstone Circuit</option>
                  <option value="Circuit de Monaco">Circuit de Monaco</option>
                  <option value="Circuit Zandvoort">Circuit Zandvoort</option>
                </select>
                <ChevronDown size={13} color="#64748B" style={{ position: 'absolute', right: 10, bottom: 8, pointerEvents: 'none' }} />
              </div>
            </div>

            {/* Rerun Sim Button */}
            <button
              onClick={handleRerunSim}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#E8002D',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 8,
                padding: '12px 18px',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(232,0,45,0.25)',
                transition: 'all 150ms ease',
                opacity: isSimulating ? 0.75 : 1,
              }}
            >
              <RotateCw size={14} className={isSimulating ? 'animate-spin' : ''} />
              RERUN SIM (10K)
            </button>
          </div>
        </div>

        {/* ── Key Metrics Ribbon ── */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          padding: '14px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 16,
          marginBottom: 36,
          boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>AIR / TRACK TEMP</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 3 }}>24.2°C / 41.8°C</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>OVERTAKE PROB</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0284C7', marginTop: 3 }}>81.4%</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>SAFETY CAR PROB</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#E8002D', marginTop: 3 }}>58.0%</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>PIT LOSS DELTA</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 3 }}>23.8s</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>BRIER SCORE (95% CI)</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0D9488', marginTop: 3 }}>0.073</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>CONVERGENCE</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 3 }}>N=10,000 SEEDS</div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            01 // PODIUM CANDIDATES
        ═══════════════════════════════════════════════════════════ */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#E8002D', textTransform: 'uppercase' }}>
                01 // PODIUM CANDIDATES
              </span>
              <span style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'italic', fontSize: 16, fontWeight: 600, color: '#1E293B' }}>
                Simulated Podium Frontrunners
              </span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              MONTE CARLO SAMPLING • 10,000 PERMUTATIONS
            </span>
          </div>

          {/* 3 Driver Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {PODIUM_CANDIDATES.map((cand) => (
              <div key={cand.driverName} style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: 14,
                padding: '20px',
                boxShadow: '0 2px 6px rgba(15,23,42,0.03)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}>
                <div>
                  {/* Top metadata */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: cand.podiumColor, textTransform: 'uppercase' }}>
                      {cand.rankLabel} • CAR #{cand.carNumber}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: '#94A3B8', textTransform: 'uppercase' }}>
                      {cand.teamName}
                    </div>
                  </div>

                  {/* Driver Name & Big Probability */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <h3 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                      {cand.driverName}
                    </h3>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: cand.podiumColor, lineHeight: 1, letterSpacing: '-0.03em' }}>
                        {cand.podiumProb}%
                      </div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                        PODIUM PROB
                      </div>
                    </div>
                  </div>

                  {/* Progress Line */}
                  <div style={{ height: 3, background: '#F1F5F9', borderRadius: 9999, overflow: 'hidden', marginBottom: 14 }}>
                    <div style={{ height: '100%', width: `${cand.podiumProb}%`, background: cand.podiumColor, borderRadius: 9999 }} />
                  </div>

                  {/* Win breakdown row */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: '1px solid #F1F5F9',
                    fontSize: 11,
                    color: '#64748B',
                    fontWeight: 500,
                    marginBottom: 14,
                  }}>
                    <span>WIN: <strong style={{ color: '#0F172A' }}>{cand.winProb}%</strong></span>
                    <span>P2: <strong style={{ color: '#0F172A' }}>{cand.p2Prob}%</strong></span>
                    <span>P3: <strong style={{ color: '#0F172A' }}>{cand.p3Prob}%</strong></span>
                  </div>
                </div>

                {/* Bottom stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {cand.metric1Label}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cand.metric1Color || '#0F172A', marginTop: 2 }}>
                      {cand.metric1Val}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {cand.metric2Label}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cand.metric2Color || '#0F172A', marginTop: 2 }}>
                      {cand.metric2Val}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            02 // MODEL REASONING FLOW | PIPELINE DAG
        ═══════════════════════════════════════════════════════════ */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#E8002D', textTransform: 'uppercase' }}>
                02 // MODEL REASONING FLOW | PIPELINE DAG
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 10, color: '#64748B', fontWeight: 600 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
                Verified
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E8002D' }} />
                Partial Ingest
              </span>
              <span style={{ color: '#CBD5E1' }}>|</span>
              <span style={{ color: '#475569', letterSpacing: '0.04em' }}>PLAML AutoFL + LightGBM</span>
            </div>
          </div>

          <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'italic', fontSize: 18, fontWeight: 600, color: '#1E293B', margin: '0 0 16px' }}>
            Directed Acyclic Inference Graph
          </h2>

          {/* DAG Diagram Container */}
          <div style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 16,
            padding: '36px 24px',
            boxShadow: '0 2px 6px rgba(15,23,42,0.03)',
            overflowX: 'auto',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              minWidth: 720,
              position: 'relative',
            }}>
              {/* Step 1: History */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', zIndex: 2, width: 130 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#E6FFFA',
                  border: '2px solid #0D9488',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0D9488',
                  marginBottom: 12,
                }}>
                  <Database size={20} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#0F172A', textTransform: 'uppercase' }}>
                  01 // HISTORY
                </div>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>
                  48 Rows Ingested
                </div>
              </div>

              {/* Dotted connector 1 -> 2 */}
              <div style={{ flex: 1, borderTop: '2px dashed #0D9488', margin: '0 8px', marginTop: -32 }} />

              {/* Step 2: Live Stream */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', zIndex: 2, width: 140 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#FEE2E2',
                  border: '2px solid #E8002D',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#E8002D',
                  marginBottom: 12,
                }}>
                  <RefreshCw size={20} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#E8002D', textTransform: 'uppercase' }}>
                  02 // LIVE STREAM
                </div>
                <div style={{
                  background: '#FEE2E2',
                  color: '#E8002D',
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                }}>
                  FP1 + Q Telemetry
                </div>
              </div>

              {/* Solid Red connector 2 -> 3 */}
              <div style={{ flex: 1, borderTop: '2px solid #E8002D', margin: '0 8px', marginTop: -32 }} />

              {/* Step 3: Gate */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', zIndex: 2, width: 140 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#ECFDF5',
                  border: '2px solid #10B981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#10B981',
                  marginBottom: 12,
                }}>
                  <CheckCircle2 size={20} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#0F172A', textTransform: 'uppercase' }}>
                  03 // GATE
                </div>
                <div style={{ fontSize: 10, color: '#059669', fontWeight: 600, marginTop: 4 }}>
                  Passed (Zero Leakage)
                </div>
              </div>

              {/* Dotted connector 3 -> 4 */}
              <div style={{ flex: 1, borderTop: '2px dashed #0D9488', margin: '0 8px', marginTop: -32 }} />

              {/* Step 4: Simulator */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', zIndex: 2, width: 130 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#F0FDFA',
                  border: '2px solid #0D9488',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0D9488',
                  marginBottom: 12,
                }}>
                  <Box size={20} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#0F172A', textTransform: 'uppercase' }}>
                  04 // SIMULATOR
                </div>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>
                  10K Seeds Run
                </div>
              </div>

              {/* Dotted connector 4 -> 5 */}
              <div style={{ flex: 1, borderTop: '2px dashed #0D9488', margin: '0 8px', marginTop: -32 }} />

              {/* Step 5: Attribution */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', zIndex: 2, width: 130 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#F0FDFA',
                  border: '2px solid #0D9488',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0D9488',
                  marginBottom: 12,
                }}>
                  <Activity size={20} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#0F172A', textTransform: 'uppercase' }}>
                  05 // ATTRIBUTION
                </div>
                <div style={{
                  background: '#E0F2FE',
                  color: '#0284C7',
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                }}>
                  SHAP Pace Factor
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            03 // HEATMAP ATTRIBUTION | CROSS-SESSION TELEMETRY DENSITY
        ═══════════════════════════════════════════════════════════ */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#E8002D', textTransform: 'uppercase' }}>
                03 // HEATMAP ATTRIBUTION
              </span>
              <span style={{ color: '#CBD5E1', fontSize: 11 }}>|</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                CROSS-SESSION TELEMETRY DENSITY
              </span>
            </div>
            {/* Density Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: '#64748B', fontWeight: 600 }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94A3B8' }}>DENSITY / WEIGHT:</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: C_LOW }} /> Low
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: C_MED }} /> Med
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: C_HIGH }} /> High
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: C_APEX }} /> Apex
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: C_IMPUTE, border: '1px solid #E2E8F0' }} /> Imputed
              </span>
            </div>
          </div>

          <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'italic', fontSize: 18, fontWeight: 600, color: '#1E293B', margin: '0 0 6px' }}>
            Multi-Dimensional Feature &amp; Session Matrix
          </h2>
          <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 16px' }}>
            Heatmap distribution of lap-level feature correlations across qualifying sectors, straight-line top speeds, and race simulations (inspired by multi-attribute density grids).
          </p>

          {/* Matrix Table */}
          <div style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 14,
            boxShadow: '0 2px 6px rgba(15,23,42,0.03)',
            overflowX: 'auto',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                  <th style={{ padding: '12px 18px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    DRIVER / CONSTRUCTOR
                  </th>
                  {['S1 SPEED', 'S2 CORNER', 'S3 TRACTION', 'DRAG COEFF', 'TYRE HEAT', 'BRAKE EFF', 'DEGRADE', 'LONG RUN', 'WIN BIAS'].map(h => (
                    <th key={h} style={{ padding: '12px 10px', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HEATMAP_DATA.map((row, idx) => (
                  <tr key={row.driver} style={{ borderBottom: idx < HEATMAP_DATA.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    {/* Driver label */}
                    <td style={{ padding: '14px 18px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: row.teamColor }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{row.driver}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em' }}>{row.constructor}</span>
                      </div>
                    </td>
                    {/* Score badges */}
                    {[row.s1, row.s2, row.s3, row.drag, row.tyre, row.brake, row.degrade, row.longRun, row.winBias].map((cell, cidx) => (
                      <td key={cidx} style={{ padding: '10px 8px' }}>
                        <div style={{
                          width: 38,
                          height: 38,
                          borderRadius: 8,
                          background: cell.bg,
                          color: cell.color,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          margin: '0 auto',
                        }}>
                          {cell.val}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            04 // FULL GRID DISTRIBUTIONS | P1-P20 CONVERGED FORECAST
        ═══════════════════════════════════════════════════════════ */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#E8002D', textTransform: 'uppercase' }}>
                04 // FULL GRID DISTRIBUTIONS
              </span>
              <span style={{ color: '#CBD5E1', fontSize: 11 }}>|</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                P1-P20 CONVERGED FORECAST
              </span>
            </div>

            {/* Sort Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#64748B', fontWeight: 600 }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94A3B8' }}>SORT BY:</span>
              <button
                onClick={() => setSortBy('pred')}
                style={{
                  background: sortBy === 'pred' ? '#0F172A' : '#F1F5F9',
                  color: sortBy === 'pred' ? '#FFFFFF' : '#475569',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                PREDICTED POSITION
              </button>
              <button
                onClick={() => setSortBy('uci')}
                style={{
                  background: sortBy === 'uci' ? '#0F172A' : '#F1F5F9',
                  color: sortBy === 'uci' ? '#FFFFFF' : '#475569',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                UCI %
              </button>
              <button
                onClick={() => setSortBy('delta')}
                style={{
                  background: sortBy === 'delta' ? '#0F172A' : '#F1F5F9',
                  color: sortBy === 'delta' ? '#FFFFFF' : '#475569',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                DELTA GAIN
              </button>
            </div>
          </div>

          <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'italic', fontSize: 18, fontWeight: 600, color: '#1E293B', margin: '0 0 16px' }}>
            Grid-Wide Variance &amp; Density Table
          </h2>

          {/* Table Container */}
          <div style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: 14,
            boxShadow: '0 2px 6px rgba(15,23,42,0.03)',
            overflowX: 'auto',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>PRED</th>
                  <th style={{ padding: '12px 12px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>GRID</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>DRIVER &amp; CONSTRUCTOR</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase', minWidth: 160 }}>PODIUM PROBABILITY</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>WIN PROB (P1)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>P1-P20 DENSITY CURVE</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>SPEC STATUS</th>
                </tr>
              </thead>
              <tbody>
                {sortedGrid.map((row, idx) => (
                  <tr key={row.driver} style={{ borderBottom: idx < sortedGrid.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    {/* Predicted Rank */}
                    <td style={{ padding: '16px', fontSize: 13, fontWeight: 800, color: row.statusColor === '#059669' ? '#E8002D' : '#0F172A' }}>
                      {row.pred}
                    </td>

                    {/* Grid Position & Delta */}
                    <td style={{ padding: '16px 12px' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{row.grid}</span>{' '}
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: row.deltaType === 'up' ? '#059669' : row.deltaType === 'down' ? '#DC2626' : '#94A3B8',
                        fontFamily: 'monospace',
                      }}>
                        {row.delta}
                      </span>
                    </td>

                    {/* Driver & Constructor */}
                    <td style={{ padding: '16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{row.driver}</div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>{row.team}</div>
                    </td>

                    {/* Podium Probability Bar */}
                    <td style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 5, background: '#F1F5F9', borderRadius: 9999, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${row.podiumProb}%`, background: row.podiumColor, borderRadius: 9999 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', minWidth: 42 }}>
                          {row.podiumProb}%
                        </span>
                      </div>
                    </td>

                    {/* Win Prob */}
                    <td style={{ padding: '16px', fontSize: 12, fontWeight: 700, color: '#0284C7', fontFamily: 'monospace' }}>
                      {row.winProb}%
                    </td>

                    {/* Density curve (mini histogram bars) */}
                    <td style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 24 }}>
                        {row.curveBars.map((barH, bi) => (
                          <div
                            key={bi}
                            style={{
                              width: 5,
                              height: barH,
                              background: row.podiumColor,
                              borderRadius: 1,
                              opacity: 0.35 + bi * 0.15,
                            }}
                          />
                        ))}
                      </div>
                    </td>

                    {/* Spec Status */}
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        color: row.statusColor,
                        textTransform: 'uppercase',
                      }}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Table Footer Actions */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 18px',
              borderTop: '1px solid #E2E8F0',
              background: '#FFFFFF',
              flexWrap: 'wrap',
              gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669' }} />
                SHOWING TOP 5 CONTENDERS • MATRIX FULLY CONVERGED
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'transparent',
                  border: 'none',
                  color: '#475569',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}>
                  <Download size={12} />
                  EXPORT RAW TELEMETRY CSV
                </button>
                <button style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'transparent',
                  border: 'none',
                  color: '#475569',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}>
                  <Maximize2 size={12} />
                  EXPAND FULL P20 GRID
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Page Bottom Telemetry Specs Bar ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 0 0',
          borderTop: '1px solid #E2E8F0',
          fontSize: 10,
          color: '#64748B',
          fontWeight: 600,
          letterSpacing: '0.04em',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <div style={{ color: '#0F172A', fontWeight: 700 }}>SLIPSTREAM PRO TELEMETRY CORP</div>
            <div style={{ color: '#94A3B8', fontSize: 9 }}>© 2026 FIA PRECISION MOTORSPORT ANALYTICS ENGINE. CALIBRATED 20HZ TOLERANCE.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, textTransform: 'uppercase' }}>
            <span>LATENCY: <strong style={{ color: '#0F172A' }}>14MS</strong></span>
            <span>ENCRYPTION: <strong style={{ color: '#0D9488' }}>HARDENED TLS</strong></span>
            <span>NODE_EU_CENTRAL</span>
          </div>
        </div>

      </div>
    </div>
  )
}

