# Contributing to Slipstream

Thank you for your interest. This guide gets you from zero to a running dev environment.

## Prerequisites

| Tool   | Version  | Install                                      |
|--------|----------|----------------------------------------------|
| Python | 3.11+    | https://python.org                           |
| uv     | latest   | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node   | 20+      | https://nodejs.org                           |
| pnpm   | latest   | `npm install -g pnpm`                        |
| Docker | latest   | https://docker.com                           |

## Setup
```bash
git clone https://github.com/abdullah-azeemi/Slipstream
cd Slipstream
make install    # installs all Python + JS dependencies
make up         # starts Docker infrastructure
make migrate    # runs database migrations
make seed       # downloads sample F1 session data
```

## Code Standards

**Python**
- Formatter + linter: `ruff` (`uv run ruff check . && uv run ruff format .`)
- Type checker: `mypy --strict` (`uv run mypy apps/ packages/`)
- Tests: `pytest` (`uv run pytest --cov`)
- No `print()` in production code — use `structlog`

**TypeScript**
- Strict mode enabled in `tsconfig.json`
- Formatter: Prettier (`pnpm format`)
- Linter: ESLint (`pnpm lint`)

All PRs must pass CI (lint + type check + tests) before merge.

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add tyre strategy visualisation
fix: correct lap time aggregation during safety car periods  
docs: update API endpoint reference
chore: bump FastF1 to 3.4.0
test: add unit tests for lap time transformer
refactor: extract Kafka producer into shared utility
```

## Branch Naming
```
feat/tyre-strategy-map
fix/lap-aggregation-safety-car
docs/api-reference
chore/bump-dependencies
```

## Pull Request Process

1. Branch from `main`
2. Make your changes with tests
3. Run `make lint && make test` — both must pass
4. Open a PR with a clear description of what and why
5. Reference any related issue with `Closes #123`

## Architecture Decisions

Significant technical decisions are documented as ADRs in `docs/adr/`.
If your PR makes a decision that future contributors would ask "why did they do it this way?",
write an ADR for it.
EOF