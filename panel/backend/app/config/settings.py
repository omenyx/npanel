from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PANEL_", env_file=".env", extra="ignore")

    environment: str = "production"

    postgres_dsn: str = "postgresql+asyncpg://panel:panel@localhost:5432/panel"

    # PowerDNS authoritative API
    pdns_api_url: str | None = None
    pdns_api_key: str | None = None
    pdns_server_id: str = "localhost"

    whmcs_public_key_pem: str | None = None
    whmcs_hmac_secret: str | None = None
    whmcs_webhook_secret: str | None = None

    sso_token_issuer: str = "whmcs"

    # Optional hardening (recommended)
    sso_token_audience: str | None = None
    sso_clock_skew_seconds: int = 10
    sso_max_age_seconds: int = 90
    sso_replay_grace_seconds: int = 10


settings = Settings()
