import pytest
from pydantic import ValidationError

from app.core.Config import Settings


def test_settings_requires_strong_secret_key():
    with pytest.raises(ValidationError):
        Settings(database_url="postgresql://user:pass@localhost/db", secret_key="sphinxclub012")


def test_settings_accepts_environment_style_values():
    settings = Settings(
        database_url="postgresql://user:pass@localhost/db",
        secret_key="a-strong-secret-key-with-more-than-32-chars",
        cookie_samesite="Strict",
    )

    assert settings.database_url.startswith("postgresql://")
    assert settings.cookie_samesite == "strict"
