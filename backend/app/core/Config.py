from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "ENTERVENE"
    debug: bool = False
    database_url: str = "postgresql://postgres:sphinxclub012@localhost:5432/Entervene"
    frontend_url: str = "http://localhost:5173"
    mobile_app_url: str = "http://localhost:8081"
    secret_key: str = "sphinxclub012"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30


settings = Settings()