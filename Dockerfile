# syntax=docker/dockerfile:1

# ── Base Stage: System Runtime Dependencies ──────────────────────────
FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/packages/ingestion/src:/app/packages/ml/src"

# Runtime shared libs needed by scikit-learn / lightgbm / xgboost (OpenMP)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        libstdc++6 \
        zlib1g \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app


# ── Builder Stage: Dependency Resolution & Wheel Compilation ────────
FROM base AS builder

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

COPY --from=ghcr.io/astral-sh/uv:0.10.7 /uv /uvx /bin/

# Copy workspace configuration & package sources
COPY pyproject.toml uv.lock ./
COPY apps/ apps/
COPY packages/ packages/

# Sync only required packages for web API & AI Agent (omits kafka stream and celery workers)
RUN uv sync --no-dev \
    --package slipstream-backend \
    --package ml \
    --package slipstream-ingestion \
    --package slipstream-config \
    --no-cache \
    && find /app/.venv -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true \
    && find /app/.venv -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true


# ── Development Stage (Optional Target) ─────────────────────────────
# Can be run locally via: docker build --target development -t pitwall:dev .
FROM builder AS development

ENV FLASK_ENV=development \
    FLASK_DEBUG=1

EXPOSE 8080

CMD ["flask", "--app", "backend:create_app", "run", "--host", "0.0.0.0", "--port", "8080", "--debug"]


# ── Production Stage (Default / Lean Runtime for Fly.io) ─────────────
FROM base AS production

# Copy compiled virtualenv and application packages from builder
COPY --from=builder /app/.venv /app/.venv
COPY apps/backend /app/apps/backend
COPY packages/config /app/packages/config
COPY packages/ml /app/packages/ml
COPY packages/ingestion /app/packages/ingestion

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "120", "--graceful-timeout", "30", "--worker-tmp-dir", "/dev/shm", "--access-logfile", "-", "--error-logfile", "-", "backend:create_app()"]
