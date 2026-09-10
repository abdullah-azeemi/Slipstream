# Pitwall UX Improvements — Implementation Plan

> **For the implementer:** Three focused UX improvements. Each section has the exact
> file paths, existing code patterns, and step-by-step instructions. Do not change
> anything outside the files listed.

---

## What Already Exists (Context Only — Do Not Touch)

- Sessions list page: `apps/frontend/app/sessions/page.tsx`
  - Already has `loading` state (`const [loading, setLoading] = useState(true)`)
  - Already has a basic empty state (plain text "No archive sessions available...")
  - Fetches from `GET /api/v1/sessions` and renders `WeekendGroup` cards
- Agent page: `apps/frontend/app/agent/page.tsx`
  - Has `fillSuggestion(q: string)` which just calls `setQuestion(q)`
  - Has `SUGGESTED_QUESTIONS` constant array (hardcoded strings, not session-aware)
  - No URL param reading (`useSearchParams` is not used anywhere)
- Sessions API: `apps/backend/src/backend/api/v1/sessions.py`
  - `GET /api/v1/sessions` returns: `session_key, year, gp_name, country, session_type, session_name, date_start, date_end, track_temp_c, air_temp_c, humidity_pct, rainfall, wind_speed_ms`
  - Does **not** return lap counts, telemetry counts, or any coverage data yet

---

## Improvement 1 — Proper Empty, Error & Loading States

**Goal:** Replace the bare text fallbacks with polished states that make the app feel
production-ready when data hasn't been seeded or the API is unavailable.

**File to modify:** `apps/frontend/app/sessions/page.tsx`

### 1a. Add an `error` state

In the `SessionsPage` function, add an error state next to the existing loading state:

```tsx
// Add this alongside the existing useState declarations (~line 113)
const [error, setError] = useState<string | null>(null)
```

### 1b. Update the fetch to capture errors properly

Replace the existing `useEffect` fetch block (around lines 123–133):

```tsx
// BEFORE
useEffect(() => {
  fetch(`${BASE}/api/v1/sessions`)
    .then(r => r.json())
    .then((data: Session[] | { error?: string }) => {
      const rows = Array.isArray(data) ? data : []
      setSessions(rows)
      setAllYears([...new Set(rows.map(s => s.year))].sort((a, b) => b - a))
    })
    .catch(console.error)
    .finally(() => setLoading(false))
}, [])

// AFTER
useEffect(() => {
  fetch(`${BASE}/api/v1/sessions`)
    .then(r => {
      if (!r.ok) throw new Error(`Server returned ${r.status}`)
      return r.json()
    })
    .then((data: Session[] | { error?: string }) => {
      if (!Array.isArray(data) && data.error) throw new Error(data.error)
      const rows = Array.isArray(data) ? data : []
      setSessions(rows)
      setAllYears([...new Set(rows.map(s => s.year))].sort((a, b) => b - a))
    })
    .catch((err: Error) => setError(err.message))
    .finally(() => setLoading(false))
}, [])
```

### 1c. Replace the loading state UI

Find the existing loading block (around lines 270–274):

```tsx
// BEFORE
{loading && (
  <div style={{ textAlign: 'center', padding: '64px 0', color: '#7A8CA5', fontFamily: 'JetBrains Mono, monospace', fontSize: '13px' }}>
    Loading archive...
  </div>
)}

// AFTER — skeleton cards that match the actual card layout
{loading && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
    {[1, 2, 3].map(i => (
      <div
        key={i}
        style={{
          background: 'linear-gradient(180deg, rgba(248,250,255,0.98) 0%, rgba(243,247,252,0.98) 100%)',
          border: '1px solid rgba(204,218,236,0.92)',
          borderRadius: '24px',
          padding: '18px',
          display: 'grid',
          gridTemplateColumns: '84px 1.3fr 1fr 52px',
          gap: '18px',
          alignItems: 'center',
        }}
      >
        {/* Round badge skeleton */}
        <div style={{ height: '74px', borderRadius: '18px', background: '#F1F5FB', animation: 'pulse 1.5s ease-in-out infinite' }} />
        {/* Name + meta skeleton */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ height: '18px', width: '60%', borderRadius: '6px', background: '#EEF3FA', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: '13px', width: '40%', borderRadius: '6px', background: '#EEF3FA', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.1s' }} />
        </div>
        {/* Stats box skeleton */}
        <div style={{ height: '74px', borderRadius: '18px', background: '#F5F8FD', animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.15s' }} />
        {/* Arrow skeleton */}
        <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#EDF4FF', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
    ))}
  </div>
)}
```

Add the `pulse` keyframe to `apps/frontend/app/globals.css`:

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

### 1d. Add error state UI

After the loading block, add the error state before the empty state:

```tsx
{!loading && error && (
  <div style={{
    textAlign: 'center',
    padding: '64px 24px',
    borderRadius: '24px',
    border: '1px solid rgba(239,68,68,0.18)',
    background: 'rgba(254,242,242,0.6)',
  }}>
    <div style={{ fontSize: '28px', marginBottom: '12px' }}>⚠️</div>
    <div style={{ color: '#B91C1C', fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>
      Could not load sessions
    </div>
    <div style={{ color: '#7A8CA5', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', marginBottom: '20px' }}>
      {error}
    </div>
    <button
      onClick={() => { setError(null); setLoading(true) }}
      style={{
        padding: '10px 20px',
        borderRadius: '999px',
        background: '#14233C',
        color: '#fff',
        fontFamily: 'Inter, sans-serif',
        fontSize: '13px',
        fontWeight: 600,
        border: 'none',
        cursor: 'pointer',
      }}
    >
      Retry
    </button>
  </div>
)}
```

> **Note:** The retry button sets `error` back to `null` and `loading` back to `true`,
> but you also need to re-trigger the fetch. The cleanest way is to add a `retryCount`
> state (`const [retryCount, setRetryCount] = useState(0)`) and add it to the
> `useEffect` dependency array, then in the retry button do:
> `setError(null); setLoading(true); setRetryCount(c => c + 1)`.

### 1e. Improve the empty state UI

Replace the existing empty state block (around lines 276–280):

```tsx
// BEFORE
{!loading && grouped.length === 0 && (
  <div style={{ textAlign: 'center', padding: '64px 0', color: '#7A8CA5', fontFamily: 'JetBrains Mono, monospace', fontSize: '13px' }}>
    No archive sessions available for this filter.
  </div>
)}

// AFTER
{!loading && !error && grouped.length === 0 && (
  <div style={{
    textAlign: 'center',
    padding: '64px 24px',
    borderRadius: '24px',
    border: '1px solid rgba(204,218,236,0.78)',
    background: 'rgba(248,250,255,0.6)',
  }}>
    <div style={{ fontSize: '28px', marginBottom: '12px' }}>🏁</div>
    <div style={{ color: '#14233C', fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>
      No sessions found
    </div>
    <div style={{ color: '#7A8CA5', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', maxWidth: '360px', margin: '0 auto', lineHeight: 1.7 }}>
      {sessions.length === 0
        ? 'No data has been ingested yet. Run make seed or ingest a session to get started.'
        : 'No sessions match the current filter. Try selecting a different year or session type.'}
    </div>
  </div>
)}
```

---

## Improvement 2 — "Ask AI About This Weekend" Deep Link

**Goal:** Add a button on each weekend card in the sessions page that navigates to the
agent page with the session pre-filled as a question in the chat input.

### 2a. Update the agent page to read a URL param

**File to modify:** `apps/frontend/app/agent/page.tsx`

Add `useSearchParams` from Next.js. At the top of the `AgentPage` component function,
add:

```tsx
// Add to the existing imports at the top of the file
import { useSearchParams } from 'next/navigation'

// Inside AgentPage(), add after the existing useState declarations:
const searchParams = useSearchParams()

useEffect(() => {
  const prefill = searchParams.get('q')
  if (prefill) {
    setQuestion(prefill)
  }
}, [searchParams])
```

This means navigating to `/agent?q=How+did+Verstappen+perform+at+Monaco+2024` will
pre-fill the input box with that question.

> **Important:** Because `useSearchParams` requires a Suspense boundary, wrap the
> export of `AgentPage` in a Suspense boundary. In
> `apps/frontend/app/agent/page.tsx`, change the default export at the bottom to:
>
> ```tsx
> import { Suspense } from 'react'
>
> export default function AgentPageWrapper() {
>   return (
>     <Suspense fallback={null}>
>       <AgentPage />
>     </Suspense>
>   )
> }
> ```

### 2b. Add the "Ask AI" button to each weekend card

**File to modify:** `apps/frontend/app/sessions/page.tsx`

Add `Link` from `next/link` is already imported. In the weekend card render (around
lines 419–467, inside the `group.sessions.map(...)` section), add a new button
**after** the session pill row (`</div>` that closes the `group.sessions.map`):

```tsx
{/* Ask AI button — add AFTER the session pills row, inside the card div */}
<div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed rgba(204,218,236,0.6)', display: 'flex', justifyContent: 'flex-end' }}>
  <Link
    href={`/agent?q=${encodeURIComponent(`Analyse the ${group.gp_name} ${group.year} weekend — give me the key strategy and performance insights.`)}`}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 14px',
      borderRadius: '999px',
      background: 'rgba(20,35,60,0.06)',
      border: '1px solid rgba(204,218,236,0.88)',
      color: '#14233C',
      fontFamily: 'Inter, sans-serif',
      fontSize: '12px',
      fontWeight: 600,
      textDecoration: 'none',
      transition: 'background 0.15s',
    }}
  >
    <span style={{ fontSize: '14px' }}>✦</span>
    Ask AI about this weekend
  </Link>
</div>
```

---

## Improvement 3 — Session Coverage Indicators

**Goal:** Show which data types are loaded for each session (telemetry, laps, weather,
radio) so users know what to expect before clicking through.

This requires a small backend change (a new lightweight endpoint) and a frontend change
to show the indicators on each session card.

### 3a. Add a coverage endpoint to the backend

**File to modify:** `apps/backend/src/backend/api/v1/sessions.py`

Add this new route after the existing `list_sessions` route. It queries for counts of
rows in the relevant tables for a given session, which tells us what data has been
ingested:

```python
@sessions_bp.get("/sessions/<int:session_key>/coverage")
def get_session_coverage(session_key: int):
    """
    Returns booleans indicating which data types have been ingested
    for this session. Used by the frontend to show coverage indicators.
    """
    with extensions.engine.connect() as conn:
        laps_count = conn.execute(
            text("SELECT COUNT(*) FROM laps WHERE session_key = :sk"),
            {"sk": session_key},
        ).scalar() or 0

        telemetry_count = conn.execute(
            text("SELECT COUNT(*) FROM telemetry WHERE session_key = :sk LIMIT 1"),
            {"sk": session_key},
        ).scalar() or 0

        weather_count = conn.execute(
            text("SELECT COUNT(*) FROM weather WHERE session_key = :sk LIMIT 1"),
            {"sk": session_key},
        ).scalar() or 0

        radio_count = conn.execute(
            text("SELECT COUNT(*) FROM team_radio WHERE session_key = :sk LIMIT 1"),
            {"sk": session_key},
        ).scalar() or 0

    return jsonify({
        "session_key": session_key,
        "has_laps": laps_count > 0,
        "has_telemetry": telemetry_count > 0,
        "has_weather": weather_count > 0,
        "has_radio": radio_count > 0,
    })
```

> **Note:** Check the actual table names in your schema with `make db-shell` and
> `\dt`. Adjust `laps`, `telemetry`, `weather`, `team_radio` to match your real table
> names if they differ.

### 3b. Create a `SessionCoverageIndicators` component

**File to create:** `apps/frontend/components/sessions/SessionCoverageIndicators.tsx`

```tsx
'use client'

import { useEffect, useState } from 'react'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface Coverage {
  has_laps: boolean
  has_telemetry: boolean
  has_weather: boolean
  has_radio: boolean
}

const INDICATORS: { key: keyof Coverage; label: string; short: string }[] = [
  { key: 'has_laps',      label: 'Lap Times',  short: 'Laps' },
  { key: 'has_telemetry', label: 'Telemetry',  short: 'Tel' },
  { key: 'has_weather',   label: 'Weather',    short: 'Wx' },
  { key: 'has_radio',     label: 'Team Radio', short: 'Radio' },
]

export default function SessionCoverageIndicators({
  sessionKey,
  compact = false,
}: {
  sessionKey: number
  compact?: boolean
}) {
  const [coverage, setCoverage] = useState<Coverage | null>(null)

  useEffect(() => {
    fetch(`${BASE}/api/v1/sessions/${sessionKey}/coverage`)
      .then(r => r.ok ? r.json() : null)
      .then(data => data && setCoverage(data))
      .catch(() => {})
  }, [sessionKey])

  if (!coverage) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      {INDICATORS.map(({ key, label, short }) => {
        const loaded = coverage[key]
        return (
          <div
            key={key}
            title={loaded ? `${label} loaded` : `${label} not available`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '999px',
              fontSize: '9px',
              fontFamily: 'JetBrains Mono, monospace',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: loaded ? 'rgba(16,185,129,0.08)' : 'rgba(148,163,184,0.08)',
              border: `1px solid ${loaded ? 'rgba(16,185,129,0.24)' : 'rgba(148,163,184,0.2)'}`,
              color: loaded ? '#059669' : '#94A3B8',
            }}
          >
            <span style={{ fontSize: '8px' }}>{loaded ? '●' : '○'}</span>
            {compact ? short : label}
          </div>
        )
      })}
    </div>
  )
}
```

### 3c. Add the indicators to each session card

**File to modify:** `apps/frontend/app/sessions/page.tsx`

Import the new component at the top of the file:

```tsx
import SessionCoverageIndicators from '@/components/sessions/SessionCoverageIndicators'
```

Then in each weekend card, add the indicators inside the name + metadata section
(around line 333, after the date and session count row):

```tsx
{/* Add this after the date/layers row inside the info div */}
<div style={{ marginTop: '10px' }}>
  <SessionCoverageIndicators
    sessionKey={summary.latest.session_key}
    compact={isMobile}
  />
</div>
```

> **Note:** This shows the coverage for the latest session in the weekend group.
> If you want per-session coverage on the individual session pills at the bottom of
> each card, call `<SessionCoverageIndicators sessionKey={session.session_key} compact />` 
> inside the session pill render loop instead (or in addition).

---

## File Summary

| Action | File |
|--------|------|
| MODIFY | `apps/frontend/app/sessions/page.tsx` |
| MODIFY | `apps/frontend/app/agent/page.tsx` |
| MODIFY | `apps/frontend/app/globals.css` |
| MODIFY | `apps/backend/src/backend/api/v1/sessions.py` |
| CREATE | `apps/frontend/components/sessions/SessionCoverageIndicators.tsx` |

No new npm or Python packages needed.
