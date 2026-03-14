'use client'

import { useEffect, useState } from 'react'
import { Brain, Database, GitBranch, Zap, Lock } from 'lucide-react'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function PredictionsPage() {
  const [raceCount, setRaceCount] = useState<number | null>(null)

  useEffect(() => {
    fetch(`${BASE}/api/v1/sessions`)
      .then(r => r.json())
      .then((sessions: any[]) => {
        const races = sessions.filter(s => s.session_type === 'R').length
        setRaceCount(races)
      })
      .catch(() => setRaceCount(null))
  }, [])

  const NEEDED = 30

  const steps = [
    {
      Icon: Database,
      label: 'Historical data',
      desc: `Qualifying + race pairs across 2022–2026. Currently have ${raceCount ?? '…'} races ingested. Need ~${NEEDED}+ for a meaningful model.`,
      status: raceCount !== null && raceCount >= NEEDED ? 'done' : 'progress',
      metric: raceCount !== null ? `${raceCount} races` : '…',
    },
    {
      Icon: GitBranch,
      label: 'Feature engineering',
      desc: 'Grid position, gap to pole, sector time ranks, circuit type, team form over last 3 races, tyre strategy from FP2.',
      status: 'planned',
      metric: '~20 features',
    },
    {
      Icon: Brain,
      label: 'FLAML AutoML',
      desc: 'Tries XGBoost, LightGBM, ExtraTree, RandomForest. Leave-one-year-out cross-validation — never trains on future data.',
      status: 'planned',
      metric: 'Target: top-3 >55%',
    },
    {
      Icon: Zap,
      label: 'Predictions + SHAP',
      desc: 'Monte Carlo simulation (1000 runs) → probability distributions. SHAP explains the top 3 factors per driver.',
      status: 'planned',
      metric: 'Per-driver win %',
    },
  ]

  const S: Record<string, { bg: string; border: string; text: string; label: string }> = {
    done:     { bg: '#2CF4C522', border: '#2CF4C544', text: '#2CF4C5', label: 'DONE' },
    progress: { bg: '#FFD70022', border: '#FFD70044', text: '#FFD700', label: 'IN PROGRESS' },
    planned:  { bg: '#52525B22', border: '#52525B44', text: '#71717A', label: 'PLANNED' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '680px' }}>

      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#E8002D18', border: '1px solid #E8002D33', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Brain size={18} style={{ color: '#E8002D' }} />
          </div>
          <h1 style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '28px', color: '#fff', margin: 0 }}>
            Race Predictions
          </h1>
          <span style={{ fontSize: '9px', fontFamily: 'monospace', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', background: '#FFD70022', color: '#FFD700', border: '1px solid #FFD70044' }}>
            COMING SOON
          </span>
        </div>
        <p style={{ color: '#71717A', fontSize: '14px', lineHeight: 1.6, margin: 0 }}>
          ML-powered podium predictions from qualifying results. Built on FastF1 data across 4 seasons — no black box, full SHAP explanations for every prediction.
        </p>
      </div>

      {/* Progress */}
      <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.1em' }}>BUILD PROGRESS</span>
          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: raceCount !== null && raceCount >= NEEDED ? '#2CF4C5' : '#FFD700' }}>
            {raceCount ?? '…'}/{NEEDED} races
          </span>
        </div>
        <div style={{ height: '4px', background: '#1A1A1A', borderRadius: '2px', overflow: 'hidden', marginBottom: '20px' }}>
          <div style={{ height: '100%', borderRadius: '2px', background: 'linear-gradient(to right, #E8002D, #FFD700)', width: raceCount != null ? `${Math.min(100, (raceCount / NEEDED) * 100)}%` : '0%', transition: 'width 0.6s ease' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {steps.map((step, i) => {
            const s = S[step.status]
            return (
              <div key={i} style={{ display: 'flex', gap: '12px', padding: '12px', background: '#0D0D0D', borderRadius: '10px', border: '1px solid #1A1A1A', opacity: step.status === 'planned' ? 0.7 : 1 }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: s.bg, border: `1px solid ${s.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <step.Icon size={15} style={{ color: s.text }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{step.label}</span>
                    <span style={{ fontSize: '8px', fontFamily: 'monospace', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>{s.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46' }}>{step.metric}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: '#71717A', margin: 0, lineHeight: 1.5 }}>{step.desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Preview */}
      <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '16px', padding: '20px' }}>
        <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#52525B', letterSpacing: '0.1em', marginBottom: '16px' }}>
          PREVIEW — EXAMPLE OUTPUT
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
          {[
            { pos: 1, abbr: 'ANT', team: 'Mercedes', prob: 34, colour: '27F4D2', factors: ['Grid P1', 'Low tyre deg', 'Strong S3'] },
            { pos: 2, abbr: 'RUS', team: 'Mercedes', prob: 28, colour: '27F4D2', factors: ['Grid P2', 'Strong exit pace'] },
            { pos: 3, abbr: 'LEC', team: 'Ferrari',  prob: 18, colour: 'E8002D', factors: ['Grid P3', 'HARD pace in FP2'] },
          ].map(d => (
            <div key={d.abbr} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#0A0A0A', borderRadius: '8px', border: '1px solid #1A1A1A', opacity: 0.65 }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: `#${d.colour}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontFamily: 'monospace', color: `#${d.colour}`, fontWeight: 700, flexShrink: 0 }}>
                P{d.pos}
              </div>
              <div style={{ width: '3px', height: '28px', borderRadius: '2px', background: `#${d.colour}`, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: `#${d.colour}`, fontWeight: 700 }}>{d.abbr}</span>
                  <span style={{ fontSize: '11px', color: '#52525B' }}>{d.team}</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>
                  {d.factors.map(f => (
                    <span key={f} style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', background: '#1A1A1A', padding: '1px 5px', borderRadius: '3px' }}>{f}</span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '18px', fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>{d.prob}%</div>
                <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>win prob</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', background: '#1A1A1A', borderRadius: '6px' }}>
          <Lock size={11} style={{ color: '#52525B' }} />
          <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#52525B' }}>
            Example only — not real predictions. Ingest 30+ race weekends to unlock the model.
          </span>
        </div>
      </div>

      {/* CLI hint */}
      <div style={{ background: '#0D0D0D', border: '1px solid #E8002D33', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', color: '#fff', fontWeight: 600, marginBottom: '4px' }}>Accelerate training data</div>
          <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#52525B', lineHeight: 1.5 }}>
            Ingest 2022–2025 race data overnight. Each GP takes ~60 seconds.
          </div>
        </div>
        <div style={{ background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: '8px', padding: '10px 14px', fontFamily: 'monospace', fontSize: '11px', color: '#A1A1AA', whiteSpace: 'nowrap', flexShrink: 0 }}>
          uv run python -m ingestion.ingest_session
        </div>
      </div>

    </div>
  )
}