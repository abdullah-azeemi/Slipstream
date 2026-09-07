web: uv run flask --app apps/backend/src/backend run --host 0.0.0.0 --port $PORT
worker: uv run celery --workdir packages/workers -A workers.celery_app worker --loglevel=info --concurrency=2
beat: uv run celery --workdir packages/workers -A workers.celery_app beat --loglevel=info
