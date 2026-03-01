
# =============================================================================

# Pitwall — Developer Commands

# =============================================================================

# Usage: make <command>

# Run `make help` to see all commands.

.PHONY: help install up down logs ps reset migrate seed dev lint test

# Default target

help:

	@echo ""

	@echo "Pitwall — Available Commands"

	@echo "─────────────────────────────────────────"

	@echo "  make install    Install all Python + JS dependencies"

	@echo "  make up         Start all infrastructure (Kafka, DB, Redis, MLflow)"

	@echo "  make down       Stop all infrastructure"

	@echo "  make logs       Tail logs from all services"

	@echo "  make ps         Show running containers and health status"

	@echo "  make reset      DANGER: Stop everything and delete all data"

	@echo "  make migrate    Run database migrations"

	@echo "  make seed       Download sample F1 data (2024 British GP)"

	@echo "  make dev        Start all development servers"

	@echo "  make lint       Run ruff + mypy on all Python code"

	@echo "  make test       Run pytest across all packages"

	@echo "─────────────────────────────────────────"

	@echo ""

# ── Dependencies ──────────────────────────────────────────────────────────────

install:

	uv sync

	cd apps/frontend && pnpm install

# ── Infrastructure ────────────────────────────────────────────────────────────

up:

	docker compose -f infra/docker-compose.yml up -d

	@echo ""

	@echo "Infrastructure started:"

	@echo "   Kafka UI   → http://localhost:8080"

	@echo "   MLflow     → http://localhost:5001"

	@echo "   Postgres   → localhost:5432"

	@echo "   Redis      → localhost:6379"

	@echo ""

	@echo "Run 'make ps' to check health status."

down:

	docker compose -f infra/docker-compose.yml down

logs:

	docker compose -f infra/docker-compose.yml logs -f

ps:

	docker compose -f infra/docker-compose.yml ps

reset:

	@echo " This will DELETE all data (database, kafka, redis). Are you sure?"

	@read -p "Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ]

	docker compose -f infra/docker-compose.yml down -v

	@echo "All data wiped."

# ── Database ──────────────────────────────────────────────────────────────────

migrate:

	uv run alembic -c apps/backend/alembic.ini upgrade head

seed:

	uv run python scripts/seed_sample_data.py

# ── Development ───────────────────────────────────────────────────────────────

dev:

	@echo "Starting development servers..."

	@echo "Backend  → http://localhost:5000"

	@echo "Frontend → http://localhost:3000"

# ── Code Quality ──────────────────────────────────────────────────────────────

lint:

	uv run ruff check apps/ packages/

	uv run ruff format --check apps/ packages/

lint-fix:

	uv run ruff check --fix apps/ packages/

	uv run ruff format apps/ packages/

type-check:

	uv run mypy apps/ packages/

test:

	uv run pytest apps/ packages/ -v --cov --cov-report=term-missing

# ── Utilities ─────────────────────────────────────────────────────────────────

# Connect to the database directly (useful for debugging)

db-shell:

	docker exec -it pitwall-timescaledb psql -U pitwall -d pitwall

# Open a Redis CLI session

redis-shell:

	docker exec -it pitwall-redis redis-cli

topics :

	@bash infra/kafka/create-topics.sh
