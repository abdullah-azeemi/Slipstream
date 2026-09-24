'use client'

import React, { useState, useMemo } from 'react'
import Link from 'next/link'
import { Search, ChevronRight } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface SessionTag {
  label: string
  type: 'available' | 'synced' | 'loading'
}

interface GrandPrix {
  round: number
  name: string
  circuit: string
  country: string
  dates: string
  qualifyingPole: { driver: string; time: string }
  raceWinner: { driver: string; detail: string }
  telemetryStatus: string
  telemetryColor: string
  sessions: SessionTag[]
  status: 'verified' | 'partial' | 'loading'
  isNew?: boolean
  isSprint?: boolean
}

// ── Static Data ───────────────────────────────────────────────────────────────

const GRAND_PRIX_DATA: GrandPrix[] = [
  {
    round: 62,
    name: 'Italian Grand Prix',
    circuit: 'Autodromo Nazionale Monza',
    country: 'Monza, Italy',
    dates: '5 – 8 Sep 2026',
    qualifyingPole: { driver: 'L. Norris', time: '1:19.317' },
    raceWinner: { driver: 'L. Norris', detail: '53 Laps · 1 Stop' },
    telemetryStatus: 'All Sessions Active',
    telemetryColor: '#10B981',
    sessions: [
      { label: 'Practice 1', type: 'available' },
      { label: 'Practice 2', type: 'available' },
      { label: 'Practice 3', type: 'available' },
      { label: 'Qualifying', type: 'synced' },
      { label: 'Race Session', type: 'synced' },
    ],
    status: 'verified',
    isNew: true,
  },
  {
    round: 61,
    name: 'Dutch Grand Prix',
    circuit: 'Circuit Zandvoort',
    country: 'Zandvoort, Netherlands',
    dates: '22 – 25 Aug 2026',
    qualifyingPole: { driver: 'L. Norris', time: '1:08.473' },
    raceWinner: { driver: 'L. Norris', detail: '452.49km margin' },
    telemetryStatus: 'Full Data Loaded',
    telemetryColor: '#10B981',
    sessions: [
      { label: 'Practice 1', type: 'available' },
      { label: 'Practice 2', type: 'available' },
      { label: 'Practice 3', type: 'available' },
      { label: 'Qualifying', type: 'synced' },
      { label: 'Race Loaded', type: 'synced' },
    ],
    status: 'verified',
  },
  {
    round: 68,
    name: 'Hungarian Grand Prix',
    circuit: 'Hungaroring',
    country: 'Mogyoród, Hungary',
    dates: '17 – 21 Jul 2026',
    qualifyingPole: { driver: 'L. Norris', time: '1:15.227' },
    raceWinner: { driver: 'O. Piastri', detail: 'Beaten History' },
    telemetryStatus: '6 Sessions Synced',
    telemetryColor: '#10B981',
    sessions: [
      { label: 'Practice 1', type: 'available' },
      { label: 'Practice 2', type: 'available' },
      { label: 'Practice 3', type: 'available' },
      { label: 'Qualifying', type: 'synced' },
      { label: 'Race Loaded', type: 'synced' },
    ],
    status: 'verified',
  },
  {
    round: 58,
    name: 'British Grand Prix',
    circuit: 'Silverstone Circuit',
    country: 'Silverstone, Great Britain',
    dates: '04 – 07 Jul 2025',
    qualifyingPole: { driver: 'G. Russell', time: '1:25.311' },
    raceWinner: { driver: 'L. Hamilton', detail: 'Pole MC Team' },
    telemetryStatus: 'Telemetry Input Complete',
    telemetryColor: '#10B981',
    sessions: [
      { label: 'Practice 1', type: 'available' },
      { label: 'Sprint Qualifying', type: 'available' },
      { label: 'Sprint Race', type: 'available' },
      { label: 'Qualifying', type: 'synced' },
      { label: 'Race Session', type: 'synced' },
    ],
    status: 'verified',
    isSprint: true,
  },
  {
    round: 55,
    name: 'Monaco Grand Prix',
    circuit: 'Circuit de Monaco',
    country: 'Monte Carlo, Monaco',
    dates: '24 – 26 May 2025',
    qualifyingPole: { driver: 'C. Leclerc', time: '1:09.718' },
    raceWinner: { driver: 'C. Leclerc', detail: 'Ferrari, New Team' },
    telemetryStatus: 'Full Dataset Verified',
    telemetryColor: '#10B981',
    sessions: [
      { label: 'Practice 1', type: 'available' },
      { label: 'Practice 2', type: 'available' },
      { label: 'Practice 3', type: 'available' },
      { label: 'Qualifying', type: 'synced' },
      { label: 'Race Session', type: 'synced' },
    ],
    status: 'verified',
  },
]

const SESSION_FILTERS = ['All Sessions', 'FP1', 'FP2', 'FP3', 'Qualifying', 'Sprint', 'Grand Prix']
const CHAMPIONSHIP_OPTIONS = ['2026 Championship', '2025 Championship', '2024 Championship', '2023 Championship']

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBadge({ value, label, sub, color }: { value: string; label: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid #E5E7EB',
      borderRadius: 12,
      padding: '14px 20px',
      minWidth: 105,
    }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || '#111827', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', letterSpacing: '0.07em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#10B981', fontWeight: 600, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function SessionPill({ tag }: { tag: SessionTag }) {
  const colors: Record<string, { bg: string; color: string }> = {
    available: { bg: '#F0FDF4', color: '#15803D' },
    synced:    { bg: '#EFF6FF', color: '#1D4ED8' },
    loading:   { bg: '#FEF9C3', color: '#92400E' },
  }
  const c = colors[tag.type]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 9999,
      fontSize: 11,
      fontWeight: 500,
      background: c.bg,
      color: c.color,
      whiteSpace: 'nowrap',
    }}>
      {tag.label}
    </span>
  )
}

function GPCard({ gp }: { gp: GrandPrix }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #E5E7EB',
        borderRadius: 14,
        overflow: 'hidden',
        transition: 'box-shadow 200ms',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.07)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Main row */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '52px 1fr 20px', alignItems: 'center', gap: 16, padding: '18px 20px', cursor: 'pointer' }}
        onClick={() => setExpanded(x => !x)}
      >
        {/* Round */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase' }}>RD</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', lineHeight: 1 }}>{gp.round}</div>
        </div>

        {/* Content */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{gp.name}</span>
            {gp.isNew && (
              <span style={{ fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#DC2626', padding: '2px 8px', borderRadius: 9999, letterSpacing: '0.04em' }}>
                NEW
              </span>
            )}
            {gp.isSprint && (
              <span style={{ fontSize: 10, fontWeight: 700, background: '#EDE9FE', color: '#7C3AED', padding: '2px 8px', borderRadius: 9999 }}>
                SPRINT WEEKEND
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>{gp.country} · {gp.dates}</div>

          {/* Stats grid */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Qualifying Pole</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{gp.qualifyingPole.driver}</div>
              <div style={{ fontSize: 11, color: '#6B7280', fontFamily: '"JetBrains Mono", monospace' }}>{gp.qualifyingPole.time}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Race Winner</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{gp.raceWinner.driver}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{gp.raceWinner.detail}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Telemetry Data</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: gp.telemetryColor }}>{gp.telemetryStatus}</div>
            </div>
          </div>
        </div>

        {/* Chevron */}
        <ChevronRight
          size={16}
          color="#9CA3AF"
          style={{ transition: 'transform 200ms', transform: expanded ? 'rotate(90deg)' : 'none', flexShrink: 0 }}
        />
      </div>

      {/* Sessions row */}
      <div style={{
        borderTop: '1px solid #F3F4F6',
        padding: '10px 20px 12px 88px',
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        {gp.sessions.map((s, i) => <SessionPill key={i} tag={s} />)}
        <Link
          href="/sessions"
          style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}
        >
          {gp.round} Load Sessions <ChevronRight size={11} />
        </Link>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          borderTop: '1px solid #F3F4F6',
          background: '#F9FAFB',
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
        }}>
          {[
            { label: 'Fastest Lap', value: gp.qualifyingPole.time, icon: '⚡' },
            { label: 'DRS Zones',   value: '3 Active',             icon: '📡' },
            { label: 'Top Speed',   value: '341 km/h',             icon: '🏎️' },
            { label: 'Tire Data',   value: 'C3 · C4 · C5',        icon: '🔵' },
          ].map(item => (
            <div key={item.label} style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{item.value}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HistoricalArchivePage() {
  const [activeFilter, setActiveFilter] = useState('All Sessions')
  const [search, setSearch] = useState('')
  const [championship, setChampionship] = useState('2026 Championship')

  const filtered = useMemo(() =>
    GRAND_PRIX_DATA.filter(gp =>
      !search ||
      gp.name.toLowerCase().includes(search.toLowerCase()) ||
      gp.country.toLowerCase().includes(search.toLowerCase())
    ),
    [search]
  )

  return (
    <div style={{ background: '#F8FAFC', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 20px 96px' }}>

        {/* ── Breadcrumb ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
          {['DATABASE INDEX', 'TELEMETRY', 'SESSIONS ARCHIVE'].map((crumb, i, arr) => (
            <React.Fragment key={crumb}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: i === arr.length - 1 ? '#111827' : '#9CA3AF',
              }}>
                {crumb}
              </span>
              {i < arr.length - 1 && <ChevronRight size={10} color="#D1D5DB" />}
            </React.Fragment>
          ))}
          <span style={{ marginLeft: 8, fontSize: 10, color: '#9CA3AF', fontFamily: 'monospace' }}>F1A 2026 v1.12</span>
        </div>

        {/* ── Hero ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 32, flexWrap: 'wrap', marginBottom: 36 }}>
          <div style={{ flex: '1 1 380px' }}>
            <h1 style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: 'clamp(36px, 6vw, 56px)',
              fontWeight: 700,
              color: '#111827',
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              marginBottom: 14,
            }}>
              Historical Archive
            </h1>
            <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.75, maxWidth: 460 }}>
              Complete telemetry streams, calibrated high-frequency session timelines, and engineered race analytics for every Grand Prix synchronized in the current global telemetry pool.
            </p>
          </div>

          {/* Stat badges */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start', paddingTop: 8 }}>
            <StatBadge value="62"       label="GPs Total"  sub="GPs Stored" />
            <StatBadge value="300"      label="Sessions"   sub="Sessions Total" />
            <StatBadge value="All 2024" label="Verified"   sub="Full Data Synced" color="#10B981" />
          </div>
        </div>

        {/* ── Filter bar ─────────────────────────────────────────── */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E5E7EB',
          borderRadius: 14,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Filter</span>

          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            {SESSION_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                style={{
                  padding: '5px 13px',
                  borderRadius: 9999,
                  border: activeFilter === f ? '1.5px solid #111827' : '1px solid #E5E7EB',
                  background: activeFilter === f ? '#111827' : '#FFFFFF',
                  color: activeFilter === f ? '#FFFFFF' : '#4B5563',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 150ms',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', minWidth: 180 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search circuit, race..."
              style={{
                width: '100%',
                padding: '6px 12px 6px 30px',
                border: '1px solid #E5E7EB',
                borderRadius: 9999,
                fontSize: 12,
                color: '#111827',
                background: '#F9FAFB',
                outline: 'none',
              }}
            />
          </div>

          {/* Championship dropdown */}
          <select
            value={championship}
            onChange={e => setChampionship(e.target.value)}
            style={{
              padding: '6px 12px',
              border: '1px solid #E5E7EB',
              borderRadius: 9999,
              fontSize: 12,
              color: '#111827',
              background: '#F9FAFB',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {CHAMPIONSHIP_OPTIONS.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>

        {/* ── GP Cards ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 56 }}>
          {filtered.map(gp => <GPCard key={gp.round} gp={gp} />)}
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#9CA3AF', fontSize: 14 }}>
              No races found for &ldquo;{search}&rdquo;
            </div>
          )}
        </div>

        {/* ── Engineering Spotlight ──────────────────────────────── */}
        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>

            {/* Left – dark telemetry panel */}
            <div style={{ background: '#0F172A', padding: '28px 24px', color: '#FFFFFF' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981' }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748B' }}>
                  Generate Telemetry Overlay
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>Live Sync · Pole · P2</span>
              </div>

              {/* Driver selectors */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[
                  { name: 'L. Norris (MCL)', color: '#FF8000' },
                  { name: 'C. Leclerc (SF-24)', color: '#E8002D' },
                ].map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1E293B', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: '#CBD5E1' }}>{d.name}</span>
                  </div>
                ))}
              </div>

              {/* Sparkline */}
              <div style={{ background: '#1E293B', borderRadius: 10, padding: '14px', marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: '#475569' }}>Curve Throttle — Trepole Chicane</span>
                  <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>Δ +0.13s</span>
                </div>
                <svg width="100%" height="72" viewBox="0 0 280 72" style={{ overflow: 'visible' }}>
                  {/* Norris */}
                  <polyline
                    points="0,60 35,44 70,18 100,12 130,22 160,38 190,28 220,8 260,4 280,6"
                    fill="none" stroke="#FF8000" strokeWidth="2" strokeLinejoin="round"
                  />
                  {/* Leclerc */}
                  <polyline
                    points="0,64 35,50 70,28 100,20 130,32 160,48 190,40 220,18 260,15 280,20"
                    fill="none" stroke="#E8002D" strokeWidth="2" strokeLinejoin="round" strokeDasharray="5 3"
                  />
                </svg>
                <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: '#FF8000' }}>— Norris (MCL)</span>
                  <span style={{ fontSize: 10, color: '#E8002D' }}>- - Leclerc (SF)</span>
                </div>
              </div>

              {/* Mini metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                {[
                  { label: 'Telemetry Sync', value: 'Instant' },
                  { label: 'Read Channels', value: '48 Active' },
                ].map(m => (
                  <div key={m.label} style={{ background: '#1E293B', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#FFFFFF', marginTop: 2 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <button style={{
                width: '100%',
                padding: '10px',
                background: '#1D4ED8',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                letterSpacing: '0.02em',
              }}>
                Run Monza Sector Matrix
              </button>
            </div>

            {/* Right – editorial breakdown */}
            <div style={{ padding: '32px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#E8002D' }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6B7280' }}>
                  Engineering Spotlight · Monza 2026
                </span>
              </div>

              <h2 style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontSize: 'clamp(22px, 3.5vw, 32px)',
                fontWeight: 700,
                color: '#111827',
                lineHeight: 1.22,
                marginBottom: 16,
              }}>
                Monza Telemetry Breakdown: Norris vs Leclerc Sector 2 Apex Speed
              </h2>

              <p style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.8, marginBottom: 24 }}>
                Our synchronized telemetry reveals how Ferrari&apos;s all-or-stop-the management protocol preserved gaining residence in the Ascari Chicane, offsetting McLaren&apos;s 6.8 km/h aerodynamic peak velocity advantage into the Parabolica.
              </p>

              {/* Tech stats table */}
              <div style={{ marginBottom: 24 }}>
                {[
                  { label: 'Tyre Degradation (Sella Hard C3 Compound)', value: '4.300 s/lap' },
                  { label: 'Braking Point Turn Balance',                 value: '6.4 metres later' },
                  { label: 'ERS Deployment Efficiency',                  value: '94.6% peak options' },
                  { label: 'Apex Minimum Speed (Curva Grande)',           value: '294.2 cv/h' },
                ].map(stat => (
                  <div key={stat.label} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '9px 0',
                    borderBottom: '1px solid #F3F4F6',
                  }}>
                    <span style={{ fontSize: 12, color: '#6B7280' }}>{stat.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#111827', fontFamily: 'monospace', whiteSpace: 'nowrap', marginLeft: 16 }}>{stat.value}</span>
                  </div>
                ))}
              </div>

              <Link href="/sessions" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 22px',
                background: '#E8002D',
                color: '#FFFFFF',
                borderRadius: 9999,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}>
                Explore Full Session Telemetry <ChevronRight size={14} />
              </Link>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
