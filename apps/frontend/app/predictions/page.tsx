'use client'

import { useEffect, useState } from 'react'
import { Brain, ChevronDown, TrendingUp, AlertCircle } from 'lucide-react'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Types ─────────────────────────────────────────────────────────────────────

type ShapFactor = {
  feature: string
  label: string
  positive: boolean
  shap_value: number
}

type Prediction = {
  driver_number: number
  abbreviation: string
  team_name: string
  team_colour: string
  grid_position: number
  predicted_position: number
  win_probability: number
  podium_probability: number
  position_probabilities: Record<string, number>
  factors: ShapFactor[]
}

type PredictionResponse = {
  session_key: number
  gp_name: string
  year: number
  predictions: Prediction[]
}

type QualiSession = {
  session_key: number
  gp_name: string
  year: number
  date_start: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ProbBar({ value, colour, max }: { value: number; colour: string; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ flex: 1, height: '6px', background: '#1A1A1A', borderRadius: '3px', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: '#' + colour + 'AA', borderRadius: '3px', transition: 'width 0.5s ease' }} />
    </div>
  )
}

function PositionBadge({ pos }: { pos: number }) {
  const gold   = pos === 1
  const silver = pos === 2
  const bronze = pos === 3
  const bg     = gold ? '#FFD70022' : silver ? '#C0C0C022' : bronze ? '#CD7F3222' : '#1A1A1A'
  const col    = gold ? '#FFD700'   : silver ? '#C0C0C0'   : bronze ? '#CD7F32'   : '#52525B'
  return (
    <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: 700, color: col }}>P{pos}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PredictionsPage() {
  const [sessions,    setSessions]    = useState<QualiSession[]>([])
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [data,        setData]        = useState<PredictionResponse | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [expanded,    setExpanded]    = useState<number | null>(null)
  const [dropOpen,    setDropOpen]    = useState(false)

  // Load qualifying sessions for the selector
  useEffect(() => {
    fetch(`${BASE}/api/v1/sessions`)
      .then(r => r.json())
      .then((all: any[]) => {
        const quali = all
          .filter(s => s.session_type === 'Q' || s.session_type === 'SQ')
          .sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime())
          .map(s => ({ session_key: s.session_key, gp_name: s.gp_name, year: s.year, date_start: s.date_start }))
        setSessions(quali)
        if (quali.length) setSelectedKey(quali[0].session_key)
      })
      .catch(console.error)
  }, [])

  // Fetch predictions when session changes
  useEffect(() => {
    if (!selectedKey) return
    setLoading(true)
    setError(null)
    setData(null)
    fetch(`${BASE}/api/v1/sessions/${selectedKey}/predictions`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setData(d)
      })
      .catch(() => setError('Failed to load predictions'))
      .finally(() => setLoading(false))
  }, [selectedKey])

  const selected = sessions.find(s => s.session_key === selectedKey)
  const maxWin   = data ? Math.max(...data.predictions.map(p => p.win_probability)) : 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#E8002D18', border: '1px solid #E8002D33', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Brain size={16} style={{ color: '#E8002D' }} />
            </div>
            <h1 style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '26px', color: '#fff', margin: 0 }}>
              Race Predictions
            </h1>
          </div>
          <p style={{ color: '#52525B', fontSize: '12px', fontFamily: 'monospace', margin: 0 }}>
            FLAML AutoML · ExtraTree · trained on 26 race weekends · MAE 3.8 positions
          </p>
        </div>

        {/* Session selector */}
        {sessions.length > 0 && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setDropOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#111111', border: '1px solid #2A2A2A', color: '#fff', fontSize: '12px', padding: '8px 12px', borderRadius: '10px', cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
              {selected ? `${selected.gp_name.replace(' Grand Prix', '')} ${selected.year} Q` : 'Select session'}
              <ChevronDown size={12} style={{ transform: dropOpen ? 'rotate(180deg)' : 'none', transition: '0.15s' }} />
            </button>
            {dropOpen && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: '#161616', border: '1px solid #2A2A2A', borderRadius: '10px', overflow: 'hidden', zIndex: 100, minWidth: '220px', maxHeight: '320px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                {sessions.map(s => (
                  <button key={s.session_key} onClick={() => { setSelectedKey(s.session_key); setDropOpen(false) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: '12px', cursor: 'pointer', background: selectedKey === s.session_key ? '#1E1E1E' : 'transparent', color: selectedKey === s.session_key ? '#fff' : '#71717A', fontFamily: 'monospace', border: 'none', borderBottom: '1px solid #1A1A1A' }}>
                    {s.gp_name.replace(' Grand Prix', '')} {s.year}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model disclaimer */}
      <div style={{ display: 'flex', gap: '8px', padding: '10px 12px', background: '#FFD70011', border: '1px solid #FFD70022', borderRadius: '8px', alignItems: 'flex-start' }}>
        <AlertCircle size={13} style={{ color: '#FFD700', flexShrink: 0, marginTop: '1px' }} />
        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#71717A', lineHeight: 1.5 }}>
          Predictions are based on qualifying data only — no race strategy, weather, or reliability factors. Top-3 accuracy: 33% avg, 67% on 2026 data. Use as a starting point, not gospel.
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: '#3F3F46', fontFamily: 'monospace', fontSize: '13px' }}>
          Running model...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '16px', background: '#E8002D11', border: '1px solid #E8002D33', borderRadius: '10px', fontSize: '12px', fontFamily: 'monospace', color: '#E8002D' }}>
          {error}
        </div>
      )}

      {/* Predictions */}
      {!loading && data && (
        <>
          {/* GP header */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '20px', fontWeight: 700, color: '#fff' }}>
              {data.gp_name}
            </span>
            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#52525B' }}>{data.year} — {data.predictions.length} drivers</span>
          </div>

          {/* Podium highlight */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            {data.predictions.slice(0, 3).map((p, i) => {
              const colour  = '#' + p.team_colour
              const medals  = ['#FFD700', '#C0C0C0', '#CD7F32']
              const labels  = ['WINNER', '2ND PLACE', '3RD PLACE']
              return (
                <div key={p.driver_number} style={{ background: '#111111', border: `1px solid ${medals[i]}33`, borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
                  <div style={{ fontSize: '9px', fontFamily: 'monospace', color: medals[i], letterSpacing: '0.1em', marginBottom: '8px' }}>{labels[i]}</div>
                  <div style={{ width: '3px', height: '32px', borderRadius: '2px', background: colour, margin: '0 auto 8px' }} />
                  <div style={{ fontSize: '20px', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, color: colour }}>{p.abbreviation}</div>
                  <div style={{ fontSize: '10px', color: '#52525B', fontFamily: 'monospace', marginTop: '2px' }}>{p.team_name.split(' ')[0]}</div>
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ fontSize: '14px', fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>{(p.win_probability * 100).toFixed(0)}%</div>
                    <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#52525B' }}>win prob</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Full grid */}
          <div style={{ background: '#111111', border: '1px solid #2A2A2A', borderRadius: '12px', overflow: 'hidden' }}>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '32px 28px 1fr 100px 110px 110px', gap: '8px', padding: '8px 16px', fontSize: '9px', color: '#3F3F46', fontFamily: 'monospace', letterSpacing: '0.1em', borderBottom: '1px solid #1A1A1A' }}>
              <span>PRED</span><span>GRID</span><span>DRIVER</span><span>WIN %</span><span>PODIUM %</span><span>PROBABILITY</span>
            </div>

            {data.predictions.map((p, i) => {
              const colour   = '#' + p.team_colour
              const isExpand = expanded === p.driver_number
              const gridDiff = p.grid_position - (i + 1)  // positive = predicted better than grid

              return (
                <div key={p.driver_number}>
                  <div
                    onClick={() => setExpanded(isExpand ? null : p.driver_number)}
                    style={{ display: 'grid', gridTemplateColumns: '32px 28px 1fr 100px 110px 110px', gap: '8px', padding: '10px 16px', borderBottom: '1px solid #0F0F0F', alignItems: 'center', cursor: 'pointer', transition: 'background 0.1s', background: isExpand ? '#161616' : 'transparent' }}
                    onMouseEnter={e => { if (!isExpand) e.currentTarget.style.background = '#141414' }}
                    onMouseLeave={e => { if (!isExpand) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Predicted position */}
                    <PositionBadge pos={i + 1} />

                    {/* Grid position + delta */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#52525B' }}>P{p.grid_position}</div>
                      {gridDiff !== 0 && (
                        <div style={{ fontSize: '8px', fontFamily: 'monospace', color: gridDiff > 0 ? '#2CF4C5' : '#E8002D' }}>
                          {gridDiff > 0 ? `+${gridDiff}` : gridDiff}
                        </div>
                      )}
                    </div>

                    {/* Driver */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div style={{ width: '3px', height: '20px', borderRadius: '2px', background: colour, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 700, color: colour }}>{p.abbreviation}</div>
                        <div style={{ fontSize: '9px', color: '#52525B', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team_name}</div>
                      </div>
                    </div>

                    {/* Win % */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ProbBar value={p.win_probability} colour={p.team_colour} max={maxWin} />
                      <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#fff', width: '32px', textAlign: 'right', flexShrink: 0 }}>
                        {(p.win_probability * 100).toFixed(0)}%
                      </span>
                    </div>

                    {/* Podium % */}
                    <div style={{ fontSize: '12px', fontFamily: 'monospace', color: p.podium_probability > 0.5 ? '#2CF4C5' : '#71717A', textAlign: 'center' }}>
                      {(p.podium_probability * 100).toFixed(0)}%
                    </div>

                    {/* Mini position probability bars */}
                    <div style={{ display: 'flex', gap: '1px', alignItems: 'flex-end', height: '20px' }}>
                      {[1,2,3,4,5,6,7,8,9,10].map(pos => {
                        const prob = p.position_probabilities[String(pos)] ?? 0
                        const h    = Math.max(2, prob * 100)
                        return (
                          <div key={pos} style={{ flex: 1, height: `${h}%`, background: pos <= 3 ? colour + 'CC' : colour + '44', borderRadius: '1px', minHeight: '2px' }} />
                        )
                      })}
                    </div>
                  </div>

                  {/* Expanded SHAP factors */}
                  {isExpand && p.factors.length > 0 && (
                    <div style={{ padding: '10px 16px 14px', background: '#0D0D0D', borderBottom: '1px solid #0F0F0F' }}>
                      <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#3F3F46', letterSpacing: '0.1em', marginBottom: '8px' }}>
                        KEY FACTORS — SHAP explanation
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {p.factors.slice(0, 3).map((f, fi) => (
                          <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: f.positive ? '#2CF4C522' : '#E8002D22', border: `1px solid ${f.positive ? '#2CF4C544' : '#E8002D44'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <TrendingUp size={9} style={{ color: f.positive ? '#2CF4C5' : '#E8002D', transform: f.positive ? 'none' : 'scaleY(-1)' }} />
                            </div>
                            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: f.positive ? '#A1A1AA' : '#71717A' }}>
                              {f.label}
                            </span>
                            <span style={{ marginLeft: 'auto', fontSize: '10px', fontFamily: 'monospace', color: '#3F3F46' }}>
                              {f.shap_value > 0 ? '+' : ''}{f.shap_value.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Model info footer */}
          <div style={{ display: 'flex', gap: '16px', padding: '12px 16px', background: '#111111', border: '1px solid #2A2A2A', borderRadius: '10px', flexWrap: 'wrap' }}>
            {[
              { label: 'ALGORITHM',  value: 'ExtraTree (FLAML)' },
              { label: 'TRAINING',   value: '26 race weekends' },
              { label: 'CV METHOD',  value: 'Leave-one-year-out' },
              { label: 'MAE',        value: '3.8 ± 0.6 positions' },
              { label: 'TOP-3 ACC',  value: '33% avg · 67% on 2026' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: '8px', fontFamily: 'monospace', color: '#3F3F46', letterSpacing: '0.1em', marginBottom: '2px' }}>{label}</div>
                <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#A1A1AA' }}>{value}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}