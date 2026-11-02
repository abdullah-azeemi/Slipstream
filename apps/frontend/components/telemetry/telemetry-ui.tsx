import type { ReactNode, CSSProperties } from 'react'

// ── Design tokens ─────────────────────────────────────────────────────────────
export const C = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#FAFAFA',
  border: '#E5E5E5',
  borderMid: '#D4D4D4',
  textDim: '#737373',
  textMid: '#666666',
  textSub: '#333333',
  textBright: '#0A0A0A',
  red: '#E8002D',
  green: '#10B981',
  purple: '#6E56CF',
  gold: '#F59E0B',
  brake: '#E8002D',
  crosshair: 'rgba(10,10,10,0.12)',
} as const


// ── Sub-components ────────────────────────────────────────────────────────────

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

export function PanelHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '16px', borderBottom: `1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: C.textBright }}>{title}</div>
        {subtitle && <div style={{ fontSize: 14, lineHeight: '20px', color: C.textMid }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

export function InlineMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={{ padding: 24, borderRadius: 16, border: `1px solid ${C.border}`, background: C.surfaceAlt }}>
      <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: C.textBright }}>{title}</div>
      <div style={{ marginTop: 4, fontSize: 14, lineHeight: '20px', color: C.textMid }}>{detail}</div>
    </div>
  )
}


