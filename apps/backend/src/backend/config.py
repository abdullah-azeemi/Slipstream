"""
Backend configuration via pydantic-settings.

Reads from environment variables. Falls back to .env file locally.
Never hardcode credentials — this file is committed to git.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Flask
    secret_key: str = "dev-secret-change-in-production"
    debug: bool = True
    testing: bool = False

    # Database
    database_url: str = "postgresql+psycopg://pitwall:pitwall@localhost:5432/pitwall"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Kafka
    kafka_bootstrap_servers: str = "localhost:9092"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
