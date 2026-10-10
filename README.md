# Slipstream

Slipstream is an open-source Formula 1 analytics platform for exploring race
sessions, qualifying telemetry, tyre strategy, and race predictions. It uses
public motorsport data and deterministic analysis tools, with an optional
AI-powered Pitwall agent.

## Start locally

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js 20+,
pnpm 10, and Docker Compose.

```bash
git clone https://github.com/abdullah-azeemi/Slipstream.git
cd Slipstream
make install
make up
make migrate
```

Run the backend and frontend in separate terminals:

```bash
make backend
make frontend
```

The app is at <http://localhost:3000>; the API is at
<http://localhost:8000>. `make seed` loads a small sample dataset. See
[Contributing](CONTRIBUTING.md) for development and test commands.

## Project guides

- [Project overview](docs/project-overview.md): services, data flow, and
  infrastructure.
- [Repository guide](docs/repository.md): folders, commands, and local setup.
- [Pitwall agent](docs/agent.md): agent flow, tools, providers, and safety.

## Stack

- Next.js and TypeScript frontend
- Flask and SQLAlchemy backend
- PostgreSQL/TimescaleDB for session data
- FastF1-based ingestion; XGBoost-based predictions
- OpenRouter for optional agent language-model requests
- Cloudflare R2 and Vectorize for telemetry artifacts and approved strategy
  documents in production

The core analytics do not require an OpenAI API key. The agent requires a
configured OpenRouter key for language-model features. See the
[agent guide](docs/agent.md) for provider and embedding configuration.
