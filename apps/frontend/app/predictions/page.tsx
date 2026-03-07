'use client'
import { useState } from 'react'
import { FlaskConical, Play } from 'lucide-react'
import { teamColour } from '@/lib/utils'

const MOCK_PREDICTIONS = [
  { pos: 1, abbr: 'RUS', driver: 'George Russell', team: 'Mercedes',  colour: '27F4D2', confidence: 67,
    shap: ['+Strong home form', '+Pole advantage', '-Tyre deg risk'] },
  { pos: 2, abbr: 'HAM', driver: 'Lewis Hamilton', team: 'Mercedes',  colour: '27F4D2', confidence: 42,
    shap: ['+Silverstone specialist', '+Team strategy', '-Grid P2'] },
  { pos: 3, abbr: 'VER', driver: 'Max Verstappen', team: 'Red Bull Racing', colour: '3671C6', confidence: 31,
    shap: ['+Pace in race trim', '-Street circuit gap', '-Tyre management'] },
]

const FULL_GRID = [
  { pos: 4,  abbr: 'NOR', colour: 'FF8000', prob: 18.2 },
  { pos: 5,  abbr: 'LEC', colour: 'E80020', prob: 12.4 },
  { pos: 6,  abbr: 'SAI', colour: 'E80020', prob: 8.1  },
  { pos: 7,  abbr: 'PIA', colour: 'FF8000', prob: 6.3  },
  { pos: 8,  abbr: 'ALO', colour: '229971', prob: 4.2  },
  { pos: 9,  abbr: 'STR', colour: '229971', prob: 2.1  },
  { pos: 10, abbr: 'ALB', colour: '64C4FF', prob: 1.8  },
]

const POS_STYLE: Record<number, { colour: string }> = {
  1: { colour: '#FFD700' },
  2: { colour: '#C0C0C0' },
  3: { colour: '#CD7F32' },
}

// Visual order: P2 left, P1 centre (elevated), P3 right
const PODIUM_ORDER = [MOCK_PREDICTIONS[1], MOCK_PREDICTIONS[0], MOCK_PREDICTIONS[2]]

export default function PredictionsPage() {
  const [gridPos,   setGridPos]   = useState('Actual Grid')
  const [weather,   setWeather]   = useState('Dry (24°C)')
  const [safetyCar, setSafetyCar] = useState('Standard (Historical)')
  const [simulating,setSimulating]= useState(false)

  const runSimulation = () => {
    setSimulating(true)
    setTimeout(() => setSimulating(false), 1800)
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-6">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="text-center space-y-2">
        <h1 className="font-display font-bold text-3xl text-white tracking-wide">
          Race Prediction
        </h1>
        <p className="text-zinc-500 text-xs tracking-widest uppercase">
          British GP · Silverstone
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <span className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] px-2.5 py-1 rounded font-mono">
            Model: FLAML AutoML
          </span>
          <span className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] px-2.5 py-1 rounded font-mono">
            Acc: 71%
          </span>
        </div>
        <p className="text-zinc-600 text-xs">
          Based on 2022–2025 British GP historical data
        </p>
      </div>

      {/* ── Podium ─────────────────────────────────────────────────── */}
      <div>
        <div className="text-[10px] tracking-widest text-zinc-500 uppercase flex items-center gap-2 mb-5">
          <span className="text-red">⚑</span> PREDICTED PODIUM
        </div>

        <div className="grid grid-cols-3 gap-3 items-end">
          {PODIUM_ORDER.map((pred, vi) => {
            const isCenter = vi === 1
            const style    = POS_STYLE[pred.pos]
            const colour   = teamColour(pred.colour)

            return (
              <div
                key={pred.pos}
                className={`bg-surface border rounded-xl relative transition-all duration-300 ${
                  isCenter
                    ? 'border-yellow-500/50 shadow-xl shadow-yellow-500/10 pb-5 pt-8'
                    : 'border-border pb-4 pt-7'
                }`}
              >
                {/* Position badge */}
                <div
                  className="absolute -top-3.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-lg"
                  style={{ background: style.colour, color: '#000' }}
                >
                  {pred.pos}
                </div>

                <div className="px-3 text-center">
                  {/* Driver abbr */}
                  <div
                    className="font-display font-bold text-3xl mb-1"
                    style={{ color: colour }}
                  >
                    {pred.abbr}
                  </div>

                  {/* Team underline */}
                  <div
                    className="h-0.5 w-10 mx-auto rounded mb-2"
                    style={{ background: colour }}
                  />

                  <div className="text-zinc-500 text-[10px] mb-1">{pred.team}</div>

                  {/* Confidence */}
                  <div className="text-[10px] text-zinc-600 uppercase tracking-widest mb-1">
                    Conf
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="flex-1 h-1 bg-surface3 rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{ width: `${pred.confidence}%`, background: colour }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-zinc-400 flex-shrink-0">
                      {pred.confidence}%
                    </span>
                  </div>

                  {/* SHAP factors */}
                  <div className="mt-2.5 space-y-1">
                    {pred.shap.map((factor, i) => (
                      <div
                        key={i}
                        className={`text-[9px] px-1.5 py-0.5 rounded text-left leading-tight ${
                          factor.startsWith('+')
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        {factor}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── What If Simulator ──────────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical size={16} className="text-red" />
          <h2 className="font-semibold text-white">What If? Simulator</h2>
        </div>
        <p className="text-zinc-600 text-xs mb-5">Modify race conditions and re-run the model</p>

        <div className="space-y-4 mb-5">
          {[
            { label: 'GRID POSITION',          value: gridPos,   set: setGridPos,
              options: ['Actual Grid', 'VER P1 / RUS P3', 'HAM P1', 'Random Grid'] },
            { label: 'WEATHER',                value: weather,   set: setWeather,
              options: ['Dry (24°C)', 'Wet', 'Mixed Conditions'] },
            { label: 'SAFETY CAR PROBABILITY', value: safetyCar, set: setSafetyCar,
              options: ['Standard (Historical)', 'High Probability', 'Certain SC', 'No SC'] },
          ].map(({ label, value, set, options }) => (
            <div key={label}>
              <div className="text-[10px] tracking-widest text-zinc-500 uppercase mb-2">
                {label}
              </div>
              <select
                className="w-full bg-surface2 border border-border text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-zinc-500 appearance-none"
                value={value}
                onChange={e => set(e.target.value)}
              >
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>

        <button
          onClick={runSimulation}
          disabled={simulating}
          className="w-full bg-red text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 hover:bg-red/90 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {simulating ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Running simulation...
            </>
          ) : (
            <>
              <Play size={16} fill="white" /> Run Simulation
            </>
          )}
        </button>
      </div>

      {/* ── Full Grid Win Probability ──────────────────────────────── */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h2 className="font-semibold text-white mb-4">Full Grid Win Probability</h2>
        <div className="space-y-3">
          {FULL_GRID.map(driver => (
            <div key={driver.abbr} className="flex items-center gap-3">
              <span className="font-mono text-xs text-zinc-600 w-4 text-right flex-shrink-0">
                {driver.pos}
              </span>
              <span className="font-mono text-xs font-bold text-white w-8 flex-shrink-0">
                {driver.abbr}
              </span>
              <div className="flex-1 h-2 bg-surface2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${(driver.prob / 20) * 100}%`,
                    background: `#${driver.colour}`,
                  }}
                />
              </div>
              <span
                className="font-mono text-xs w-10 text-right flex-shrink-0 font-semibold"
                style={{ color: `#${driver.colour}` }}
              >
                {driver.prob}%
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
