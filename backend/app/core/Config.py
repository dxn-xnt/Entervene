import os

from dotenv import load_dotenv

ENV_FILE = os.getenv("ENV_FILE", ".env")
load_dotenv(ENV_FILE)

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore", case_sensitive=False)

    app_name: str = "ENTERVENE"
    debug: bool = False
    app_environment: str = Field(default="production", validation_alias=AliasChoices("app_environment", "app_env"))
    development_prediction_api_enabled: bool = False
    development_current_term_model_name: str = "entervene_current_term_development_rf_v3"
    database_url: str = Field(..., min_length=1)
    frontend_url: str = "http://localhost:5173"
    mobile_app_url: str = "http://localhost:8081"
    secret_key: str = Field(..., min_length=32)
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    cookie_domain: str | None = None
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-20b"
    gemini_api_key: str | None = None
    ai_enabled: bool = True
    ai_school_per_minute: int = Field(default=12, ge=1, le=60)
    ai_staff_per_day: int = Field(default=30, ge=1, le=500)
    ai_school_per_day: int = Field(default=500, ge=1, le=10000)
    ai_monthly_budget_usd: int = Field(default=20, ge=0, le=1000)
    tos_credit_hold_ttl_seconds: int = Field(default=900, ge=30, le=86400)
    tos_credit_heartbeat_interval_seconds: float | None = Field(default=None, gt=0)
    tos_fill_missing_free_limit: int = Field(default=3, ge=0, le=100)
    tos_short_exam_charge_threshold: float = Field(default=0.6, ge=0, le=1)
    tos_completion_base_tokens: int = Field(default=300, ge=0, le=4000)
    tos_completion_mc_per_item: int = Field(default=250, ge=1, le=4000)
    tos_completion_tf_per_item: int = Field(default=150, ge=1, le=4000)
    tos_completion_identification_per_item: int = Field(default=130, ge=1, le=4000)
    tos_completion_essay_per_item: int = Field(default=250, ge=1, le=4000)
    tos_completion_matching_per_item: int = Field(default=200, ge=1, le=4000)
    api_requests_per_minute: int = Field(default=6000, ge=60)
    api_ip_requests_per_minute: int = Field(default=3000, ge=30)
    mail_driver: str = "console"
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    mail_from_name: str = "Entervene Academic Portal"

    @field_validator("debug", mode="before")
    @classmethod
    def normalize_debug(cls, value: object) -> object:
        if isinstance(value, str) and value.lower() in {"release", "prod", "production"}:
            return False
        return value

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, value: str) -> str:
        banned = {"sphinxclub012", "change-me", "changeme", "secret", "dev-secret"}
        if value.lower() in banned:
            raise ValueError("SECRET_KEY must be a strong environment-provided secret")
        return value

    @field_validator("cookie_samesite")
    @classmethod
    def validate_cookie_samesite(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"lax", "strict", "none"}:
            raise ValueError("COOKIE_SAMESITE must be one of: lax, strict, none")
        return normalized


settings = Settings()
