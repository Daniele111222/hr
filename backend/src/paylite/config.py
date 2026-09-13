from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "PayLite Backend"
    database_url: str = "postgresql+psycopg://paylite:paylite_dev@127.0.0.1:5432/paylite"

    model_config = SettingsConfigDict(
        env_prefix="PAYLITE_",
        env_file=BACKEND_ROOT / ".env",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
