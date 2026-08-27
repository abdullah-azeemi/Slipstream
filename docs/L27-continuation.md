# L27 — Rich Telemetry, Circuit & Tyre-Degradation Visualizations (COMPLETE)

Status: **done**. Backend + frontend. Backend: ruff clean, `pytest apps/backend/`
119/119 passing (+2). Frontend: `pnpm lint` clean, `pnpm test` 30/30 passing
(+6 new `chart-data` tests), `pnpm build` compiles and typechecks.

This file records the delivery. Code lives across `apps/backend/src/backend/agent/`
(`types.py`, `tools.py`, `orchestrator.py`) and `apps/frontend` (`types/agent.ts`,
`lib/chart-data.ts`, `components/agent/{TelemetryOverlayChart,CircuitHeatmap,TyreDegradationChart}.tsx`,
`app/agent/page.tsx`). Tests in `apps/backend/tests/test_agent_tools.py`,
`apps/backend/tests/test_agent_dag.py`, `apps/frontend/lib/chart-data.test.ts`.

## What was built

The agent debrief now embeds live charts straight from orchestrator evidence —
per `docs/agent-architecture-v1.md` §7.

### Part 1 — Backend evidence payload

- `types.py`: new `StintLapPoint(lap_number, tyre_age, lap_time_ms)`; `StintSummary`
  gained `laps: tuple[StintLapPoint, ...] = ()` (forward-referenced); `AgentAnswer`
  gained `telemetry_overlay: TelemetryInspectorResult | None` and
  `stint_degradation: StintDegradationResult | None`.
- `tools.py` `_compute_stint_degradation`: every *clean* lap now emits a scatter
  point — `tyre_age` is 1-based position within the stint
  (`lap_number - start_lap + 1`), so pit in/out laps stay excluded from the chart.
- `orchestrator.py` `_compose`: `telemetry_overlay=outputs.get("telemetry")` and
  `stint_degradation=outputs.get("stints")` ride on the composed `AgentAnswer`.
  Because the API serialises with `asdict`, the `final` SSE payload now contains
  the full resampled lap channels and per-stint lap series — no extra round-trip.
- Tests: `test_compute_stint_degradation_carries_lap_points` (lap order + tyre_age
  + pit-lap exclusion) and `test_compose_carries_chart_payloads` (payload fields
  come straight from node outputs).

### Part 2 — Frontend types

`types/agent.ts` mirrors the two payload shapes (`TelemetryInspectorResult` /
`TelemetryLapTrace` / `TelemetrySamplePoint` and `StintDegradationResult` /
`StintSummary` / `StintLapPoint`) and `AgentAnswer` gains `telemetry_overlay?` and
`stint_degradation?`.

### Part 3 — Pure chart helpers (`lib/chart-data.ts`)

- `normalizeCircuitPoints(samples)` → aspect-preserving `(x,y)` box + SVG polyline
  path; `null` when fewer than two xy pairs exist (drawing code never crashes).
- `speedGradientColor(speed, max)` → slow red (`#E8002D`) → gold (`#FFD700`) →
  fast green (`#2CF4C5`) two-segment lerp; emerald fallback on unknown max.
- `degradationFit(stint)` → projects the OLS fit onto the tyre-age axis
  (`y(age) = alpha + beta * (start_lap - 1 + age)`), endpoints only for a dashed
  overlay line; `null` when no scatter points.

### Part 4 — Components

- `TelemetryOverlayChart` — light reply-card header (title + Per-driver·Lap legend
  chips) over a dual-lap **speed overlay** on a shared lap-distance X axis, then
  four synchronized mini channels (throttle %, brake on/off, gear 1–8, DRS 0/1)
  for the primary trace, all recharts `LineChart`s with `domain=[0, dataMax]`.
- `CircuitHeatmap` — dark `#0d0d0d` SVG stage: track polyline with one segment
  stroke per sample colored by `speedGradientColor`, red braking dots (≤80),
  white start marker, and a red→gold→green gradient legend showing min/max km/h.
- `TyreDegradationChart` — recharts `ComposedChart`: per-stint `Scatter` of
  lap-time vs tyre-age, dashed OLS fit `Line` per stint, red dashed `ReferenceLine`
  at the cliff-lap age, and a "worst S2 HARD +0.20s/lap" chip in the header.

### Part 5 — Wiring

`app/agent/page.tsx` renders all three components inside each reply card right
after `AgentSpeedChart`; each returns `null` when its payload is absent, so
pit-stop / lap-event answers ignore them.
- `TelemetryOverlayChart result={turn.reply.telemetry_overlay}` (telemetry mirrors/cmp)
- `CircuitHeatmap result={turn.reply.telemetry_overlay}`
- `TyreDegradationChart result={turn.reply.stint_degradation}`

## Contract notes

- The chart payload only lands once the `final` SSE event streams (it lives on
  `reply.telemetry_overlay` / `reply.stint_degradation`), unlike node states which
  update live during the run.
- `x_pos` / `y_pos` aren't guaranteed per artifact; `CircuitHeatmap` picks the
  first trace that has them and renders nothing otherwise.
- `StintSummary.laps` still follows the OLS "clean lap" filter — the fit line and
  the scatter points are therefore always consistent.

## Decisions / deviations worth remembering

- Chart data travels inside `AgentAnswer` (via `asdict`) rather than a separate
  `chart_data` key — simpler, single round-trip, matches the existing
  `speed_window` pattern.
- `Scan per: curve recharts` — no new dependency; `recharts` was already in
  `apps/frontend/package.json`. The circuit map is hand-rolled SVG.
- Kept the mini channel charts compressed (`left: -18` margins) so the overlay +
  all four channels fit in one card without scrolling on desktop.
- recharts v3 `Tooltip` `formatter` value is typed `ValueType | undefined` — use
  `Number(value ?? 0)` / `String(value)` rather than narrowing.

## Verify

```bash
# backend
uv run ruff check apps/backend/src apps/backend/tests
uv run pytest apps/backend/ -q        # 119 passed

# frontend
cd apps/frontend
pnpm lint
pnpm test      # 30 passed (6 new chart-data tests)
pnpm build
```

Live check: backend at localhost:5432 (Postgres via `pg_ctl` or Docker
timescaledb) + Flask, `pnpm dev`. A tyre question ("tyre degradation data for
Sainz at Monaco 2026") renders the scatter chart; a telemetry comparison ("compare
telemetry lap 34 Leclerc vs Sainz Monaco 2026") renders overlay + heatmap.

## Next steps

- Commit message used: `feat(agent): wire rich telemetry, circuit heatmap and tyre-degradation charts`
- `docs/agent-architecture-v1.md` L27 progress tick + "Next" section updated
  (v1 feature cap reached; §8 L23–L27 complete).
- Optional stretch material: LLM-generated DAGs (§4.1), chart persistence with
  conversations (L16 stores text only), SSE `done` terminal event.