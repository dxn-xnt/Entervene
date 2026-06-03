from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_name: str = "ENTERVENE"
    debug: bool = False
    database_url: str = Field(..., min_length=1)
    frontend_url: str = "http://localhost:5173"
    mobile_app_url: str = "http://localhost:8081"
    secret_key: str = Field(..., min_length=32)
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    cookie_secure: bool = True
    cookie_samesite: str = "lax"
    cookie_domain: str | None = None

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
