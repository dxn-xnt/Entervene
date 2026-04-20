from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "ENTERVENE"
    debug: bool = False
    database_url: str = "sqlite:///./entervene.db"
    frontend_url: str = "http://localhost:5173"
    secret_key: str = "changeme"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30


settings = Settings()