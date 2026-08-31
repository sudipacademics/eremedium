from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ephemeris_path: Path = Field(default=Path("/app/ephemeris"), validation_alias="EPHE_PATH")
    log_level: str = "info"
    internal_service_token: str = ""
    house_system: str = "P"  # Placidus cusps; Vedic bhavas are reported whole-sign from Lagna.


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
