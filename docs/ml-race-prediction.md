# ML Race Prediction

Slipstream's ML module predicts race finishing positions from qualifying performance, historical race context, and an optional FP2 strategy signal.

This document answers three practical questions:

1. What session data is required?
2. Which features come from which sessions?
3. What usually breaks locally?

## What the model uses

### Live prediction

For a live prediction on an unseen weekend, the model uses:

- The current qualifying session (`Q`)
- Historical race sessions (`R`) already ingested in the database
- The current weekend's `FP2` if available

It does **not** currently use:

- `FP1`
- `FP3`
- Sprint sessions (`S`, `SQ`)
- The current race session itself

In deployed environments, prediction requests may also trigger model training if no saved model exists yet. This means the first prediction request after a fresh deploy can be slow while the model is built and written to disk.

### Training

For training, Slipstream builds examples from weekends that have:

- one qualifying session (`Q`)
- one race session (`R`)

`FP2` is optional enrichment. If there is no matching FP2 data, the model still trains and uses neutral strategy values.

Model files are stored in `ML_MODELS_DIR` when that environment variable is set, otherwise they default to `./ml_models`.

## Feature to session map

### From the current qualifying session (`Q`)

These are the direct weekend-performance features:

- `grid_position`
- `quali_gap_ms`
- `s1_gap_ms`
- `s2_gap_ms`
- `s3_gap_ms`
- `s1_rank`
- `s2_rank`
- `s3_rank`
- `quali_compound_soft`
- `quali_compound_inter`
- `sector_weakness_score`
- `pole_gap_pct`
- `quali_improvement_q2_q3`

Implementation notes:

- The model takes the fastest qualifying lap per driver.
- `quali_improvement_q2_q3` is derived from the same qualifying session by comparing the driver's best Q2 and Q3 pace.

### From historical race sessions (`R`)

These features give medium-term context:

- `team_recent_avg_finish`
- `team_recent_podium_rate`
- `driver_circuit_avg_finish`
- `driver_circuit_best_finish`

Implementation notes:

- These are computed only from races before the predicted weekend.
- They are designed to capture car form and driver/circuit comfort.

### From the current weekend's FP2

These are strategy-intent features:

- `fp2_hard_laps_pct`
- `fp2_medium_laps_pct`

Implementation notes:

- FP2 is used because it is the most race-representative practice session.
- Missing FP2 data is treated as neutral `0.0` values rather than an error.

### Static circuit context

These flags come from Slipstream's circuit categorisation:

- `is_street_circuit`
- `is_power_circuit`
- `is_high_df_circuit`

## Minimum ingest checklist

### For live predictions

You should ingest:

1. The target weekend's qualifying session
2. Enough historical race sessions to give the model context
3. Optionally the target weekend's FP2

Example:

```bash
uv run python -m ingestion.ingest_session --year 2026 --gp "Australian" --session Q
uv run python -m ingestion.ingest_session --year 2026 --gp "Australian" --session FP2
```

Historical context usually means multiple prior race weekends, not just one current event.

### For training

You should ingest repeated `Q + R` pairs across weekends, and ideally `FP2` as well:

```bash
for year in 2022 2023 2024 2025; do
  for gp in "Australian" "Monaco" "British" "Italian" "Belgian"; do
    uv run python -m ingestion.ingest_session --year $year --gp "$gp" --session Q
    uv run python -m ingestion.ingest_session --year $year --gp "$gp" --session R
    uv run python -m ingestion.ingest_session --year $year --gp "$gp" --session FP2
  done
done
```

### Deployed training behavior

On Railway-style deployments:

- set `ML_MODELS_DIR=/app/ml_models`
- mount persistent storage at `/app/ml_models` if you want models to survive redeploys
- the web service can train on demand when a predictions request arrives and no model file exists yet

This allows deployed predictions to work without a separate always-on ML trainer service, at the cost of a slower first prediction request.

## Common local issues

### `KeyError: 'team_name'` during `uv run python -m ml.train`

Cause:

- there is no FP2 data yet
- the FP2 query returns zero rows

Current behavior:

- this is now handled safely
- FP2 strategy features fall back to neutral values instead of crashing

### `relation "sessions" does not exist`

Cause:

- the app is pointing at a local Postgres database that has no schema yet

Fix:

1. Start local infrastructure
2. Run migrations
3. Ingest at least one session

### Railway password authentication errors during local runs

Cause:

- local `.env` or shell `DATABASE_URL` still points to Railway

Fix:

- use a local database URL for local development and tests
- reserve Railway credentials for deploy, migration, and production ingestion tasks

Example local setting:

```bash
DATABASE_URL=postgresql+psycopg://pitwall:pitwall@localhost:5432/pitwall
```

### MLflow connection errors on Railway

Cause:

- `MLFLOW_TRACKING_URI` points to a server that does not exist in the deployed environment

Current behavior:

- training no longer fails just because MLflow is unavailable
- model files still save locally to `ML_MODELS_DIR`
- MLflow logging is skipped when the tracking server cannot be reached

## Mental model

The current model is essentially:

- `Q` tells us how fast the weekend looks right now
- historical `R` tells us how strong the team and driver have been
- `FP2` hints at Sunday tyre strategy

That keeps the feature set grounded in information that is realistically available before the race starts.
