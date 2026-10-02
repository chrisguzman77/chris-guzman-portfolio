from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every field is overridable via an ``API_``-prefixed env var."""

    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    app_version: str = "dev"
    database_url: str = "postgresql+asyncpg://portfolio:portfolio@localhost:5432/portfolio"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    cors_origins: list[str] = ["http://localhost:3000"]

    # Phase 4 integrations. Each feature stays off until its secret is set.
    turnstile_secret: str | None = None
    resend_api_key: str | None = None
    contact_to: str | None = None
    contact_from: str = "Portfolio <contact@christopherguzman.me>"
    github_token: str | None = None
    github_login: str = "chrisguzman77"

    @field_validator(
        "turnstile_secret", "resend_api_key", "contact_to", "github_token", mode="before"
    )
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        # Compose passes secrets that are not set yet as "" (${VAR:-}).
        return None if value == "" else value
