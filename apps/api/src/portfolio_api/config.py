from typing import Literal

from pydantic import Field, field_validator
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

    # Phase 5 chat. Chat stays off until the Groq key, Directus token, Turnstile secret and
    # hash salt are all set.
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-120b"
    directus_url: str = "http://directus:8055"
    directus_token: str | None = None
    internal_secret: str | None = None
    chat_hash_salt: str | None = None
    chat_daily_token_budget: int = Field(default=180_000, gt=0)
    chat_min_similarity: float = 0.5
    embedding_cache_dir: str | None = None

    # Phase 6: GET /v1/status reads fixed queries from the compose-network Prometheus.
    prometheus_url: str = "http://prometheus:9090"
    # Blog subscriptions: on when the Resend key, Turnstile secret and internal secret are set.
    newsletter_from: str = "Christopher Guzman <posts@christopherguzman.me>"
    site_url: str = "https://christopherguzman.me"
    public_api_url: str = "https://api.christopherguzman.me"

    @field_validator(
        "turnstile_secret",
        "resend_api_key",
        "contact_to",
        "github_token",
        "groq_api_key",
        "directus_token",
        "internal_secret",
        "chat_hash_salt",
        "embedding_cache_dir",
        mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        # Compose passes secrets that are not set yet as "" (${VAR:-}).
        return None if value == "" else value
