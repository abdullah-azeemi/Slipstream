# syntax=docker/dockerfile:1

# Production image for the Pitwall Flask API, built for Fly.io.
# Serves the backend and (optionally) the auto-ingest thread; heavy
# ingestion / ML training runs out-of-band (GitHub Actions cron).

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

# Runtime shared libs needed by scikit-learn / lightgbm / xgboost (OpenMP).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        libstdc++6 \
        zlib1g \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# uv (pinned to match the local toolchain).
COPY --from=ghcr.io/astral-sh/uv:0.10.7 /uv /uvx /bin/

WORKDIR /app

# uv installs every workspace member (backend, ingestion, ml, ...) as editable.
COPY pyproject.toml uv.lock ./
COPY apps/ apps/
COPY packages/ packages/

RUN uv sync --frozen --no-dev --all-packages

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/packages/ingestion/src:/app/packages/ml/src:/app/packages/workers/src"

EXPOSE 8080

# One worker only: the Flask app can spawn a background auto-ingest thread,
# so forking multiple workers would duplicate that work. Threads handle
# concurrency instead.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "4", "--timeout", "120", "--graceful-timeout", "30", "--worker-tmp-dir", "/dev/shm", "--access-logfile", "-", "--error-logfile", "-", "backend:create_app()"]
