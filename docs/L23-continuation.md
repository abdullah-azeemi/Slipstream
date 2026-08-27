# L23 — Expanded Tool Registry (COMPLETE)

Status: **done**. 106/106 backend tests passing, ruff + ruff format clean.

This file replaces the older "continuation" style notes. The actual code lives in
`apps/backend/src/backend/agent/tools.py`, types in `agent/types.py`, tests in
`apps/backend/tests/test_agent_tools.py`.

## What was built

Three new tools on top of L22, wired via `docs/agent-architecture-v1.md`:

- `inspect_lap_events` — gathers every lap for a driver (SQL joins `lap_times` +
  `sessions.rainfall`), computes clean median pace, flags laps >3s off-pace and
  classifies the cause: `pit_stop`, `rain_onset`, `yellow_flag_vsc`, `unknown_slowlap`.
- `stint_degradation_scanner` — groups laps by stint, fits an OLS regression
  `LapTime(n) = alpha + beta*n`, detects a "cliff" (one lap >2.5σ off the clean
  trend, min 1.2s residual), returns one `StintSummary` per stint plus the worst.
- `telemetry_inspector` — reads full channel data (speed/throttle/brake/gear/drs/xy)
  from the artifact (parquet or json.gz, local or R2), resamples each lap to
  ≤`max_samples_per_lap` points, computes `full_throttle_pct` +
  `heavy_braking_zones_count`, and a `speed_delta_apex_kmh` between two laps.

Helpers (pure, unit-tested): `_detect_lap_anomalies`, `_find_cliff_lap`,
`_compute_stint_degradation`, `_read_artifact_full_channels` (+ `_parquet_rows`),
`_to_sample_point`, `_resample_telemetry`, `_compute_trace_stats`.

## Contract notes (types.py)

- `LapEvent` carries `is_anomaly` + `anomaly_reason`; reasons are exactly:
  `pit_stop`, `rain_onset`, `yellow_flag_vsc`, `unknown_slowlap`.
- `StintSummary` uses `initial_pace_ms`, `degradation_slope_ms_per_lap`,
  `cliff_lap`; results use `anomaly_count` / `worst_degradation_stint`.
- `TelemetryInspectorInput.lap_numbers`, `TelemetryLapTrace.driver_abbreviation: str`.

## Decisions / deviations worth remembering

- `clean` lap filter drops in/out-lap rows ONLY via `pit_in_time_ms` /
  `pit_out_time_ms` markers — NOT the old `lap_number != 1` heuristic. Lap 1 of a
  stint is legitimate data (no pit marker at race start).
- SQL selects `l.s1_ms AS sector1_ms` etc. — `lap_times` columns are `s1_ms/s2_ms/s3_ms`.
- `_detect_lap_anomalies` returns NEW `LapEvent`s (never mutates input) so it stays
  a pure function.
- `_resample_telemetry` picks the sample nearest each uniform distance stride and
  always appends the last sample (first+last preserved, ≤ `max_points`).
- `_compute_stint_degradation` requires ≥2 clean laps per stint, ≥3 for a cliff verdict.

## Verify

```bash
uv run ruff check apps/backend/src/backend/agent apps/backend/tests/test_agent_tools.py
uv run ruff format --check apps/backend/src/backend/agent apps/backend/tests/test_agent_tools.py
uv run pytest apps/backend/tests -q   # 106 passed
```

Postgres must be up on `localhost:5432` (tests create tables via the conftest).
Note: `brew services` is currently broken; start it directly with
`pg_ctl -D /opt/homebrew/var/postgresql@18 -l /opt/homebrew/var/log/postgresql@18.log start`.

## Next steps

- Commit this work (message suggestion):
  `feat(agent): add inspect_lap_events, stint_degradation_scanner, telemetry_inspector tools`
- Update `docs/agent-architecture-v1.md` L23 progress tick.
- Review the pre-existing uncommitted `agent/llm.py` diff (router prompt simplification)
  — unrelated to L23, decide whether to keep or drop.
- Next lesson: L24 dynamic DAG planner.