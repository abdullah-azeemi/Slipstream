'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem<K extends string> {
  key: K
  label: ReactNode
  disabled?: boolean
}

/**
 * Real tab list: arrow keys, Home and End move selection, only the selected
 * tab is in the tab order, and each tab points at its panel by id.
 * Render the matching content in `<TabPanel id={id} tab={key}>`.
 */
export function TabList<K extends string>({
  id,
  label,
  items,
  value,
  onChange,
  style,
}: {
  id: string
  label: string
  items: TabItem<K>[]
  value: K
  onChange: (key: K) => void
  style?: React.CSSProperties
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const move = (from: number, dir: 1 | -1 | 'first' | 'last') => {
    const enabled = items.map((it, i) => ({ it, i })).filter(x => !x.it.disabled)
    if (!enabled.length) return
    let target = enabled[0]
    if (dir === 'last') target = enabled[enabled.length - 1]
    else if (dir !== 'first') {
      const pos = enabled.findIndex(x => x.i === from)
      target = enabled[(pos + dir + enabled.length) % enabled.length]
    }
    onChange(target.it.key)
    refs.current[target.it.key]?.focus()
  }

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1) }
    else if (e.key === 'Home') { e.preventDefault(); move(i, 'first') }
    else if (e.key === 'End') { e.preventDefault(); move(i, 'last') }
  }

  return (
    <div className="tabs" role="tablist" aria-label={label} style={style}>
      {items.map((it, i) => {
        const on = it.key === value
        return (
          <button
            key={it.key}
            ref={el => { refs.current[it.key] = el }}
            type="button"
            role="tab"
            id={`${id}-tab-${it.key}`}
            aria-selected={on}
            aria-controls={`${id}-panel`}
            tabIndex={on ? 0 : -1}
            disabled={it.disabled}
            className={`tab button-sm ${on ? 'on' : ''}`}
            onClick={() => onChange(it.key)}
            onKeyDown={e => onKey(e, i)}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel<K extends string>({ id, tab, children }: { id: string; tab: K; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}>
      {children}
    </div>
  )
}

/** Filter buttons that do not swap a panel: plain toggle buttons with aria-pressed. */
export function ToggleGroup<K extends string | number>({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: { key: K; label: ReactNode; disabled?: boolean }[]
  value: K | null
  onChange: (key: K) => void
}) {
  return (
    <div className="tabs" role="group" aria-label={label}>
      {items.map(it => (
        <button
          key={String(it.key)}
          type="button"
          aria-pressed={value === it.key}
          disabled={it.disabled}
          className={`tab button-sm ${value === it.key ? 'on' : ''}`}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
