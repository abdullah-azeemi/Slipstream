# Pitwall

**Open-source F1 post-race analytics platform.**

Qualifying telemetry, tyre strategy, lap-by-lap breakdowns, and ML-powered race predictions — all from public data, zero paid APIs.

![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square)
![Flask](https://img.shields.io/badge/Flask-3-lightgrey?style=flat-square)
![TimescaleDB](https://img.shields.io/badge/TimescaleDB-PostgreSQL-orange?style=flat-square)
![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)

---

## What it does

| Feature | Description |
|---|---|
| **Session leaderboard** | Fastest laps, gaps to pole, tyre compounds per driver |
| **Speed traces** | Distance-aligned telemetry overlay for up to 4 drivers — throttle, brake, DRS, gear, mini-sectors, track map |
| **Tyre strategy** | Stint Gantt chart with pit stop timing and race position evolution |
| **Driver comparison** | Head-to-head sector analysis with theoretical best lap |
| **Race predictions** | FLAML AutoML model trained on 5 circuits × 4 years — predicts finishing order from qualifying with win probabilities and SHAP explanations |

---

## Stack

```
Frontend    Next.js 14 (App Router) + Tailwind CSS
Backend     Flask 3 + SQLAlchemy + Flask-SocketIO
Database    TimescaleDB (PostgreSQL) + Redis
ML          FLAML AutoML + XGBoost + SHAP
Data        FastF1 + OpenF1 + Jolpica
Streaming   Apache Kafka + Quix Streams
Infra       Docker Compose — zero paid services
Package mgr uv workspaces (monorepo)
```

---

## Project structure

```
pitwall/
├── apps/
│   ├── backend/                  # Flask API
│   │   ├── src/backend/
│   │   │   ├── api/v1/           # sessions, laps, drivers, strategy, telemetry, predictions
│   │   │   ├── config.py
│   │   │   ├── extensions.py
│   │   │   └── health.py
│   │   ├── migrations/           # Alembic (0001→0007)
│   │   └── tests/                # 23 pytest tests
│   └── frontend/                 # Next.js app
│       ├── app/
│       │   ├── page.tsx                        # Home
│       │   ├── sessions/page.tsx               # Session list
│       │   ├── sessions/[key]/page.tsx         # Leaderboard
│       │   ├── sessions/[key]/strategy/        # Tyre strategy
│       │   ├── sessions/[key]/telemetry/       # Speed traces
│       │   ├── compare/page.tsx               # Driver comparison
│       │   └── predictions/page.tsx           # ML predictions
│       ├── lib/api.ts
│       └── types/f1.ts
├── packages/
│   ├── ingestion/                # FastF1 → TimescaleDB pipeline
│   │   └── src/ingestion/
│   │       ├── fastf1_client.py
│   │       ├── loader.py         # DELETE-then-INSERT (hypertable safe)
│   │       ├── models.py         # Pydantic v2 validators
│   │       └── ingest_session.py
│   ├── ml/                       # FLAML AutoML pipeline
│   │   └── src/ml/
│   │       ├── features.py       # Feature engineering
│   │       ├── train.py          # Training + cross-validation
│   │       ├── predict.py        # Inference + Monte Carlo simulation
│   │       └── explain.py        # SHAP factor extraction
│   └── stream/                   # Kafka live streaming (WIP)
├── infra/
│   ├── docker-compose.yml
│   ├── kafka/create-topics.sh
│   └── postgres/init.sql
├── pyproject.toml                # uv workspace root
└── Makefile
```

---

## Quickstart

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [uv](https://docs.astral.sh/uv/) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- [Node.js 20+](https://nodejs.org/) + [pnpm](https://pnpm.io/) — `npm i -g pnpm`

### 1. Clone and configure

```bash
git clone https://github.com/your-username/pitwall.git
cd pitwall
cp .env.example .env
```

### 2. Start infrastructure

```bash
make up
```

This starts TimescaleDB, Redis, Kafka, and MLflow. Wait ~15 seconds for TimescaleDB to initialise.

### 3. Run database migrations

```bash
make migrate
```

### 4. Ingest your first session

```bash
# 2024 British GP qualifying — downloads and caches via FastF1
uv run python -m ingestion.ingest_session --year 2024 --gp British --session Q

# 2024 British GP race (skip telemetry for speed)
uv run python -m ingestion.ingest_session --year 2024 --gp British --session R --skip-telemetry
```

FastF1 caches session data locally at `~/Library/Caches/fastf1` — subsequent runs are instant.

### 5. Start the backend

```bash
make backend
# API running at http://localhost:8000
```

### 6. Start the frontend

```bash
cd apps/frontend
pnpm install
pnpm dev
# App running at http://localhost:3000
```

---

## Loading more data

The ML predictions model improves significantly with more circuits. To replicate the full training dataset (5 circuits × 4 years):

```bash
# Run for each combination of year (2022-2025) and circuit
uv run python -m ingestion.ingest_session --year 2023 --gp Monaco   --session Q
uv run python -m ingestion.ingest_session --year 2023 --gp Monaco   --session R --skip-telemetry
uv run python -m ingestion.ingest_session --year 2023 --gp Italian  --session Q
uv run python -m ingestion.ingest_session --year 2023 --gp Italian  --session R --skip-telemetry
# ... etc
```

Supported `--gp` values: `British`, `Monaco`, `Italian`, `Spanish`, `Belgian` (and any other FastF1-supported grand prix name).

---

## Training the ML model

Once you have qualifying + race pairs loaded:

```bash
uv run python -m ml.train
```

Output:
```
Shape: (385, 19)
MAE:            2.49 ± 0.32 positions
Top-3 accuracy: 58.3%
Best algorithm: extra_tree (selected by FLAML AutoML)

✅  Model saved → ml_models/race_predictor.pkl
```

The model uses leave-one-year-out cross-validation — it never trains on future data to predict past data.

### How predictions work

1. **Features** are engineered from qualifying: grid position, gap to pole, sector time gaps and ranks, tyre compound, circuit type (street / power / mixed)
2. **FLAML AutoML** tries XGBoost, LightGBM, ExtraTree, RandomForest and selects the best by MAE
3. **Monte Carlo simulation** (1000 runs with gaussian noise) converts point predictions into probability distributions
4. **SHAP values** explain the top 3 factors driving each driver's prediction

---

## API reference

Base URL: `http://localhost:8000`

```
GET  /health
GET  /api/v1/sessions
GET  /api/v1/sessions/:key
GET  /api/v1/sessions/:key/drivers
GET  /api/v1/sessions/:key/drivers/compare?drivers=44,63
GET  /api/v1/sessions/:key/laps
GET  /api/v1/sessions/:key/laps?driver=44
GET  /api/v1/sessions/:key/fastest
GET  /api/v1/sessions/:key/strategy
GET  /api/v1/sessions/:key/race-order
GET  /api/v1/sessions/:key/telemetry/compare?drivers=44,63
GET  /api/v1/sessions/:key/telemetry/:driver_number
GET  /api/v1/sessions/:key/predict
POST /api/v1/sessions/:key/predict/simulate
```

### What-If simulator

```bash
curl -X POST http://localhost:8000/api/v1/sessions/9554/predict/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "grid_overrides": {"44": 1, "63": 2},
    "weather": "wet",
    "safety_car": "high"
  }'
```

---

## Development

```bash
make up          # start Docker services
make down        # stop Docker services
make migrate     # run Alembic migrations
make backend     # start Flask dev server (port 8000)
make test-backend # run pytest (23 tests)
make db-shell    # psql into TimescaleDB
```

### Running tests

```bash
uv run pytest apps/backend/tests/ -v
```

### Environment variables

Copy `.env.example` to `.env`. Key variables:

```bash
DATABASE_URL=postgresql+psycopg://pitwall:pitwall@localhost:5432/pitwall
REDIS_URL=redis://localhost:6379/0
KAFKA_BOOTSTRAP_SERVERS=localhost:9092
MLFLOW_TRACKING_URI=http://localhost:5001
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Design decisions

**TimescaleDB over plain PostgreSQL** — `lap_times` and `telemetry` are hypertables partitioned by time. This makes range queries over multi-season data fast without manual partitioning.

**DELETE-then-INSERT over ON CONFLICT** — TimescaleDB hypertables require the partition key (`recorded_at`) in any unique constraint. Since we don't want time-based deduplication, we DELETE all rows for a session before re-inserting. Ingestion is idempotent and safe to rerun.

**Distance-aligned telemetry** — two drivers' fastest laps have different sample counts (FastF1 samples at ~10Hz per car, actual count varies). We interpolate both to 300 evenly-spaced distance points before rendering, so the speed trace overlay is spatially correct.

**FLAML AutoML** — rather than picking an algorithm upfront, FLAML tries the full candidate set (XGBoost, LightGBM, ExtraTree, RandomForest) within a time budget and returns the best. The winning algorithm has changed across training runs as data volume grew.

**Leave-one-year-out CV** — standard k-fold would leak future race results into training (e.g. training on 2024 data to predict a 2023 race). LYOCV ensures the test set is always chronologically after the training set.

---

## Roadmap

- [ ] What-If simulator UI — drag grid positions, toggle weather, rerun inference
- [ ] Celery workers — async ingestion triggered via API
- [ ] Live mode — OpenF1 streaming during race weekends via Kafka
- [ ] More circuits — Suzuka, Singapore, Interlagos
- [ ] Driver historical features — DNF rate, wet weather performance
- [ ] Deployment guide — Docker Compose on a VPS

---

## Data sources

- **[FastF1](https://github.com/theOehrly/Fast-F1)** — timing, telemetry, tyre data
- **[OpenF1](https://openf1.org/)** — live timing API
- **[Jolpica](https://jolpi.ca/)** — Ergast-compatible historical data

All data is sourced from public APIs. Pitwall stores processed data locally in TimescaleDB — no data is redistributed.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

## Contributing

Issues and PRs welcome. If you load sessions for circuits not listed here and hit ingestion errors, please open an issue with the error and the circuit name — compound constraint violations are the most common cause and easy to fix.