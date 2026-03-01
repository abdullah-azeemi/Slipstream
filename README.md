# Pitwall 🏎️

> Open-source F1 analytics platform. Post-race intelligence, ML-powered race predictions, and driver performance analysis — surfacing the data that never makes it onto the broadcast.

**Status:** 🚧 Active development — not yet production ready

---

## What is Pitwall?

After every race or qualifying session, Pitwall automatically:

- Analyses lap data, tyre strategies, pace evolution, and sector deltas
- Trains ML models on 4 years of GP-specific historical data to predict race outcomes
- Compares driver telemetry: braking points, cornering speed, throttle application, consistency
- Surfaces anomalies: pace drops, tyre cliffs, strategy divergences — in plain language

## Stack

| Layer          | Technology                          |
|----------------|-------------------------------------|
| Backend        | Flask + Celery + Flask-SocketIO     |
| Frontend       | Next.js 14 (App Router)             |
| Streaming      | Apache Kafka + Quix Streams         |
| Database       | TimescaleDB + PostgreSQL + Redis    |
| ML             | FLAML AutoML + XGBoost + SHAP       |
| Data Sources   | FastF1 + OpenF1 + Jolpica           |
| Infra          | Docker Compose (zero paid services) |

## Quickstart

> Prerequisites: Docker, Python 3.11+, Node.js 20+, uv, pnpm
```bash
# 1. Clone
git clone https://github.com/abdullah-azeemi/Pitwall && cd Pitwall

# 2. Install all dependencies
make install

# 3. Copy environment template
cp .env.example .env

# 4. Start infrastructure (Kafka, TimescaleDB, Redis)
make up

# 5. Run database migrations
make migrate

# 6. Seed sample data (downloads 2024 British GP via FastF1)
make seed

# 7. Start all dev servers
make dev
```

Open:
- Frontend → http://localhost:3000
- Backend API → http://localhost:5000
- Kafka UI → http://localhost:8080
- MLflow → http://localhost:5001

## Project Structure
```
Pitwall/
├── apps/
│   ├── backend/        # Flask API + WebSocket + Celery
│   ├── frontend/       # Next.js application
│   └── ml/             # ML training pipeline + model serving
├── packages/
│   ├── ingestion/      # FastF1 + Jolpica + OpenF1 pollers
│   └── stream/         # Quix Streams processors
├── infra/
│   └── docker-compose.yml
├── docs/
│   └── adr/            # Architecture Decision Records
└── Makefile
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues are labelled in GitHub.

## License

Apache 2.0 — see [LICENSE](LICENSE).
EOF