"""
Backend configuration via pydantic-settings.
Reads from environment variables. Falls back to .env file locally.
"""

from __future__ import annotations
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Flask
    secret_key: str = "dev-secret-change-in-production"
    debug: bool = False
    testing: bool = False

    # Database — Railway injects DATABASE_URL as postgres:// so we normalise it
    database_url: str = "postgresql+psycopg://pitwall:pitwall@localhost:5432/pitwall"

    # Redis + Kafka — optional, not required for core app
    redis_url: str = "redis://localhost:6379/0"
    kafka_bootstrap_servers: str = "localhost:9092"

    # MLflow
    mlflow_tracking_uri: str = "http://localhost:5001"

    # Raw telemetry artifacts. In cheap hosted deployments, Postgres stores
    # only metadata while compressed lap traces live outside the DB.
    telemetry_artifact_dir: str = "./telemetry_artifacts"
    telemetry_artifact_backend: str = "local"
    telemetry_artifact_bucket: str = ""
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""

    race_vector_index_dir: str = "./lancedb"
    race_vector_table: str = "race_intelligence_events"

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_routing_model: str = "openai/gpt-4o-mini"
    openrouter_final_model: str = "openai/gpt-4o-mini"
    openrouter_timeout_seconds: int = 30
    agent_free_daily_limit: int = 10

    # Clerk identity (Phase 3). Issuer like https://your-app.clerk.accounts.dev
    clerk_issuer: str = ""
    # Comma-separated clerk_user_ids exempt from the daily limit.
    clerk_admin_user_ids: str = ""

    # Auto-ingest scheduler for single-service deploys like Railway
    auto_ingest_enabled: bool = True
    auto_ingest_on_startup: bool = True
    auto_ingest_interval_minutes: int = 60

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def db_url(self) -> str:
        """
        Normalise DATABASE_URL for SQLAlchemy.
        Railway provides postgres:// but SQLAlchemy needs postgresql+psycopg://
        """
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://") and "+psycopg" not in url:
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url


settings = Settings()
