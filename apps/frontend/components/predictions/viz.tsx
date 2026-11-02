'use client'

import { useCallback, useState } from 'react'
import type { DriverPrediction, ShapFactor } from '@/types/f1'

/* ── Shared tokens (match the landing light theme) ───────────── */
export const INK = '#0b0b0b'
export const INK2 = '#52514e'
export const MUTED = '#737373'
export const GRID = '#e5e5e5'
export const BLUE = '#2a78d6'
export const RED = '#e34948'
export { ramp, teamHex, pct } from '@/lib/viz-color'
import { pct, ramp, teamHex } from '@/lib/viz-color'

/* ── Tooltip ─────────────────────────────────────────────────── */
export type TipLine = { key?: string; label: string; value: string }
type TipState = { x: number; y: number; title: string; lines: TipLine[]; swatch?: string } | null

export function useTip() {
  const [tip, setTip] = useState<TipState>(null)
  const show = useCallback(
    (e: { clientX: number; clientY: number }, title: string, lines: TipLine[], swatch?: string) =>
      setTip({ x: e.clientX, y: e.clientY, title, lines, swatch }),
    [],
  )
  const hide = useCallback(() => setTip(null), [])
  const node = tip ? (
    <div
      className="viz-tip"
      role="status"
      style={{
        left: Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 220),
        top: tip.y + 14,
      }}
    >
      <div className="viz-tip-title">
        {tip.swatch ? <span className="viz-tip-line" style={{ background: tip.swatch }} /> : null}
        {tip.title}
      </div>
      {tip.lines.map(l => (
        <div key={l.label} className="viz-tip-row">
          <span className="viz-tip-val">{l.value}</span>
          <span className="viz-tip-label">{l.label}</span>
        </div>
      ))}
    </div>
  ) : null
  return { show, hide, node }
}

/* ── Heat grid (driver × position, driver × feature stream) ──── */
export interface HeatRow {
  id: number
  label: string
  colour: string
  values: (number | null)[]
  outline?: number // column index to outline (grid position)
  note?: string
}

export function HeatGrid({
  rows,
  cols,
  max,
  fmt,
  labelFrom,
  describe,
  selected,
  onSelect,
  ariaLabel,
}: {
  rows: HeatRow[]
  cols: string[]
  max: number
  fmt: (v: number) => string
  labelFrom: number // show the number in a cell only when it is at least this
  describe: (row: HeatRow, col: string, v: number | null) => { title: string; lines: TipLine[] }
  selected?: number | null
  onSelect?: (id: number) => void
  ariaLabel: string
}) {
  const tip = useTip()
  const LW = 84
  const HH = 32
  const RH = 30
  const W = 960
  const cw = (W - LW) / cols.length
  const H = HH + rows.length * RH
  return (
    <div className="viz-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} style={{ width: '100%', minWidth: 640, display: 'block' }}>
        {cols.map((c, ci) => (
          <text key={c} x={LW + ci * cw + cw / 2} y={20} textAnchor="middle" fontSize={12} fill={MUTED}>{c}</text>
        ))}
        {rows.map((r, ri) => {
          const y = HH + ri * RH
          const isSel = selected === r.id
          return (
            <g key={r.id}>
              {isSel && <rect x={0} y={y} width={W} height={RH} fill="#f4f4f4" rx={4} />}
              <g
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                aria-pressed={onSelect ? isSel : undefined}
                aria-label={`${r.label}${r.note ? `, ${r.note}` : ''}`}
                style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}
                onClick={() => onSelect?.(r.id)}
                onKeyDown={e => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(r.id) } }}
              >
                <circle cx={10} cy={y + RH / 2} r={4} fill={r.colour} />
                <text x={22} y={y + RH / 2 + 4} fontSize={14} fontWeight={isSel ? 600 : 500} fill={INK}>{r.label}</text>
              </g>
              {r.values.map((v, ci) => {
                const x = LW + ci * cw
                const t = v == null ? 0 : Math.min(1, v / (max || 1))
                const fill = v == null || v < 0.005 ? '#f6f6f6' : ramp(0.12 + t * 0.88)
                const dark = t > 0.45
                return (
                  <g
                    key={ci}
                    onPointerMove={e => tip.show(e, r.label, describe(r, cols[ci], v).lines, r.colour)}
                    onPointerLeave={tip.hide}
                  >
                    <rect x={x + 1} y={y + 1} width={cw - 2} height={RH - 2} rx={4} fill={fill}
                      stroke={r.outline === ci ? INK : 'none'} strokeWidth={r.outline === ci ? 2 : 0} />
                    {v != null && v >= labelFrom && cw >= 30 && (
                      <text x={x + cw / 2} y={y + RH / 2 + 4} textAnchor="middle" fontSize={12}
                        fill={dark ? '#ffffff' : INK} style={{ fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>{fmt(v)}</text>
                    )}
                    {v == null && cw >= 30 && (
                      <text x={x + cw / 2} y={y + RH / 2 + 4} textAnchor="middle" fontSize={12} fill={MUTED} style={{ pointerEvents: 'none' }}>—</text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      {tip.node}
    </div>
  )
}

/* ── Grid to predicted dumbbell chart ────────────────────────── */
export function GridShift({ rows, nPos }: { rows: DriverPrediction[]; nPos: number }) {
  const tip = useTip()
  const LW = 64
  const RH = 28
  const TOP = 28
  const W = 960
  const PW = W - LW - 24
  const x = (p: number) => LW + ((p - 1) / Math.max(1, nPos - 1)) * PW
  const sorted = [...rows].sort((a, b) => a.grid_position - b.grid_position)
  const H = TOP + sorted.length * RH + 8
  const ticks = Array.from({ length: nPos }, (_, i) => i + 1).filter(p => p === 1 || p % 5 === 0 || p === nPos)
  return (
    <div className="viz-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Grid position against predicted finishing position for every driver" style={{ width: '100%', minWidth: 640, display: 'block' }}>
        {ticks.map(p => (
          <g key={p}>
            <line x1={x(p)} x2={x(p)} y1={TOP - 6} y2={H - 8} stroke={GRID} strokeWidth={1} />
            <text x={x(p)} y={14} textAnchor="middle" fontSize={12} fill={MUTED}>P{p}</text>
          </g>
        ))}
        {sorted.map((d, i) => {
          const cy = TOP + i * RH + RH / 2
          const gain = d.grid_position - d.predicted_position
          const col = gain > 0 ? BLUE : gain < 0 ? RED : '#a3a3a3'
          const team = teamHex(d.team_colour)
          return (
            <g key={d.driver_number}
              onPointerMove={e => tip.show(e, d.abbreviation, [
                { label: 'Grid position', value: `P${d.grid_position}` },
                { label: 'Predicted finish', value: `P${d.predicted_position}` },
                { label: gain > 0 ? 'Places gained' : gain < 0 ? 'Places lost' : 'Change', value: gain === 0 ? 'None' : String(Math.abs(gain)) },
              ], team)}
              onPointerLeave={tip.hide}
            >
              <rect x={0} y={cy - RH / 2} width={W} height={RH} fill="transparent" />
              <circle cx={10} cy={cy} r={4} fill={team} />
              <text x={22} y={cy + 4} fontSize={14} fontWeight={500} fill={INK}>{d.abbreviation}</text>
              <line x1={x(d.grid_position)} x2={x(d.predicted_position)} y1={cy} y2={cy} stroke={col} strokeWidth={2} strokeLinecap="round" />
              <circle cx={x(d.grid_position)} cy={cy} r={5} fill="#ffffff" stroke={INK} strokeWidth={2} />
              <circle cx={x(d.predicted_position)} cy={cy} r={5} fill={col} stroke="#ffffff" strokeWidth={2} />
            </g>
          )
        })}
      </svg>
      <div className="viz-legend">
        <span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#fff" stroke={INK} strokeWidth="2" /></svg>Grid position</span>
        <span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill={BLUE} /></svg>Predicted, gains places</span>
        <span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill={RED} /></svg>Predicted, loses places</span>
      </div>
      {tip.node}
    </div>
  )
}

/* ── Finishing distribution for one driver ───────────────────── */
export function PositionDistribution({ d, nPos }: { d: DriverPrediction; nPos: number }) {
  const tip = useTip()
  const probs = Array.from({ length: nPos }, (_, i) => d.position_probabilities?.[String(i + 1)] ?? 0)
  const total = probs.reduce((a, b) => a + b, 0) || 1
  const expected = probs.reduce((a, p, i) => a + p * (i + 1), 0) / total
  const maxP = Math.max(...probs, 0.01)
  const yMax = Math.ceil(maxP * 10) / 10 || 0.1
  const W = 520
  const H = 260
  const L = 44
  const B = 28
  const T = 16
  const cw = (W - L - 8) / nPos
  const bw = Math.min(24, cw - 4)
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B)
  const peak = probs.indexOf(maxP)
  const ticks = [0, yMax / 2, yMax]
  const ex = L + (expected - 0.5) * cw
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Finishing position probabilities for ${d.abbreviation}`} style={{ width: '100%', display: 'block' }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - 8} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill={MUTED}>{Math.round(t * 100)}%</text>
          </g>
        ))}
        {probs.map((p, i) => {
          const cx = L + i * cw + cw / 2
          const h = Math.max(0, H - B - y(p))
          const isGrid = d.grid_position === i + 1
          return (
            <g key={i}
              onPointerMove={e => tip.show(e, `${d.abbreviation} finishes P${i + 1}`, [{ label: 'Probability', value: pct(p) }, ...(isGrid ? [{ label: 'Started here', value: 'Grid position' }] : [])], teamHex(d.team_colour))}
              onPointerLeave={tip.hide}
            >
              <rect x={cx - cw / 2} y={T} width={cw} height={H - T - B} fill="transparent" />
              {h > 2 && (
                <path d={`M${cx - bw / 2},${H - B} V${y(p) + 4} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 V${H - B} Z`} fill={BLUE} />
              )}
              {(i === 0 || (i + 1) % 5 === 0 || i === nPos - 1) && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={12} fill={MUTED}>P{i + 1}</text>
              )}
              {isGrid && <path d={`M${cx - 5},${H - B + 6} L${cx + 5},${H - B + 6} L${cx},${H - B + 1} Z`} fill={INK} />}
            </g>
          )
        })}
        <line x1={ex} x2={ex} y1={T} y2={H - B} stroke={INK} strokeWidth={1} />
        <text x={W - 8} y={T + 8} textAnchor="end" fontSize={12} fill={INK} fontWeight={600}>Expected finish P{expected.toFixed(1)}</text>
        {maxP > 0.02 && (
          <text x={L + peak * cw + cw / 2} y={y(maxP) - 6} textAnchor="middle" fontSize={12} fill={INK2}>{pct(maxP, 0)}</text>
        )}
      </svg>
      <div className="viz-legend">
        <span><svg width="14" height="14"><rect x="2" y="2" width="10" height="10" rx="2" fill={BLUE} /></svg>Probability of finishing in each position</span>
        <span><svg width="14" height="14"><path d="M2,12 L12,12 L7,3 Z" fill={INK} /></svg>Grid position</span>
        <span><svg width="14" height="14"><line x1="7" x2="7" y1="1" y2="13" stroke={INK} /></svg>Expected finish</span>
      </div>
      {tip.node}
    </div>
  )
}

/* ── Per driver attribution (SHAP) ───────────────────────────── */
export function ShapBars({ factors }: { factors: ShapFactor[] }) {
  const tip = useTip()
  const items = [...factors]
    .map(f => ({ ...f, signed: f.positive ? Math.abs(f.shap_value) : -Math.abs(f.shap_value) }))
    .sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed))
    .slice(0, 8)
  if (!items.length) {
    return <p className="body-6 muted">No attribution factors were returned for this driver.</p>
  }
  const maxAbs = Math.max(...items.map(i => Math.abs(i.signed)), 0.001)
  const W = 520
  const LW = 200
  const RH = 32
  const mid = LW + (W - LW) / 2
  const half = (W - LW) / 2 - 56
  const H = items.length * RH + 36
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Features that help or hurt the predicted finish" style={{ width: '100%', display: 'block' }}>
        <line x1={mid} x2={mid} y1={4} y2={H - 28} stroke="#c3c2b7" strokeWidth={1} />
        {items.map((it, i) => {
          const cy = 8 + i * RH + RH / 2
          const w = (Math.abs(it.signed) / maxAbs) * half
          const pos = it.signed > 0
          const x0 = pos ? mid : mid - w
          return (
            <g key={`${it.feature}-${i}`}
              onPointerMove={e => tip.show(e, it.label, [
                { label: pos ? 'Helps the predicted finish' : 'Hurts the predicted finish', value: Math.abs(it.shap_value).toFixed(3) },
                ...(it.stream_label ? [{ label: 'Feature stream', value: it.stream_label }] : []),
              ], pos ? BLUE : RED)}
              onPointerLeave={tip.hide}
            >
              <rect x={0} y={cy - RH / 2} width={W} height={RH} fill="transparent" />
              <text x={LW - 12} y={cy + 4} textAnchor="end" fontSize={12} fill={INK2}>{it.label.length > 30 ? `${it.label.slice(0, 29)}…` : it.label}</text>
              <rect x={x0} y={cy - 8} width={Math.max(2, w)} height={16} rx={4} fill={pos ? BLUE : RED} />
              <text x={pos ? mid + w + 8 : mid - w - 8} y={cy + 4} textAnchor={pos ? 'start' : 'end'} fontSize={12} fill={INK} style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.abs(it.shap_value).toFixed(2)}</text>
            </g>
          )
        })}
        <text x={mid - 8} y={H - 8} textAnchor="end" fontSize={12} fill={MUTED}>Hurts</text>
        <text x={mid + 8} y={H - 8} fontSize={12} fill={MUTED}>Helps</text>
      </svg>
      {tip.node}
    </div>
  )
}

/* ── Model vs baseline ───────────────────────────────────────── */
export function ValidationBars({ model, baseline }: { model: number | null; baseline: number | null }) {
  const rows = [
    { label: 'Slipstream model', v: model, fill: BLUE },
    { label: 'Grid order baseline', v: baseline, fill: '#a3a3a3' },
  ]
  const W = 520
  const LW = 140
  const bw = W - LW - 56
  const tip = useTip()
  return (
    <div>
      <svg viewBox={`0 0 ${W} 96`} role="img" aria-label="Top three accuracy of the model against the grid order baseline" style={{ width: '100%', maxWidth: 520, display: 'block' }}>
        {[0, 0.5, 1].map(t => (
          <g key={t}>
            <line x1={LW + t * bw} x2={LW + t * bw} y1={4} y2={72} stroke={GRID} strokeWidth={1} />
            <text x={LW + t * bw} y={90} textAnchor="middle" fontSize={12} fill={MUTED}>{t * 100}%</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cy = 22 + i * 34
          const w = r.v == null ? 0 : r.v * bw
          return (
            <g key={r.label}
              onPointerMove={e => tip.show(e, r.label, [{ label: 'Top three accuracy, cross validated', value: pct(r.v) }], r.fill)}
              onPointerLeave={tip.hide}
            >
              <rect x={0} y={cy - 17} width={W} height={34} fill="transparent" />
              <text x={0} y={cy + 4} fontSize={14} fill={INK}>{r.label}</text>
              {r.v != null && <path d={`M${LW},${cy - 10} H${LW + w - 4} a4,4 0 0 1 4,4 V${cy + 6} a4,4 0 0 1 -4,4 H${LW} Z`} fill={r.fill} />}
              <text x={LW + w + 8} y={cy + 4} fontSize={14} fontWeight={600} fill={INK}>{pct(r.v)}</text>
            </g>
          )
        })}
      </svg>
      {tip.node}
    </div>
  )
}
