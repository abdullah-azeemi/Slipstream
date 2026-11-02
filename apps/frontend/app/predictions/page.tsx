'use client'

import { useEffect, useMemo, useState } from 'react'
import { Cube, Pulse, CheckCircle, ClockCounterClockwise, Database } from '@phosphor-icons/react'
import '@/components/landing/landing.css'
import { geist } from '@/components/landing/font'
import { ToggleGroup } from '@/components/landing/Tabs'
import { authHeaders } from '@/lib/auth-token'
import {
  GridShift,
  HeatGrid,
  PositionDistribution,
  ShapBars,
  ValidationBars,
  pct,
  teamHex,
  type HeatRow,
} from '@/components/predictions/viz'
import type { DriverPrediction, FeatureStream, PredictionResponse, Session } from '@/types/f1'

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

type SortKey = 'pred' | 'win' | 'gain'

function statusFor(d: DriverPrediction): string {
  const delta = d.grid_position - d.predicted_position
  if (d.predicted_position === 1) return 'Race favourite'
  if (d.podium_probability >= 0.5) return 'Podium likely'
  if (delta >= 3) return 'Moving up'
  if (delta <= -3) return 'At risk'
  return 'Midfield'
}

function Panel({ title, subtitle, children, id }: { title: string; subtitle?: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="panel" aria-labelledby={id} style={{ marginTop: 'var(--sp-200)' }}>
      <h2 id={id} className="heading-5">{title}</h2>
      {subtitle ? <p className="body-6 muted" style={{ marginTop: 'var(--sp-50)', marginBottom: 'var(--sp-300)', maxWidth: 680 }}>{subtitle}</p> : <div style={{ height: 'var(--sp-300)' }} />}
      {children}
    </section>
  )
}

export default function PredictionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [year, setYear] = useState<number | null>(null)
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [data, setData] = useState<PredictionResponse | null>(null)
  const [driverNames, setDriverNames] = useState<Record<number, string>>({})
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelUnavailable, setModelUnavailable] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('pred')
  const [focus, setFocus] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${BASE}/api/v1/sessions`, { headers: authHeaders() })
      .then(r => r.json())
      .then((rows: Session[] | { error?: string }) => {
        if (cancelled) return
        const quali = (Array.isArray(rows) ? rows : [])
          .filter(s => s.session_type === 'Q' || s.session_type === 'SQ')
          .sort((a, b) => new Date(b.date_start ?? 0).getTime() - new Date(a.date_start ?? 0).getTime())
        setSessions(quali)
        if (quali.length) {
          setSelectedKey(quali[0].session_key)
          setYear(quali[0].year)
        }
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Sessions could not be loaded') })
      .finally(() => { if (!cancelled) setLoadingSessions(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (selectedKey == null) return
    let cancelled = false
    setPredicting(true)
    setError(null)
    setModelUnavailable(null)
    setData(null)
    setFocus(null)
    fetch(`${BASE}/api/v1/sessions/${selectedKey}/predictions`, { headers: authHeaders() })
      .then(async r => {
        const body = await r.json().catch(() => null)
        if (cancelled) return
        if (!r.ok) {
          if (r.status === 503) {
            setModelUnavailable(body?.detail ?? 'No trained model is available for this weekend yet.')
            return
          }
          setError(body?.error ?? `The prediction request failed (${r.status}).`)
          return
        }
        setData(body as PredictionResponse)
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'The prediction request failed.') })
      .finally(() => { if (!cancelled) setPredicting(false) })
    return () => { cancelled = true }
  }, [selectedKey])

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
    return () => { cancelled = true }
  }, [selectedKey])

  const years = useMemo(() => Array.from(new Set(sessions.map(s => s.year))).sort((a, b) => b - a), [sessions])
  const yearSessions = useMemo(() => sessions.filter(s => s.year === year), [sessions, year])
  const selectedSession = useMemo(() => sessions.find(s => s.session_key === selectedKey) ?? null, [sessions, selectedKey])

  const predictions = useMemo(() => data?.predictions ?? [], [data])
  const nPos = useMemo(() => {
    const keys = predictions.flatMap(p => Object.keys(p.position_probabilities ?? {}).map(Number)).filter(Number.isFinite)
    return Math.max(predictions.length, ...keys, 1)
  }, [predictions])
  const nameOf = (d: DriverPrediction) => driverNames[d.driver_number] ?? d.abbreviation

  const byPredicted = useMemo(() => [...predictions].sort((a, b) => a.predicted_position - b.predicted_position), [predictions])
  const podium = useMemo(() => [...predictions].sort((a, b) => b.podium_probability - a.podium_probability).slice(0, 3), [predictions])
  const focusDriver = useMemo(
    () => predictions.find(p => p.driver_number === focus) ?? byPredicted[0] ?? null,
    [predictions, focus, byPredicted],
  )

  const posRows: HeatRow[] = useMemo(
    () => byPredicted.map(d => ({
      id: d.driver_number,
      label: d.abbreviation,
      colour: teamHex(d.team_colour),
      outline: d.grid_position - 1,
      note: `predicted P${d.predicted_position}, grid P${d.grid_position}`,
      values: Array.from({ length: nPos }, (_, i) => d.position_probabilities?.[String(i + 1)] ?? 0),
    })),
    [byPredicted, nPos],
  )
  const posMax = useMemo(() => Math.max(0.01, ...posRows.flatMap(r => r.values.map(v => v ?? 0))), [posRows])

  const stream = useMemo(() => {
    const totals: Record<string, number> = {}
    const labels: Record<string, string> = {}
    for (const p of predictions) for (const s of p.feature_streams ?? []) {
      totals[s.stream] = (totals[s.stream] ?? 0) + s.share
      labels[s.stream] = s.label
    }
    const cols = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => ({ key: k, label: labels[k] ?? k.replace(/_/g, ' ') }))
    const rows: HeatRow[] = byPredicted.slice(0, 10).map(d => {
      const m: Record<string, FeatureStream> = {}
      for (const s of d.feature_streams ?? []) m[s.stream] = s
      return {
        id: d.driver_number,
        label: d.abbreviation,
        colour: teamHex(d.team_colour),
        values: [...cols.map(c => (m[c.key] ? m[c.key].share : null)), d.win_probability],
      }
    })
    const max = Math.max(0.01, ...rows.flatMap(r => r.values.map(v => v ?? 0)))
    return { cols: [...cols.map(c => c.label), 'Win probability'], rows, max }
  }, [predictions, byPredicted])

  const sortedGrid = useMemo(() => {
    const l = [...predictions]
    if (sortBy === 'win') return l.sort((a, b) => b.win_probability - a.win_probability)
    if (sortBy === 'gain') return l.sort((a, b) => (b.grid_position - b.predicted_position) - (a.grid_position - a.predicted_position))
    return l.sort((a, b) => a.predicted_position - b.predicted_position)
  }, [predictions, sortBy])

  const model = data?.model
  const modelTop3 = model?.cv_top3_accuracy_mean ?? data?.model_baselines?.model_top3_accuracy ?? null
  const gridTop3 = model?.grid_baseline_top3_accuracy_mean ?? data?.model_baselines?.grid_top3_accuracy ?? null
  const lift = modelTop3 != null && gridTop3 != null ? (modelTop3 - gridTop3) * 100 : null
  const gp = data?.gp_name ?? selectedSession?.gp_name ?? 'this weekend'
  const gpYear = data?.year ?? selectedSession?.year ?? ''
  const inputs = Object.values(data?.weekend_inputs_used ?? {}).filter(w => w.available).map(w => w.session_type)

  return (
    <div className={`lp ${geist.className}`}>
      <div id="main" className="dash">
        <div className="wrap">
          <header className="dash-head" style={{ maxWidth: 720 }}>
            <p className="caption-1 muted">Predictions</p>
            <h1 className="heading-3">Race predictions</h1>
            <p className="body-3 muted" style={{ marginTop: 'var(--sp-100)' }}>
              A qualifying led forecast of the finishing order. Every chart shows the model&apos;s uncertainty, not just
              its pick{model?.best_estimator ? `, from a ${model.best_estimator} model` : ''}.
            </p>
          </header>

          {/* Picker */}
          <div className="tel-filters">
            <ToggleGroup
              label="Season"
              value={year}
              onChange={y => { setYear(y); const first = sessions.find(x => x.year === y); if (first) setSelectedKey(first.session_key) }}
              items={years.map(y => ({ key: y, label: String(y) }))}
            />
            <label className="search" style={{ marginLeft: 0 }}>
              <span className="sr-only">Qualifying session</span>
              <select
                value={selectedKey ?? ''}
                onChange={e => setSelectedKey(Number(e.target.value))}
                disabled={!yearSessions.length}
                className="body-5"
                style={{ border: 0, outline: 0, background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer', maxWidth: 320 }}
              >
                {!yearSessions.length && <option value="">No qualifying sessions</option>}
                {yearSessions.map(s => (
                  <option key={s.session_key} value={s.session_key}>
                    {s.gp_name} ({s.session_type === 'SQ' ? 'Sprint qualifying' : 'Qualifying'})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loadingSessions && <div className="stats-grid" aria-busy="true"><span className="skeleton" style={{ height: 120 }} /><span className="skeleton" style={{ height: 120 }} /><span className="skeleton" style={{ height: 120 }} /></div>}

          {error && <div className="inline-error" role="alert"><span className="body-6 muted">{error}</span></div>}
          {modelUnavailable && (
            <div className="empty" role="status">
              <h2 className="heading-6">No trained model for this weekend yet</h2>
              <p className="body-6">{modelUnavailable}</p>
            </div>
          )}
          {!loadingSessions && !sessions.length && !error && (
            <div className="empty"><h2 className="heading-6">No qualifying data yet</h2><p className="body-6">Qualifying sessions appear here once they are ingested.</p></div>
          )}

          {predicting && !data && (
            <div role="status" aria-busy="true">
              <div className="pred-podium">{[0, 1, 2].map(i => <span key={i} className="skeleton" style={{ height: 160, borderRadius: 16 }} />)}</div>
              <span className="skeleton" style={{ height: 420, marginTop: 16, borderRadius: 24 }} />
            </div>
          )}

          {data && (
            <div style={{ opacity: predicting ? 0.5 : 1, transition: 'opacity 300ms var(--ease)' }}>
              <p className="body-5 muted" style={{ marginBottom: 'var(--sp-200)' }}>
                {gpYear} {gp}{inputs.length ? `. Inputs used: ${Array.from(new Set(inputs)).join(', ')}.` : '. Waiting for session data.'}
              </p>

              {/* Podium forecast */}
              <div className="pred-podium">
                {podium.map((d, i) => {
                  const f = (d.factors ?? [])[0]
                  return (
                    <article key={d.driver_number} className="card">
                      <div className="caption-4 muted">{['Most likely podium finisher', 'Second most likely', 'Third most likely'][i]}</div>
                      <h3 className="heading-5" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-100)' }}>
                        <span style={{ width: 4, height: 24, borderRadius: 2, background: teamHex(d.team_colour) }} aria-hidden="true" />
                        {nameOf(d)}
                      </h3>
                      <div className="body-6 muted">{d.team_name ?? '—'}, grid P{d.grid_position}</div>
                      <div style={{ display: 'flex', gap: 'var(--sp-400)', marginTop: 'var(--sp-100)' }}>
                        <div className="metric"><div className="v">{pct(d.podium_probability, 0)}</div><div className="l">Podium</div></div>
                        <div className="metric"><div className="v">{pct(d.win_probability, 0)}</div><div className="l">Win</div></div>
                        <div className="metric"><div className="v">P{d.predicted_position}</div><div className="l">Predicted</div></div>
                      </div>
                      {f && <p className="body-6" style={{ marginTop: 'var(--sp-100)' }}>Biggest factor: <strong>{f.label}</strong></p>}
                    </article>
                  )
                })}
              </div>

              <Panel
                id="dist-title"
                title="Finishing position probabilities"
                subtitle="Each row is a driver and each column a finishing position. Darker cells are more likely. The outlined cell is where the driver starts. Select a driver to inspect them below."
              >
                <HeatGrid
                  rows={posRows}
                  cols={Array.from({ length: nPos }, (_, i) => `P${i + 1}`)}
                  max={posMax}
                  fmt={v => `${Math.round(v * 100)}`}
                  labelFrom={0.1}
                  selected={focusDriver?.driver_number ?? null}
                  onSelect={setFocus}
                  ariaLabel="Heat map of each driver's probability of finishing in each position"
                  describe={(r, col, v) => ({ title: r.label, lines: [{ label: `Finishes ${col}`, value: pct(v) }] })}
                />
                <div className="viz-legend">
                  <span><svg width="64" height="12"><defs><linearGradient id="seq" x1="0" x2="1"><stop offset="0" stopColor="#cde2fb" /><stop offset="0.5" stopColor="#3987e5" /><stop offset="1" stopColor="#0d366b" /></linearGradient></defs><rect width="64" height="12" rx="3" fill="url(#seq)" /></svg>Low to high probability. Numbers are percentages above 10.</span>
                  <span><svg width="14" height="14"><rect x="1" y="1" width="12" height="12" rx="3" fill="#fff" stroke="#0b0b0b" strokeWidth="2" /></svg>Grid position</span>
                </div>
              </Panel>

              {focusDriver && (
                <Panel
                  id="inspect-title"
                  title={`Driver inspector: ${nameOf(focusDriver)}`}
                  subtitle={`Started P${focusDriver.grid_position}, predicted P${focusDriver.predicted_position}. Win ${pct(focusDriver.win_probability)}, podium ${pct(focusDriver.podium_probability)}.`}
                >
                  <div className="pred-grid">
                    <div>
                      <h3 className="title-3" style={{ marginBottom: 'var(--sp-100)' }}>Where they could finish</h3>
                      <PositionDistribution d={focusDriver} nPos={nPos} />
                    </div>
                    <div>
                      <h3 className="title-3" style={{ marginBottom: 'var(--sp-100)' }}>What pushes the prediction</h3>
                      <ShapBars factors={focusDriver.factors ?? []} />
                      <p className="caption-4 muted" style={{ marginTop: 'var(--sp-75)' }}>Bar length is the SHAP contribution of each feature to this driver&apos;s predicted finish.</p>
                    </div>
                  </div>
                </Panel>
              )}

              <Panel
                id="shift-title"
                title="Grid position against predicted finish"
                subtitle="Where the model expects each driver to gain or lose places compared with the starting grid."
              >
                <GridShift rows={predictions} nPos={nPos} />
              </Panel>

              {stream.cols.length > 1 && (
                <Panel
                  id="stream-title"
                  title="Which feature streams drive each prediction"
                  subtitle="Share of the model's attribution that comes from each group of features, for the ten drivers predicted to finish highest. The last column is the win probability."
                >
                  <HeatGrid
                    rows={stream.rows}
                    cols={stream.cols}
                    max={stream.max}
                    fmt={v => v.toFixed(2).replace(/^0/, '')}
                    labelFrom={0}
                    ariaLabel="Heat map of feature stream attribution per driver"
                    describe={(r, col, v) => ({ title: r.label, lines: [{ label: col, value: v == null ? 'No data' : v.toFixed(3) }] })}
                  />
                </Panel>
              )}

              <Panel
                id="valid-title"
                title="How much to trust it"
                subtitle={data.validation_report?.caveat || 'Scores are from cross validation on earlier weekends, so they estimate performance on races the model has not seen.'}
              >
                <div className="pred-grid">
                  <div>
                    <h3 className="title-3" style={{ marginBottom: 'var(--sp-100)' }}>Top three accuracy</h3>
                    <ValidationBars model={modelTop3} baseline={gridTop3} />
                    {lift != null && (
                      <p className="body-5" style={{ marginTop: 'var(--sp-100)' }}>
                        {lift >= 0 ? `The model beats the grid order by ${lift.toFixed(1)} percentage points.` : `The model trails the grid order by ${Math.abs(lift).toFixed(1)} percentage points.`}
                      </p>
                    )}
                  </div>
                  <div className="metric-grid" style={{ marginTop: 0 }}>
                    {[
                      ['MAE, finishing position', model?.cv_mae_mean != null ? `${model.cv_mae_mean.toFixed(2)}${model.cv_mae_std != null ? ` ± ${model.cv_mae_std.toFixed(2)}` : ''}` : '—'],
                      ['Podium Brier score', model?.cv_podium_brier_mean != null ? model.cv_podium_brier_mean.toFixed(3) : '—'],
                      ['Podium precision', pct(model?.cv_podium_precision_mean ?? null)],
                      ['Podium recall', pct(model?.cv_podium_recall_mean ?? null)],
                      ['Cross validation folds', model?.cv_folds != null ? String(model.cv_folds) : '—'],
                      ['Training rows', model?.n_training_rows != null ? model.n_training_rows.toLocaleString() : '—'],
                      ['Seasons', model?.years?.length ? model.years.join(', ') : '—'],
                      ['Scope', model?.scope ?? '—'],
                    ].map(([l, v]) => (
                      <div key={l} className="metric"><div className="v">{v}</div><div className="l">{l}</div></div>
                    ))}
                  </div>
                </div>
              </Panel>

              <Panel id="pipe-title" title="How the forecast is made" subtitle="The path from historical data to the numbers above.">
                <ol className="steps" style={{ listStyle: 'none', padding: 0 }}>
                  {[
                    { icon: Database, t: 'History', d: model?.n_training_rows != null ? `${model.n_training_rows.toLocaleString()} training rows` : 'No model loaded' },
                    { icon: ClockCounterClockwise, t: 'This weekend', d: inputs.length ? Array.from(new Set(inputs)).join(' and ') : 'Waiting for session data' },
                    { icon: CheckCircle, t: 'Validation gate', d: data.validation_report?.available ? 'Leakage checks passed' : 'Validation pending' },
                    { icon: Cube, t: 'Simulation', d: model?.cv_folds != null ? `${model.cv_folds} fold cross validation` : 'Monte Carlo sampling' },
                    { icon: Pulse, t: 'Attribution', d: 'SHAP values per driver' },
                  ].map((s, i) => {
                    const Icon = s.icon
                    return (
                      <li key={s.t} className="card">
                        <span className="card-icon"><Icon size={20} aria-hidden="true" /></span>
                        <h3 className="title-3">{i + 1}. {s.t}</h3>
                        <p className="body-6">{s.d}</p>
                      </li>
                    )
                  })}
                </ol>
              </Panel>

              <Panel id="table-title" title="Full grid" subtitle="The same forecast as a table. Sort by predicted position, win chance or places gained.">
                <div style={{ marginBottom: 'var(--sp-200)' }}>
                  <ToggleGroup
                    label="Sort order"
                    value={sortBy}
                    onChange={setSortBy}
                    items={[{ key: 'pred' as SortKey, label: 'Predicted' }, { key: 'win' as SortKey, label: 'Win chance' }, { key: 'gain' as SortKey, label: 'Places gained' }]}
                  />
                </div>
                <div className="viz-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Predicted</th><th>Grid</th><th>Driver</th><th>Podium</th><th>Win</th><th>Outlook</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGrid.map(d => {
                        const delta = d.grid_position - d.predicted_position
                        return (
                          <tr key={d.driver_number}>
                            <td><strong>P{d.predicted_position}</strong></td>
                            <td>P{d.grid_position} <span className="muted" style={{ color: delta > 0 ? '#2a78d6' : delta < 0 ? '#e34948' : undefined }}>{delta > 0 ? `+${delta}` : delta < 0 ? delta : '0'}</span></td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ width: 4, height: 16, borderRadius: 2, background: teamHex(d.team_colour) }} aria-hidden="true" />
                                <span>{nameOf(d)} <span className="muted">{d.team_name ?? ''}</span></span>
                              </span>
                            </td>
                            <td><div className="bar-cell"><div className="track"><div className="fill" style={{ width: `${Math.min(100, d.podium_probability * 100)}%` }} /></div><span style={{ minWidth: 44 }}>{pct(d.podium_probability, 1)}</span></div></td>
                            <td>{pct(d.win_probability, 1)}</td>
                            <td className="muted">{statusFor(d)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
