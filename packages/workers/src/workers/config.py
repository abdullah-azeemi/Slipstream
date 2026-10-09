from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_DATABASE_URL = "postgresql+psycopg://pitwall:pitwall@localhost:5432/pitwall"


class Settings(BaseSettings):
    flask_env: str = "development"
    database_url: str = _DEV_DATABASE_URL
    redis_url: str = "redis://localhost:6379/0"
    mlflow_tracking_uri: str = "http://localhost:5001"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @model_validator(mode="after")
    def _reject_insecure_production_defaults(self) -> "Settings":
        if self.flask_env.lower() == "production" and self.database_url == _DEV_DATABASE_URL:
            raise ValueError(
                "DATABASE_URL must be set in production (refusing the localhost default)"
            )
        return self


settings = Settings()
