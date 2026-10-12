'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RotateCw,
  Database,
  RefreshCw,
  CheckCircle2,
  Box,
  Activity,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react'
import { authHeaders } from '@/lib/auth-token'
import type {
  Session,
  PredictionResponse,
  DriverPrediction,
  FeatureStream,
} from '@/types/f1'

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

// ── Palette ───────────────────────────────────────────────────────────────────
const C_APEX = '#1E3A8A' // dark navy
const C_HIGH = '#2563EB' // royal blue
const C_MED = '#60A5FA'  // medium blue
const C_LOW = '#93C5FD'  // light blue
const C_IMPUTE = '#F1F5F9' // grey

const FALLBACK_TEAM_COLOR = '#64748B'

// ── Helpers ───────────────────────────────────────────────────────────────────

function teamHex(colour?: string | null): string {
  if (!colour) return FALLBACK_TEAM_COLOR
  const clean = colour.replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `#${clean}` : FALLBACK_TEAM_COLOR
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

function pctNum(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0
  return Math.round(value * 1000) / 10
}

function densityColor(value: number, max: number): { bg: string; color: string } {
  if (max <= 0) return { bg: C_IMPUTE, color: '#94A3B8' }
  const ratio = value / max
  if (ratio >= 0.85) return { bg: C_APEX, color: '#FFFFFF' }
  if (ratio >= 0.6) return { bg: C_HIGH, color: '#FFFFFF' }
  if (ratio >= 0.35) return { bg: C_MED, color: '#FFFFFF' }
  return { bg: C_LOW, color: '#1E293B' }
}

function statusFor(d: DriverPrediction): { label: string; color: string } {
  const delta = d.grid_position - d.predicted_position
  if (d.predicted_position === 1) return { label: 'Race favorite', color: '#059669' }
  if (d.podium_probability >= 0.5) return { label: 'Podium lock', color: '#0D9488' }
  if (delta >= 3) return { label: 'Ascending', color: '#0284C7' }
  if (delta <= -3) return { label: 'At risk', color: '#DC2626' }
  return { label: 'Midfield', color: '#64748B' }
}

type SortKey = 'pred' | 'uci' | 'delta'

export default function PredictionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [data, setData] = useState<PredictionResponse | null>(null)
  const [driverNames, setDriverNames] = useState<Record<number, string>>({})
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelUnavailable, setModelUnavailable] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('pred')
  const [isSimulating, setIsSimulating] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  // ── Load the list of qualifying sessions (the selector source) ──────────────
  useEffect(() => {
    let cancelled = false
    fetch(`${BASE}/api/v1/sessions`, { headers: authHeaders() })
      .then(r => r.json())
      .then((rows: Session[] | { error?: string }) => {
        if (cancelled) return
        const quali = (Array.isArray(rows) ? rows : [])
          .filter(s => s.session_type === 'Q' || s.session_type === 'SQ')
          .sort(
            (a, b) =>
              new Date(b.date_start ?? 0).getTime() - new Date(a.date_start ?? 0).getTime()
          )
        setSessions(quali)
        if (quali.length) setSelectedKey(quali[0].session_key)
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load sessions')
      })
      .finally(() => {
        if (!cancelled) setLoadingSessions(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ── Load predictions for the selected session ───────────────────────────────
  useEffect(() => {
    if (selectedKey == null) return
    let cancelled = false
    setPredicting(true)
    setError(null)
    setModelUnavailable(null)
    setData(null)

    fetch(`${BASE}/api/v1/sessions/${selectedKey}/predictions`, { headers: authHeaders() })
      .then(async r => {
        const body = await r.json().catch(() => null)
        if (cancelled) return
        if (!r.ok) {
          if (r.status === 503) {
            setModelUnavailable(
              body?.detail ??
                'No trained model is available for this weekend yet. Train the model, then retry.'
            )
            return
          }
          setError(body?.error ?? `Prediction request failed (${r.status})`)
          return
        }
        setData(body as PredictionResponse)
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Prediction request failed')
      })
      .finally(() => {
        if (!cancelled) setPredicting(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedKey, reloadToken])

  // ── Resolve full driver names for the selected session ──────────────────────
  useEffect(() => {
    if (selectedKey == null) return
    let cancelled = false
    fetch(`${BASE}/api/v1/sessions/${selectedKey}/drivers`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: { driver_number: number; full_name: string }[]) => {
        if (cancelled || !Array.isArray(rows)) return
        const map: Record<number, string> = {}
        for (const d of rows) map[d.driver_number] = d.full_name
        setDriverNames(map)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selectedKey])

  const selectedSession = useMemo(
    () => sessions.find(s => s.session_key === selectedKey) ?? null,
    [sessions, selectedKey]
  )

  const driverName = useCallback(
    (d: DriverPrediction) => driverNames[d.driver_number] ?? d.abbreviation,
    [driverNames]
  )

  const predictions = useMemo(() => data?.predictions ?? [], [data])

  // ── Podium candidates: top 3 by podium probability ──────────────────────────
  const podium = useMemo(
    () =>
      [...predictions]
        .sort((a, b) => b.podium_probability - a.podium_probability)
        .slice(0, 3),
    [predictions]
  )

  const podiumLabels = ['P1 FAVORITE', 'P2 CHALLENGER', 'P3 WILDCARD']

  // ── Feature-stream heatmap ──────────────────────────────────────────────────
  const heatmap = useMemo(() => {
    if (!predictions.length) return { columns: [] as FeatureStream[], rows: [] as { d: DriverPrediction; streams: Record<string, FeatureStream> }[] }

    const totals: Record<string, number> = {}
    for (const p of predictions) {
      for (const st of p.feature_streams ?? []) {
        totals[st.stream] = (totals[st.stream] ?? 0) + st.share
      }
    }
    const columns = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([stream]) => {
        const sample = predictions
          .flatMap(p => p.feature_streams ?? [])
          .find(s => s.stream === stream)
        return (
          sample ?? { stream, label: stream.replace(/_/g, ' '), share: 0, score: 0 }
        )
      })

    const rows = [...predictions]
      .sort((a, b) => b.podium_probability - a.podium_probability)
      .slice(0, 8)
      .map(d => {
        const streams: Record<string, FeatureStream> = {}
        for (const st of d.feature_streams ?? []) streams[st.stream] = st
        return { d, streams }
      })

    return { columns, rows }
  }, [predictions])

  const streamMax = useMemo(() => {
    let max = 0
    for (const { streams } of heatmap.rows) {
      for (const st of Object.values(streams)) max = Math.max(max, st.share)
    }
    return max
  }, [heatmap])

  // ── Grid table (sortable) ───────────────────────────────────────────────────
  const sortedGrid = useMemo(() => {
    const list = [...predictions]
    if (sortBy === 'uci') return list.sort((a, b) => b.win_probability - a.win_probability)
    if (sortBy === 'delta')
      return list.sort(
        (a, b) =>
          b.grid_position - b.predicted_position - (a.grid_position - a.predicted_position)
      )
    return list.sort((a, b) => a.predicted_position - b.predicted_position)
  }, [predictions, sortBy])

  const maxCurve = useMemo(() => {
    let max = 0
    for (const d of predictions) {
      for (const v of Object.values(d.position_probabilities ?? {})) max = Math.max(max, v)
    }
    return max || 1
  }, [predictions])

  const handleRerunSim = () => {
    setIsSimulating(true)
    setReloadToken(t => t + 1)
    setTimeout(() => setIsSimulating(false), 700)
  }

  const gpName = data?.gp_name ?? selectedSession?.gp_name ?? 'Race Weekend'
  const gpYear = data?.year ?? selectedSession?.year ?? ''
  const model = data?.model
  const weekendInputs = data?.weekend_inputs_used ?? {}

  const availableStreams = Object.values(weekendInputs).filter(w => w.available)
  const liveStreamLabel = availableStreams.length
    ? availableStreams
        .map(w => w.session_type)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(' + ')
    : 'Awaiting session data'

  if (loadingSessions) {
    return (
      <div style={{ background: '#F8FAFC', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#64748B', fontSize: 13, fontWeight: 600 }}>
          <RotateCw size={16} className="animate-spin" /> Loading qualifying sessions…
        </div>
      </div>
    )
  }

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
            {gpName.toUpperCase()}{gpYear ? ` • ${gpYear}` : ''}
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
              Qualifying-led probabilistic forecast for the {gpYear} {gpName}, generated by the
              Slipstream model with Monte Carlo variance, pipeline attribution and multi-dimensional
              session feature density.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            {/* Session Selector */}
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
                SESSION CALIBRATION
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <select
                  value={selectedKey ?? ''}
                  onChange={(e) => setSelectedKey(Number(e.target.value))}
                  disabled={!sessions.length}
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
                    maxWidth: 260,
                  }}
                >
                  {!sessions.length && <option value="">No qualifying sessions</option>}
                  {sessions.map(s => (
                    <option key={s.session_key} value={s.session_key}>
                      {s.year} {s.gp_name} — {s.session_type === 'SQ' ? 'Sprint Qualifying' : 'Qualifying'}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} color="#64748B" style={{ position: 'absolute', right: 10, bottom: 8, pointerEvents: 'none' }} />
              </div>
            </div>

            {/* Rerun Sim Button */}
            <button
              onClick={handleRerunSim}
              disabled={!data || predicting}
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
                cursor: !data || predicting ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 8px rgba(232,0,45,0.25)',
                transition: 'all 150ms ease',
                opacity: isSimulating || predicting || !data ? 0.7 : 1,
              }}
            >
              <RotateCw size={14} className={isSimulating || predicting ? 'animate-spin' : ''} />
              RERUN SIM
            </button>
          </div>
        </div>

        {/* ── Error / Model unavailable banners ── */}
        {error && (
          <Banner tone="error" title="Prediction request failed" body={error} />
        )}
        {modelUnavailable && (
          <Banner tone="warn" title="Model not trained for this weekend yet" body={modelUnavailable} />
        )}

        {predicting && !data && (
          <div style={{
            background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: '40px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            color: '#64748B', fontSize: 13, fontWeight: 600, marginBottom: 36,
          }}>
            <RotateCw size={16} className="animate-spin" /> Running Monte Carlo simulation…
          </div>
        )}

        {!sessions.length && !error && (
          <Banner
            tone="warn"
            title="No qualifying data ingested yet"
            body="Once qualifying sessions are ingested, they will show up in the selector above."
          />
        )}

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
          <Metric label="AIR / TRACK TEMP" value={
            selectedSession?.air_temp_c != null && selectedSession?.track_temp_c != null
              ? `${selectedSession.air_temp_c.toFixed(1)}°C / ${selectedSession.track_temp_c.toFixed(1)}°C`
              : '—'
          } />
          <Metric label="RAINFALL" value={selectedSession?.rainfall == null ? '—' : selectedSession.rainfall ? 'Yes' : 'No'} color={selectedSession?.rainfall ? '#0284C7' : undefined} />
          <Metric label="MODEL TOP-3 ACC" value={pct(model?.cv_top3_accuracy_mean ?? data?.model_baselines?.model_top3_accuracy ?? null)} color="#0D9488" />
          <Metric label="GRID BASELINE" value={pct(model?.grid_baseline_top3_accuracy_mean ?? data?.model_baselines?.grid_top3_accuracy ?? null)} />
          <Metric label="PODIUM BRIER" value={model?.cv_podium_brier_mean != null ? model.cv_podium_brier_mean.toFixed(3) : '—'} color="#0D9488" />
          <Metric label="TRAINING ROWS" value={model?.n_training_rows != null ? model.n_training_rows.toLocaleString() : '—'} />
        </div>

        {/* ═══════════════════════════════════════════════════════════
            01 // PODIUM CANDIDATES
        ═══════════════════════════════════════════════════════════ */}
        {podium.length > 0 && (
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
                MONTE CARLO SAMPLING
              </span>
            </div>

            {/* 3 Driver Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              {podium.map((d, i) => {
                const color = teamHex(d.team_colour)
                const factors = d.factors ?? []
                return (
                  <div key={d.driver_number} style={{
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color, textTransform: 'uppercase' }}>
                          {podiumLabels[i]} • CAR #{d.driver_number}
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: '#94A3B8', textTransform: 'uppercase' }}>
                          {d.team_name ?? '—'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <h3 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                          {driverName(d)}
                        </h3>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1, letterSpacing: '-0.03em' }}>
                            {pctNum(d.podium_probability)}%
                          </div>
                          <div style={{ fontSize: 8, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                            PODIUM PROB
                          </div>
                        </div>
                      </div>

                      <div style={{ height: 3, background: '#F1F5F9', borderRadius: 9999, overflow: 'hidden', marginBottom: 14 }}>
                        <div style={{ height: '100%', width: `${Math.min(100, pctNum(d.podium_probability))}%`, background: color, borderRadius: 9999 }} />
                      </div>

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
                        <span>WIN: <strong style={{ color: '#0F172A' }}>{pctNum(d.win_probability)}%</strong></span>
                        <span>P2: <strong style={{ color: '#0F172A' }}>{pctNum(d.position_probabilities?.['2'])}%</strong></span>
                        <span>P3: <strong style={{ color: '#0F172A' }}>{pctNum(d.position_probabilities?.['3'])}%</strong></span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {[0, 1].map(fi => {
                        const f = factors[fi]
                        return (
                          <div key={fi}>
                            <div style={{ fontSize: 8, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                              {f ? (f.stream_label ?? f.feature).toUpperCase() : 'KEY FACTOR'}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: f ? (f.positive ? '#059669' : '#DC2626') : '#0F172A', marginTop: 2 }}>
                              {f ? f.label : '—'}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
              <span style={{ color: '#475569', letterSpacing: '0.04em' }}>{model?.best_estimator ?? 'Gradient Boosting'}</span>
            </div>
          </div>

          <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'italic', fontSize: 18, fontWeight: 600, color: '#1E293B', margin: '0 0 16px' }}>
            Directed Acyclic Inference Graph
          </h2>

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
              <DagStep
                index="01 // HISTORY"
                icon={<Database size={20} />}
                bg="#E6FFFA"
                border="#0D9488"
                tone="#0D9488"
                caption={model?.n_training_rows != null ? `${model.n_training_rows.toLocaleString()} Rows` : 'No model'}
              />
              <Connector tone="#0D9488" dashed />
              <DagStep
                index="02 // LIVE STREAM"
                icon={<RefreshCw size={20} />}
                bg="#FEE2E2"
                border="#E8002D"
                tone="#E8002D"
                badge={liveStreamLabel}
              />
              <Connector tone="#E8002D" />
              <DagStep
                index="03 // GATE"
                icon={<CheckCircle2 size={20} />}
                bg="#ECFDF5"
                border="#10B981"
                tone="#10B981"
                caption={data?.validation_report?.available ? 'Passed (Zero Leakage)' : 'Validation pending'}
              />
              <Connector tone="#0D9488" dashed />
              <DagStep
                index="04 // SIMULATOR"
                icon={<Box size={20} />}
                bg="#F0FDFA"
                border="#0D9488"
                tone="#0D9488"
                caption={model?.cv_folds != null ? `${model.cv_folds} CV Folds` : 'Monte Carlo'}
              />
              <Connector tone="#0D9488" dashed />
              <DagStep
                index="05 // ATTRIBUTION"
                icon={<Activity size={20} />}
                bg="#F0FDFA"
                border="#0D9488"
                tone="#0D9488"
                badge="SHAP Attribution"
              />
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            03 // HEATMAP ATTRIBUTION | FEATURE STREAM DENSITY
        ═══════════════════════════════════════════════════════════ */}
        {heatmap.columns.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#E8002D', textTransform: 'uppercase' }}>
                  03 // HEATMAP ATTRIBUTION
                </span>
                <span style={{ color: '#CBD5E1', fontSize: 11 }}>|</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  FEATURE STREAM DENSITY
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: '#64748B', fontWeight: 600 }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94A3B8' }}>DENSITY / WEIGHT:</span>
                {[['Low', C_LOW], ['Med', C_MED], ['High', C_HIGH], ['Apex', C_APEX]].map(([lab, col]) => (
                  <span key={lab} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: col }} /> {lab}
                  </span>
                ))}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: C_IMPUTE, border: '1px solid #E2E8F0' }} /> Imputed
                </span>
              </div>
            </div>

            <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'italic', fontSize: 18, fontWeight: 600, color: '#1E293B', margin: '0 0 6px' }}>
              Multi-Dimensional Feature &amp; Session Matrix
            </h2>
            <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 16px' }}>
              Per-driver attribution of predicted finishing position across the model&apos;s feature
              streams (car pace, tyre strategy, form, circuit context) plus win bias.
            </p>

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
                    {heatmap.columns.map(c => (
                      <th key={c.stream} style={{ padding: '12px 10px', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        {c.label}
                      </th>
                    ))}
                    <th style={{ padding: '12px 10px', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      WIN BIAS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {heatmap.rows.map(({ d, streams }, idx) => (
                    <tr key={d.driver_number} style={{ borderBottom: idx < heatmap.rows.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                      <td style={{ padding: '14px 18px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: teamHex(d.team_colour) }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{d.abbreviation}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em' }}>
                            {d.team_name ? d.team_name.slice(0, 3).toUpperCase() : '—'}
                          </span>
                        </div>
                      </td>
                      {heatmap.columns.map(c => {
                        const st = streams[c.stream]
                        const { bg, color } = st ? densityColor(st.share, streamMax) : { bg: C_IMPUTE, color: '#94A3B8' }
                        return (
                          <td key={c.stream} style={{ padding: '10px 8px' }}>
                            <Cell bg={bg} color={color} value={st ? st.share.toFixed(2).replace(/^0/, '') : 'N/A'} />
                          </td>
                        )
                      })}
                      <td style={{ padding: '10px 8px' }}>
                        {(() => {
                          const { bg, color } = densityColor(d.win_probability, Math.max(...predictions.map(p => p.win_probability), 0.01))
                          return <Cell bg={d.win_probability > 0 ? bg : C_IMPUTE} color={color} value={d.win_probability.toFixed(2).replace(/^0/, '')} />
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            04 // FULL GRID DISTRIBUTIONS
        ═══════════════════════════════════════════════════════════ */}
        {sortedGrid.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#E8002D', textTransform: 'uppercase' }}>
                  04 // FULL GRID DISTRIBUTIONS
                </span>
                <span style={{ color: '#CBD5E1', fontSize: 11 }}>|</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  P1-{sortedGrid.length} CONVERGED FORECAST
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#64748B', fontWeight: 600 }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94A3B8' }}>SORT BY:</span>
                {([['pred', 'PREDICTED POSITION'], ['uci', 'WIN %'], ['delta', 'DELTA GAIN']] as [SortKey, string][]).map(([key, lab]) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    style={{
                      background: sortBy === key ? '#0F172A' : '#F1F5F9',
                      color: sortBy === key ? '#FFFFFF' : '#475569',
                      border: 'none',
                      borderRadius: 6,
                      padding: '4px 8px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                      textTransform: 'uppercase',
                    }}
                  >
                    {lab}
                  </button>
                ))}
              </div>
            </div>

            <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontStyle: 'italic', fontSize: 18, fontWeight: 600, color: '#1E293B', margin: '0 0 16px' }}>
              Grid-Wide Variance &amp; Density Table
            </h2>

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
                    {['PRED', 'GRID', 'DRIVER & CONSTRUCTOR'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase', minWidth: 160 }}>PODIUM PROBABILITY</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>WIN PROB (P1)</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>DENSITY CURVE</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 9, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGrid.map((d, idx) => {
                    const color = teamHex(d.team_colour)
                    const delta = d.grid_position - d.predicted_position
                    const deltaType = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same'
                    const status = statusFor(d)
                    const posProbs = d.position_probabilities ?? {}
                    const bars = Object.keys(posProbs)
                      .map(Number)
                      .filter(n => Number.isFinite(n))
                      .sort((a, b) => a - b)
                      .slice(0, 10)
                      .map(n => posProbs[String(n)] ?? 0)
                    return (
                      <tr key={d.driver_number} style={{ borderBottom: idx < sortedGrid.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                        <td style={{ padding: '16px', fontSize: 13, fontWeight: 800, color: d.predicted_position === 1 ? '#E8002D' : '#0F172A' }}>
                          P{d.predicted_position}
                        </td>
                        <td style={{ padding: '16px 12px' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>P{d.grid_position}</span>{' '}
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: deltaType === 'up' ? '#059669' : deltaType === 'down' ? '#DC2626' : '#94A3B8',
                            fontFamily: 'monospace',
                          }}>
                            {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0'}
                          </span>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{driverName(d)}</div>
                          <div style={{ fontSize: 11, color: '#64748B' }}>{d.team_name ?? '—'}</div>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ flex: 1, height: 5, background: '#F1F5F9', borderRadius: 9999, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(100, pctNum(d.podium_probability))}%`, background: color, borderRadius: 9999 }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', minWidth: 42 }}>
                              {pctNum(d.podium_probability)}%
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '16px', fontSize: 12, fontWeight: 700, color: '#0284C7', fontFamily: 'monospace' }}>
                          {pctNum(d.win_probability)}%
                        </td>
                        <td style={{ padding: '16px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 24 }}>
                            {bars.map((v, bi) => (
                              <div
                                key={bi}
                                style={{
                                  width: 5,
                                  height: Math.max(2, Math.round((v / maxCurve) * 24)),
                                  background: color,
                                  borderRadius: 1,
                                  opacity: 0.35 + bi * 0.06,
                                }}
                              />
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: status.color,
                            textTransform: 'uppercase',
                          }}>
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

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
                  SHOWING {sortedGrid.length} DRIVERS • MATRIX CONVERGED
                </div>
              </div>
            </div>
          </div>
        )}

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
            <div style={{ color: '#94A3B8', fontSize: 9 }}>© 2026 FIA PRECISION MOTORSPORT ANALYTICS ENGINE.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, textTransform: 'uppercase' }}>
            <span>SCOPE: <strong style={{ color: '#0F172A' }}>{model?.scope?.toUpperCase() ?? '—'}</strong></span>
            <span>YEARS: <strong style={{ color: '#0D9488' }}>{model?.years?.length ? model.years.join(', ') : '—'}</strong></span>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Small presentational helpers ─────────────────────────────────────────────

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? '#0F172A', marginTop: 3 }}>{value}</div>
    </div>
  )
}

function Cell({ bg, color, value }: { bg: string; color: string; value: string }) {
  return (
    <div style={{
      width: 38,
      height: 38,
      borderRadius: 8,
      background: bg,
      color,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 11,
      fontWeight: 700,
      fontFamily: 'monospace',
      margin: '0 auto',
    }}>
      {value}
    </div>
  )
}

function Banner({ tone, title, body }: { tone: 'error' | 'warn'; title: string; body: string }) {
  const palette = tone === 'error'
    ? { bg: '#FEF2F2', border: '#FECACA', color: '#B91C1C' }
    : { bg: '#FFFBEB', border: '#FDE68A', color: '#B45309' }
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 10,
      padding: '14px 16px', marginBottom: 24,
    }}>
      <AlertTriangle size={16} color={palette.color} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: palette.color }}>{title}</div>
        <div style={{ fontSize: 12, color: '#475569', marginTop: 2, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  )
}

function DagStep({
  index, icon, bg, border, tone, caption, badge,
}: {
  index: string
  icon: React.ReactNode
  bg: string
  border: string
  tone: string
  caption?: string
  badge?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', zIndex: 2, width: 140 }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%', background: bg,
        border: `2px solid ${border}`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: tone, marginBottom: 12,
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: tone, textTransform: 'uppercase' }}>
        {index}
      </div>
      {badge && (
        <div style={{
          background: bg, color: tone, padding: '2px 8px', borderRadius: 6,
          fontSize: 10, fontWeight: 700, marginTop: 4, whiteSpace: 'nowrap',
        }}>
          {badge}
        </div>
      )}
      {caption && (
        <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>{caption}</div>
      )}
    </div>
  )
}

function Connector({ tone, dashed }: { tone: string; dashed?: boolean }) {
  return (
    <div style={{
      flex: 1,
      borderTop: `${dashed ? '2px dashed' : '2px solid'} ${tone}`,
      margin: '0 8px',
      marginTop: -32,
    }} />
  )
}
