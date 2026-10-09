"""
Configuration for the ingestion service.

pydantic-settings reads these values from environment variables automatically.
On your laptop they come from .env — in production from real environment variables.
The variable names match exactly what's in .env.example.
"""

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_DATABASE_URL = "postgresql+psycopg://pitwall:pitwall@localhost:5432/pitwall"


class Settings(BaseSettings):
    # Runtime environment: development | staging | production | testing
    flask_env: str = "development"

    # Database
    database_url: str = _DEV_DATABASE_URL

    # Kafka
    kafka_bootstrap_servers: str = "localhost:9092"

    # FastF1
    fastf1_cache_dir: str = "./fastf1_cache"

    # OpenF1 live-feed metadata (team radio)
    openf1_base_url: str = "https://api.openf1.org"
    openf1_timeout_seconds: int = 10

    # How many rows to insert at once (batching is faster than one-by-one)
    db_batch_size: int = 500

    # Raw telemetry can be expensive in hosted Postgres. Keep "database" for
    # local/Timescale workflows, or use "files" to store compressed lap traces
    # outside Postgres and keep only metadata in the DB.
    telemetry_storage_mode: str = "database"
    telemetry_artifact_dir: str = "./telemetry_artifacts"
    telemetry_artifact_backend: str = "local"
    telemetry_artifact_bucket: str = ""
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # ignore unknown env vars instead of crashing
    )

    @model_validator(mode="after")
    def _reject_insecure_production_defaults(self) -> "Settings":
        if self.flask_env.lower() == "production" and self.database_url == _DEV_DATABASE_URL:
            raise ValueError(
                "DATABASE_URL must be set in production (refusing the localhost default)"
            )
        return self


# Single instance used across the whole package
settings = Settings()
