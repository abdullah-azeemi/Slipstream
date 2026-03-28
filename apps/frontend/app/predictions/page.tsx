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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '920px', margin: '0 auto' }}>

      {/* Header */}
      <section className="panel fade-up" style={{ padding: '22px 22px 18px', position: 'relative', zIndex: 5, overflow: 'visible' }}>
        <div className="predictions-page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: '10px' }}>Prediction Lab</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#E8002D18', border: '1px solid #E8002D33', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Brain size={16} style={{ color: '#E8002D' }} />
            </div>
            <h1 className="page-title" style={{ fontSize: 'clamp(2rem, 4vw, 2.8rem)', margin: 0 }}>
              Race Predictions
            </h1>
            </div>
            <p className="page-subtitle" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', margin: 0 }}>
              FLAML AutoML · ExtraTree · trained on 26 race weekends · MAE 3.8 positions
            </p>
          </div>

          {/* Session selector */}
          {sessions.length > 0 && (
            <div style={{ position: 'relative', flexShrink: 0, zIndex: 20 }}>
              <button onClick={() => setDropOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(152, 181, 211, 0.14)', color: '#fff', fontSize: '12px', padding: '10px 14px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap', position: 'relative', zIndex: 21 }}>
                {selected ? `${selected.gp_name.replace(' Grand Prix', '')} ${selected.year} Q` : 'Select session'}
                <ChevronDown size={12} style={{ transform: dropOpen ? 'rotate(180deg)' : 'none', transition: '0.15s' }} />
              </button>
              {dropOpen && (
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', background: 'rgba(10,20,31,0.98)', border: '1px solid rgba(152, 181, 211, 0.14)', borderRadius: '16px', overflow: 'hidden', zIndex: 999, minWidth: '220px', maxHeight: '320px', overflowY: 'auto', boxShadow: '0 18px 44px rgba(0,0,0,0.58)' }}>
                  {sessions.map(s => (
                    <button key={s.session_key} onClick={() => { setSelectedKey(s.session_key); setDropOpen(false) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: '12px', cursor: 'pointer', background: selectedKey === s.session_key ? 'rgba(255,255,255,0.06)' : 'transparent', color: selectedKey === s.session_key ? '#fff' : '#9fb2c6', fontFamily: 'monospace', border: 'none', borderBottom: '1px solid rgba(152,181,211,0.08)' }}>
                      {s.gp_name.replace(' Grand Prix', '')} {s.year}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="telemetry-chip-row" style={{ marginTop: '14px' }}>
          <div className="panel-soft" style={{ padding: '10px 12px', borderRadius: '16px', minWidth: '150px' }}>
            <div className="eyebrow" style={{ marginBottom: '6px' }}>Model</div>
            <div style={{ fontSize: '18px', color: '#fff', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>ExtraTree</div>
          </div>
          <div className="panel-soft" style={{ padding: '10px 12px', borderRadius: '16px', minWidth: '150px' }}>
            <div className="eyebrow" style={{ marginBottom: '6px' }}>Coverage</div>
            <div style={{ fontSize: '18px', color: '#fff', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>26 weekends</div>
          </div>
          <div className="panel-soft" style={{ padding: '10px 12px', borderRadius: '16px', minWidth: '150px' }}>
            <div className="eyebrow" style={{ marginBottom: '6px' }}>MAE</div>
            <div style={{ fontSize: '18px', color: '#f2c879', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }}>3.8 pos</div>
          </div>
        </div>
      </section>

      {/* Model disclaimer */}
      <div className="panel-soft fade-up-delay-1" style={{ display: 'flex', gap: '8px', padding: '12px 14px', alignItems: 'flex-start', background: 'rgba(242, 200, 121, 0.08)', borderColor: 'rgba(242, 200, 121, 0.16)' }}>
        <AlertCircle size={13} style={{ color: '#FFD700', flexShrink: 0, marginTop: '1px' }} />
        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#71717A', lineHeight: 1.5 }}>
          Predictions are based on qualifying data only — no race strategy, weather, or reliability factors. Top-3 accuracy: 33% avg, 67% on 2026 data. Use as a starting point, not gospel.
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="panel-soft" style={{ textAlign: 'center', padding: '48px', color: '#5e7289', fontFamily: 'monospace', fontSize: '13px' }}>
          Running model...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="panel-soft" style={{ padding: '16px', background: '#E8002D11', borderColor: '#E8002D33', fontSize: '12px', fontFamily: 'monospace', color: '#E8002D' }}>
          {error}
        </div>
      )}

      {/* Predictions */}
      {!loading && data && (
        <>
          {/* GP header */}
          <div className="fade-up-delay-1" style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '20px', fontWeight: 700, color: '#fff' }}>
              {data.gp_name}
            </span>
            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#5e7289' }}>{data.year} — {data.predictions.length} drivers</span>
          </div>

          {/* Podium highlight */}
          <div className="podium-grid fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            {data.predictions.slice(0, 3).map((p, i) => {
              const colour  = '#' + p.team_colour
              const medals  = ['#FFD700', '#C0C0C0', '#CD7F32']
              const labels  = ['WINNER', '2ND PLACE', '3RD PLACE']
              return (
                <div key={p.driver_number} className="podium-card panel-soft interactive-card" style={{ border: `1px solid ${medals[i]}33`, borderRadius: '18px', padding: '16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '9px', fontFamily: 'monospace', color: medals[i], letterSpacing: '0.1em', marginBottom: '8px' }}>{labels[i]}</div>
                  <div style={{ width: '3px', height: '32px', borderRadius: '2px', background: colour, margin: '0 auto 8px' }} />
                  <div style={{ fontSize: '20px', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, color: colour }}>{p.abbreviation}</div>
                    <div style={{ fontSize: '10px', color: '#5e7289', fontFamily: 'monospace', marginTop: '2px' }}>{p.team_name.split(' ')[0]}</div>
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ fontSize: '14px', fontFamily: 'monospace', fontWeight: 700, color: '#fff' }}>{(p.win_probability * 100).toFixed(0)}%</div>
                    <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#5e7289' }}>win prob</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Full grid */}
          <div className="panel-soft fade-up-delay-2" style={{ borderRadius: '20px', overflow: 'hidden' }}>
            {/* Column headers */}
            <div className="predictions-header" style={{ display: 'grid', gridTemplateColumns: '32px 28px 1fr 100px 110px 110px', gap: '8px', padding: '8px 16px', fontSize: '9px', color: '#5e7289', fontFamily: 'monospace', letterSpacing: '0.1em', borderBottom: '1px solid rgba(152,181,211,0.08)' }}>
              <span>PRED</span><span>GRID</span><span>DRIVER</span><span className="predictions-hide-mobile">WIN %</span><span className="predictions-hide-mobile">PODIUM %</span><span className="predictions-hide-mobile">PROBABILITY</span>
            </div>

            {data.predictions.map((p, i) => {
              const colour   = '#' + p.team_colour
              const isExpand = expanded === p.driver_number
              const gridDiff = p.grid_position - (i + 1)  // positive = predicted better than grid

              return (
                <div key={p.driver_number}>
                  <div
                    onClick={() => setExpanded(isExpand ? null : p.driver_number)}
                    className="predictions-row"
                    style={{ display: 'grid', gridTemplateColumns: '32px 28px 1fr 100px 110px 110px', gap: '8px', padding: '10px 16px', borderBottom: '1px solid rgba(152,181,211,0.06)', alignItems: 'center', cursor: 'pointer', transition: 'background 0.1s', background: isExpand ? 'rgba(255,255,255,0.04)' : 'transparent' }}
                    onMouseEnter={e => { if (!isExpand) e.currentTarget.style.background = 'rgba(255,255,255,0.025)' }}
                    onMouseLeave={e => { if (!isExpand) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Predicted position */}
                    <PositionBadge pos={i + 1} />

                    {/* Grid position + delta */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#5e7289' }}>P{p.grid_position}</div>
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
                        <div style={{ fontSize: '9px', color: '#5e7289', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team_name}</div>
                      </div>
                    </div>

                    {/* Win % */}
                    <div className="predictions-hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ProbBar value={p.win_probability} colour={p.team_colour} max={maxWin} />
                      <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#fff', width: '32px', textAlign: 'right', flexShrink: 0 }}>
                        {(p.win_probability * 100).toFixed(0)}%
                      </span>
                    </div>

                    {/* Podium % */}
                    <div className="predictions-hide-mobile" style={{ fontSize: '12px', fontFamily: 'monospace', color: p.podium_probability > 0.5 ? '#2CF4C5' : '#71717A', textAlign: 'center' }}>
                      {(p.podium_probability * 100).toFixed(0)}%
                    </div>

                    {/* Mini position probability bars */}
                    <div className="predictions-hide-mobile" style={{ display: 'flex', gap: '1px', alignItems: 'flex-end', height: '20px' }}>
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
                    <div style={{ padding: '10px 16px 14px', background: 'rgba(5,12,20,0.65)', borderBottom: '1px solid rgba(152,181,211,0.06)' }}>
                      <div style={{ fontSize: '9px', fontFamily: 'monospace', color: '#5e7289', letterSpacing: '0.1em', marginBottom: '8px' }}>
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
          <div className="panel-soft fade-up-delay-2" style={{ display: 'flex', gap: '16px', padding: '14px 16px', borderRadius: '18px', flexWrap: 'wrap' }}>
            {[
              { label: 'ALGORITHM',  value: 'ExtraTree (FLAML)' },
              { label: 'TRAINING',   value: '26 race weekends' },
              { label: 'CV METHOD',  value: 'Leave-one-year-out' },
              { label: 'MAE',        value: '3.8 ± 0.6 positions' },
              { label: 'TOP-3 ACC',  value: '33% avg · 67% on 2026' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: '8px', fontFamily: 'monospace', color: '#5e7289', letterSpacing: '0.1em', marginBottom: '2px' }}>{label}</div>
                <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#d8e4ee' }}>{value}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
