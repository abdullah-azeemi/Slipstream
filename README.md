# Pitwall

**Open-source F1 post-race analytics platform.**

Qualifying telemetry, corner analysis, race intelligence, practice data, ML predictions — all from public data, zero paid APIs.

![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square)
![Flask](https://img.shields.io/badge/Flask-3-lightgrey?style=flat-square)
![TimescaleDB](https://img.shields.io/badge/TimescaleDB-PostgreSQL-orange?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.11-blue?style=flat-square)
![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)

---

## What it does

### Qualifying — Full Telemetry Lab
Distance-aligned telemetry overlay for up to 4 drivers across Q1/Q2/Q3 segments. Speed, throttle, brake, gear, RPM, speed delta, and an interactive track map. Hover any point to see all drivers' values simultaneously via a live instrumentation cluster.

**Corner Analysis** — FastF1 official corner positions used as ground truth. Braking distance, deceleration rate, throttle application point, and exit speed compared at each real braking corner. Rules-based insight engine generates CRITICAL/NOTABLE findings automatically.

**Speed Trap Analysis** — FIA timing point speeds (I1, I2, FL, ST) per driver on best lap. Lap progression chart showing improvement across the session. Identifies low-drag vs high-downforce setup philosophy from straight-line speed data.

### Race — Lap-by-Lap Intelligence
- **Lap time evolution** — every lap as a time series, compound-coloured dots, shared crosshair across charts
- **Position changes** — full field battle chart, interactive with lap-by-lap position tooltip
- **Stint pace** — clean lap averages + degradation rate (ms/lap) per stint, outlier-filtered

### Practice — Friday Intelligence
- **Long run pace** — stints >=5 laps with linear degradation trend
- **Tyre degradation rate** — ms/lap per compound per driver + compound averages

### ML Predictions
XGBoost model trained on 461 rows across 5 seasons. FLAML AutoML feature selection. Monte Carlo simulation for win/podium probabilities. SHAP explanations per driver.

**Statistically validated:** Permutation test p=0.000 confirms features carry genuine predictive signal. SHAP analysis: grid position (35%), sector gaps (17%), team/driver context (15%). Grid position matters 2x more for frontrunners (SHAP=4.22) vs midfield (1.86).

### Championship Standings
Live driver and constructor standings from the official Jolpica F1 API. No ingestion needed.

---

## Stack

```
Frontend    Next.js 14 (App Router) — inline styles, Space Grotesk/Inter/JetBrains Mono
Backend     Flask 3 + SQLAlchemy + FastF1 (circuit ground truth)
Database    TimescaleDB (PostgreSQL 15) + Redis
ML          FLAML AutoML + XGBoost + SHAP + scipy (statistical validation)
Data        FastF1 + Jolpica (official F1 standings)
Streaming   Apache Kafka (infrastructure ready)
Infra       Docker Compose — zero paid services
Package mgr uv workspaces (Python monorepo)
```

---

## Project structure

```
pitwall/
├── apps/
│   ├── backend/src/backend/
│   │   ├── __init__.py          ← Flask app factory
│   │   └── api/v1/
│   │       ├── sessions.py      ← sessions, race-results, standings
│   │       ├── laps.py
│   │       ├── drivers.py
│   │       ├── telemetry.py
│   │       ├── strategy.py
│   │       ├── analysis.py      ← all analysis + corner detection
│   │       └── predictions.py
│   └── frontend/
│       ├── app/
│       │   ├── page.tsx             ← Home + standings
│       │   ├── sessions/page.tsx    ← Session browser
│       │   ├── sessions/[key]/      ← Session detail + telemetry + strategy
│       │   └── predictions/page.tsx ← ML predictions + SHAP
│       └── components/analysis/
│           ├── RaceAnalysis.tsx
│           ├── PracticeAnalysis.tsx
│           ├── BrakingAnalysis.tsx
│           ├── CornerInsights.tsx
│           └── QualiSpeedPanel.tsx
├── packages/
│   ├── ingestion/src/ingestion/
│   │   ├── ingest_session.py
│   │   ├── fastf1_client.py     ← extracts SpeedI1/I2/FL/ST
│   │   └── loader.py
│   └── ml/src/ml/
│       ├── features.py          ← 22-feature matrix builder
│       ├── train.py             ← FLAML AutoML, leave-one-year-out CV
│       └── predict.py           ← Monte Carlo + SHAP
├── infra/docker-compose.yml
├── pyproject.toml
└── Makefile
```

---

## Quickstart

**Prerequisites:** [Docker Desktop](https://www.docker.com/products/docker-desktop/), [uv](https://docs.astral.sh/uv/), Node.js 20+ + pnpm

```bash
git clone https://github.com/abdullah-azeemi/Pitwall.git
cd Pitwall
cp .env.example .env

make up          # start TimescaleDB, Redis, Kafka, MLflow
make backend     # Flask on :8000
cd apps/frontend && pnpm install && pnpm dev   # Next.js on :3000

# Ingest your first session
uv run python -m ingestion.ingest_session --year 2026 --gp "Australian" --session Q
uv run python -m ingestion.ingest_session --year 2026 --gp "Australian" --session R
```

---

## Loading historical data

```bash
for year in 2022 2023 2024 2025; do
  for gp in "Australian" "Monaco" "British" "Italian" "Belgian"; do
    uv run python -m ingestion.ingest_session --year $year --gp "$gp" --session Q
    uv run python -m ingestion.ingest_session --year $year --gp "$gp" --session R
  done
done
```

Storage: ~200MB for 5 circuits x 4 seasons (lap times). Telemetry ~50MB per qualifying session.

---

## API reference

```
GET /health

GET /api/v1/sessions
GET /api/v1/sessions/:key
GET /api/v1/sessions/:key/race-results
GET /api/v1/sessions/:key/fastest
GET /api/v1/sessions/:key/strategy
GET /api/v1/standings/drivers?year=2026
GET /api/v1/standings/constructors?year=2026

GET /api/v1/sessions/:key/telemetry/compare?drivers=12,63
GET /api/v1/sessions/:key/telemetry/stats?drivers=12,63

GET /api/v1/sessions/:key/analysis/lap-evolution?drivers=12,63
GET /api/v1/sessions/:key/analysis/position-changes
GET /api/v1/sessions/:key/analysis/stint-pace
GET /api/v1/sessions/:key/analysis/long-runs
GET /api/v1/sessions/:key/analysis/tyre-deg
GET /api/v1/sessions/:key/analysis/driver-compare-stats?drivers=63,12
GET /api/v1/sessions/:key/analysis/quali-speed

GET /api/v1/sessions/:key/predictions
GET /api/v1/predictions/latest
```

---

## Corner detection

Corner positions come from FastF1 `get_circuit_info()` — not inferred from speed traces. For each official corner the algorithm maps its X/Y to a track distance via reference lap telemetry, filters to corners with speed <200 km/h AND brake samples >0, then finds each driver's apex as the minimum-speed sample within +-100m. Results: Melbourne = 4 corners (T1, T3, T11, T13), Monaco = 7. Corner data is cached in memory after first load (~5s).

---

## ML results

| Metric | Value |
|--------|-------|
| Training rows | 461 (5 seasons, 5 circuits) |
| Model | XGBoost via FLAML AutoML |
| MAE | 3.620 +- 0.472 positions |
| 95% Bootstrap CI | [3.352, 3.905] |
| Permutation test p | 0.000 ✅ |
| Top SHAP feature | grid_position — 2.56 pos avg impact |

Features predict absolute finish order (p=0.000) but not position change from grid (p=0.704) — race deltas are driven by stochastic events not captured in qualifying data.

---

## Dev commands

```bash
make up / make down       # Docker services
make backend              # Flask :8000
make test                 # pytest (23 tests)
make db-shell             # psql
lsof -ti:8000 | xargs kill -9   # kill stuck port
```

---

## Roadmap

- [ ] Gap to leader + undercut analysis (race panels)
- [ ] ML Phase 3 — circuit stratification experiment
- [ ] Probability calibration — Brier score
- [ ] LLM commentary on insight JSON
- [ ] Auto-ingest new 2026 race weekends
- [ ] Live mode via OpenF1 + Kafka

---

## Data sources

- **[FastF1](https://github.com/theOehrly/Fast-F1)** — timing, telemetry, circuit info
- **[OpenF1](https://openf1.org/)** — live timing (roadmap)
- **[Jolpica](https://jolpi.ca/)** — official F1 standings

All data from public APIs. No data redistributed.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)., 
