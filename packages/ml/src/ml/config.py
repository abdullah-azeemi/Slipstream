from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_DATABASE_URL = "postgresql+psycopg://pitwall:pitwall@localhost:5432/pitwall"


class Settings(BaseSettings):
    flask_env: str = "development"
    database_url: str = _DEV_DATABASE_URL
    mlflow_tracking_uri: str = "http://localhost:5001"
    model_name: str = "slipstream-race-predictor"
    telemetry_artifact_dir: str = "./telemetry_artifacts"

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    @model_validator(mode="after")
    def _reject_insecure_production_defaults(self) -> "Settings":
        if self.flask_env.lower() == "production" and self.database_url == _DEV_DATABASE_URL:
            raise ValueError(
                "DATABASE_URL must be set in production (refusing the localhost default)"
            )
        return self

    @property
    def db_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://") and "+psycopg" not in url:
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url


settings = Settings()
