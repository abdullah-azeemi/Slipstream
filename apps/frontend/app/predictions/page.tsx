'use client'
import { useEffect, useState } from 'react'
import { predictionsApi } from '@/lib/api'
import { teamColour } from '@/lib/utils'
import type { DriverPrediction, PredictionResponse } from '@/types/f1'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

// ── Session options — qualifying sessions with trained data ──────────────────
const QUALI_SESSIONS = [
  { key: 9554, label: '2024 British GP' },
  { key: 9122, label: '2023 British GP' },
  { key: 7107, label: '2022 British GP' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function ProbBar({ value, colour }: { value: number; colour: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value * 100}%`, background: colour }}
        />
      </div>
      <span className="font-mono text-xs text-zinc-400 w-10 text-right">
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  )
}

function PositionDistribution({
  probs,
  colour,
}: {
  probs: Record<string, number>
  colour: string
}) {
  const maxProb = Math.max(...Object.values(probs))
  return (
    <div className="flex items-end gap-px h-8">
      {Array.from({ length: 20 }, (_, i) => {
        const p = probs[String(i + 1)] ?? 0
        const h = maxProb > 0 ? (p / maxProb) * 100 : 0
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all duration-300"
            style={{
              height: `${Math.max(h, 4)}%`,
              background: p > 0.05 ? colour : '#2A2A2A',
              opacity: p > 0 ? 0.7 + p * 0.3 : 0.3,
            }}
            title={`P${i + 1}: ${(p * 100).toFixed(1)}%`}
          />
        )
      })}
    </div>
  )
}

function DriverCard({
  pred,
  rank,
}: {
  pred: DriverPrediction
  rank: number
}) {
  const [expanded, setExpanded] = useState(false)
  const colour  = teamColour(null) // will use team colour from drivers context
  const isTop3  = rank <= 3

  // Podium colours
  const medalColour =
    rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : null

  return (
    <div
      className={`bg-surface border rounded-xl overflow-hidden transition-all
        ${isTop3 ? 'border-zinc-600' : 'border-border'}`}
    >
      {/* Main row */}
      <div
        className="grid grid-cols-12 px-4 py-3.5 items-center cursor-pointer hover:bg-surface2 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Position */}
        <div className="col-span-1 flex items-center justify-center">
          {medalColour ? (
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: medalColour, color: '#000' }}
            >
              {rank}
            </div>
          ) : (
            <span className="font-mono text-sm text-zinc-500">{rank}</span>
          )}
        </div>

        {/* Driver */}
        <div className="col-span-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-sm">{pred.abbreviation}</span>
            <span className="font-mono text-[10px] text-zinc-600 bg-surface2 px-1.5 py-0.5 rounded">
              P{pred.grid_position} → P{pred.predicted_position}
            </span>
          </div>
          <span className="text-zinc-500 text-xs">{pred.team_name}</span>
        </div>

        {/* Win probability bar */}
        <div className="col-span-4">
          <ProbBar value={pred.win_probability} colour={isTop3 ? '#E8002D' : '#444'} />
          <span className="text-[9px] text-zinc-600 mt-0.5 block">Win prob</span>
        </div>

        {/* Podium probability */}
        <div className="col-span-2 text-right">
          <div className="font-mono text-sm text-white">
            {(pred.podium_probability * 100).toFixed(0)}%
          </div>
          <div className="text-[9px] text-zinc-600">Podium</div>
        </div>

        {/* Expand chevron */}
        <div className="col-span-1 flex justify-end">
          <span className="text-zinc-600 text-xs transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            ▾
          </span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">

          {/* Position distribution */}
          <div>
            <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1.5">
              Position probability distribution
            </div>
            <PositionDistribution probs={pred.position_probabilities} colour="#E8002D" />
            <div className="flex justify-between mt-1">
              <span className="font-mono text-[9px] text-zinc-700">P1</span>
              <span className="font-mono text-[9px] text-zinc-700">P20</span>
            </div>
          </div>

          {/* SHAP factors */}
          {pred.shap_factors.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-2">
                Key factors
              </div>
              <div className="space-y-1.5">
                {pred.shap_factors.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: f.positive ? '#2CF4C5' : '#E8002D' }}
                    />
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
  const [selectedKey, setSelectedKey] = useState(QUALI_SESSIONS[0].key)
  const [data,        setData]        = useState<PredictionResponse | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    predictionsApi.predict(selectedKey)
      .then(setData)
      .catch(e => setError(e.message ?? 'Failed to load predictions'))
      .finally(() => setLoading(false))
  }, [selectedKey])

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">

      <div>
        <h1 className="font-display font-bold text-2xl text-white">Race Predictions</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          FLAML AutoML · XGBoost · trained on 3 years of Silverstone data
        </p>
      </div>

      {/* Session selector */}
      <div className="flex gap-2">
        {QUALI_SESSIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setSelectedKey(s.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
              ${selectedKey === s.key
                ? 'bg-red text-white'
                : 'bg-surface border border-border text-zinc-400 hover:border-zinc-500'
              }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Model info */}
      {data && (
        <div className="flex items-center gap-3 px-3 py-2 bg-surface border border-border rounded-lg">
          <div className="w-1.5 h-1.5 rounded-full bg-teal animate-pulse" />
          <span className="text-xs text-zinc-500">
            {data.model_info.name} · MAE 3.1 positions · 33% top-3 accuracy
          </span>
        </div>
      )}

      {loading ? (
        <LoadingSpinner text="Running inference..." />
      ) : error ? (
        <div className="bg-surface border border-red/30 rounded-xl p-4 text-sm text-red">
          {error}
        </div>
      ) : data ? (
        <div className="space-y-2">
          {data.predictions.map((pred, i) => (
            <DriverCard key={pred.driver_number} pred={pred} rank={i + 1} />
          ))}
        </div>
      ) : null}

    </div>
  )
}