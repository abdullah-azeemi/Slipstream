'use client'
import { useEffect, useState } from 'react'
import { predictionsApi } from '@/lib/api'
import type { DriverPrediction, PredictionResponse } from '@/types/f1'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

// ── Session registry ─────────────────────────────────────────────────────────

type CircuitType = 'street' | 'power' | 'mixed'

interface CircuitMeta {
  name:  string
  type:  CircuitType
  badge: string
  tip:   string
}

const CIRCUITS: Record<string, CircuitMeta> = {
  'Monaco Grand Prix':   { name: 'Monaco',      type: 'street', badge: 'Street', tip: 'Grid position locks in race outcome — overtaking nearly impossible' },
  'Italian Grand Prix':  { name: 'Monza',       type: 'power',  badge: 'Power',  tip: 'Slipstream-dependent, high overtaking, qualifying gap matters less' },
  'Belgian Grand Prix':  { name: 'Spa',         type: 'power',  badge: 'Power',  tip: 'Long circuit, weather variance, safety cars common' },
  'Spanish Grand Prix':  { name: 'Barcelona',   type: 'mixed',  badge: 'Mixed',  tip: 'Representative circuit, strong benchmark for car pace' },
  'British Grand Prix':  { name: 'Silverstone', type: 'mixed',  badge: 'Mixed',  tip: 'High-speed, mixed characteristics, tyre deg significant' },
}

const BADGE_STYLES: Record<CircuitType, string> = {
  street: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  power:  'bg-blue-500/10  text-blue-400  border-blue-500/20',
  mixed:  'bg-zinc-500/10  text-zinc-400  border-zinc-500/20',
}

const SESSIONS = [
  { year: 2025, gp_name: 'Belgian Grand Prix',  session_key: 9935 },
  { year: 2025, gp_name: 'British Grand Prix',  session_key: 9943 },
  { year: 2025, gp_name: 'Italian Grand Prix',  session_key: 9908 },
  { year: 2025, gp_name: 'Monaco Grand Prix',   session_key: 9975 },
  { year: 2025, gp_name: 'Spanish Grand Prix',  session_key: 9967 },
  { year: 2024, gp_name: 'Belgian Grand Prix',  session_key: 9570 },
  { year: 2024, gp_name: 'British Grand Prix',  session_key: 9554 },
  { year: 2024, gp_name: 'Italian Grand Prix',  session_key: 9586 },
  { year: 2024, gp_name: 'Monaco Grand Prix',   session_key: 9519 },
  { year: 2024, gp_name: 'Spanish Grand Prix',  session_key: 9535 },
  { year: 2023, gp_name: 'Belgian Grand Prix',  session_key: 9135 },
  { year: 2023, gp_name: 'British Grand Prix',  session_key: 9122 },
  { year: 2023, gp_name: 'Italian Grand Prix',  session_key: 9153 },
  { year: 2023, gp_name: 'Monaco Grand Prix',   session_key: 9090 },
  { year: 2023, gp_name: 'Spanish Grand Prix',  session_key: 9098 },
  { year: 2022, gp_name: 'Belgian Grand Prix',  session_key: 7150 },
  { year: 2022, gp_name: 'British Grand Prix',  session_key: 7107 },
  { year: 2022, gp_name: 'Italian Grand Prix',  session_key: 7124 },
  { year: 2022, gp_name: 'Monaco Grand Prix',   session_key: 7052 },
  { year: 2022, gp_name: 'Spanish Grand Prix',  session_key: 7043 },
]

const CIRCUITS_UNIQUE = [...new Set(SESSIONS.map(s => s.gp_name))]
const YEARS_UNIQUE    = [...new Set(SESSIONS.map(s => s.year))].sort((a, b) => b - a)

// ── Sub-components ───────────────────────────────────────────────────────────

function ProbBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = max > 0 ? value / max : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-red transition-all duration-500"
          style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="font-mono text-xs text-zinc-400 w-10 text-right">
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  )
}

function PositionDist({ probs }: { probs: Record<string, number> }) {
  const max = Math.max(...Object.values(probs))
  return (
    <div className="flex items-end gap-px h-8">
      {Array.from({ length: 20 }, (_, i) => {
        const p = probs[String(i + 1)] ?? 0
        const h = max > 0 ? (p / max) * 100 : 0
        return (
          <div key={i} className="flex-1 rounded-sm"
            style={{
              height: `${Math.max(h, 4)}%`,
              background: p > 0.05 ? '#E8002D' : '#2A2A2A',
              opacity: p > 0 ? 0.6 + p * 0.4 : 0.25,
            }}
            title={`P${i + 1}: ${(p * 100).toFixed(1)}%`}
          />
        )
      })}
    </div>
  )
}

function DriverCard({ pred, rank, maxWinProb }: {
  pred: DriverPrediction; rank: number; maxWinProb: number
}) {
  const [expanded, setExpanded] = useState(false)
  const medalColour = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : null

  return (
    <div className={`bg-surface border rounded-xl overflow-hidden
      ${rank <= 3 ? 'border-zinc-600' : 'border-border'}`}>

      <div
        className="grid grid-cols-12 px-4 py-3.5 items-center cursor-pointer hover:bg-surface2 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="col-span-1 flex justify-center">
          {medalColour ? (
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: medalColour, color: '#000' }}>
              {rank}
            </div>
          ) : (
            <span className="font-mono text-sm text-zinc-500">{rank}</span>
          )}
        </div>

        <div className="col-span-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-sm">{pred.abbreviation}</span>
            <span className="font-mono text-[10px] text-zinc-600 bg-surface2 px-1.5 py-0.5 rounded">
              P{pred.grid_position}→P{pred.predicted_position}
            </span>
          </div>
          <span className="text-zinc-500 text-xs">{pred.team_name}</span>
        </div>

        <div className="col-span-4">
          <ProbBar value={pred.win_probability} max={maxWinProb} />
          <span className="text-[9px] text-zinc-600 mt-0.5 block">Win probability</span>
        </div>

        <div className="col-span-2 text-right">
          <div className="font-mono text-sm text-white">
            {(pred.podium_probability * 100).toFixed(0)}%
          </div>
          <div className="text-[9px] text-zinc-600">Podium</div>
        </div>

        <div className="col-span-1 flex justify-end text-zinc-600 text-xs transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▾
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          <div>
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">
              Finish position distribution
            </div>
            <PositionDist probs={pred.position_probabilities} />
            <div className="flex justify-between mt-1">
              <span className="font-mono text-[9px] text-zinc-700">P1</span>
              <span className="font-mono text-[9px] text-zinc-700">P20</span>
            </div>
          </div>

          {pred.shap_factors.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">
                Key factors
              </div>
              <div className="space-y-1.5">
                {pred.shap_factors.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: f.positive ? '#2CF4C5' : '#E8002D' }} />
                    <span className="text-xs text-zinc-400">{f.label}</span>
                    <span className="font-mono text-[10px] text-zinc-600 ml-auto">
                      {f.shap_value > 0 ? '+' : ''}{f.shap_value.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PredictionsPage() {
  const [selectedCircuit, setSelectedCircuit] = useState(CIRCUITS_UNIQUE[0])
  const [selectedYear,    setSelectedYear]    = useState(YEARS_UNIQUE[0])
  const [data,            setData]            = useState<PredictionResponse | null>(null)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)

  const session    = SESSIONS.find(s => s.gp_name === selectedCircuit && s.year === selectedYear)
  const circuit    = CIRCUITS[selectedCircuit]
  const maxWinProb = data ? Math.max(...data.predictions.map(p => p.win_probability)) : 1

  useEffect(() => {
    if (!session) return
    setLoading(true)
    setError(null)
    setData(null)
    predictionsApi.predict(session.session_key)
      .then(setData)
      .catch(e => setError(e?.message ?? 'Failed to load predictions'))
      .finally(() => setLoading(false))
  }, [session?.session_key])

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">

      <div>
        <h1 className="font-display font-bold text-2xl text-white">Race Predictions</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          FLAML AutoML · ExtraTree · 385 rows · 5 circuits · 4 years
        </p>
      </div>

      {/* Selectors */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Circuit</div>
          <div className="flex flex-wrap gap-2">
            {CIRCUITS_UNIQUE.map(gp => {
              const c      = CIRCUITS[gp]
              const active = selectedCircuit === gp
              return (
                <button key={gp}
                  onClick={() => setSelectedCircuit(gp)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                    ${active
                      ? 'bg-red text-white'
                      : 'bg-surface2 border border-border text-zinc-400 hover:border-zinc-500'
                    }`}>
                  {c?.name ?? gp}
                  {c && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${BADGE_STYLES[c.type]}`}>
                      {c.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Year</div>
          <div className="flex gap-2">
            {YEARS_UNIQUE.map(year => (
              <button key={year}
                onClick={() => setSelectedYear(year)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors
                  ${selectedYear === year
                    ? 'bg-surface2 border border-zinc-500 text-white'
                    : 'bg-surface2 border border-border text-zinc-500 hover:border-zinc-600'
                  }`}>
                {year}
              </button>
            ))}
          </div>
        </div>

        {circuit && (
          <div className="flex items-start gap-2 pt-1 border-t border-border">
            <span className={`text-[9px] px-1.5 py-0.5 rounded border flex-shrink-0 mt-0.5 ${BADGE_STYLES[circuit.type]}`}>
              {circuit.badge}
            </span>
            <span className="text-[11px] text-zinc-500">{circuit.tip}</span>
          </div>
        )}
      </div>

      {/* Model info */}
      {data && (
        <div className="flex items-center gap-3 px-3 py-2 bg-surface border border-border rounded-lg">
          <div className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse flex-shrink-0" />
          <span className="text-xs text-zinc-500">
            {data.model_info.name} · MAE 2.5 pos · 58% top-3 accuracy
            · {selectedYear} {circuit?.name} from qualifying
          </span>
        </div>
      )}

      {/* Content */}
      {!session ? (
        <div className="text-center py-8 text-zinc-600 text-sm bg-surface border border-border rounded-xl">
          No data for {selectedYear} {circuit?.name ?? selectedCircuit}
        </div>
      ) : loading ? (
        <LoadingSpinner text="Running inference..." />
      ) : error ? (
        <div className="bg-surface border border-red/30 rounded-xl p-4 text-sm text-red">
          {error}
        </div>
      ) : data ? (
        <div className="space-y-2">
          {data.predictions.map((pred, i) => (
            <DriverCard key={pred.driver_number} pred={pred} rank={i + 1} maxWinProb={maxWinProb} />
          ))}
        </div>
      ) : null}

    </div>
  )
}