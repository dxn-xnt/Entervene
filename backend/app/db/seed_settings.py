"""
Idempotent seed script for default application settings.

Usage:
    cd backend
    python -m app.db.seed_settings

Inserts only if the key does not already exist.
Safe to run repeatedly — existing values are never overwritten.
"""

from sqlalchemy.orm import Session

from app.db.Session import SessionLocal
from app.models.settings.Setting import Setting, SettingType


# ── Default settings ─────────────────────────────────────────────────
# Each tuple: (key, value, type, group, is_public, description)

DEFAULTS: list[tuple[str, str, SettingType, str, bool, str]] = [
    # ── General ──
    (
        "app_name",
        "ENTERVENE",
        SettingType.STRING,
        "general",
        True,
        "Application display name",
    ),
    (
        "app_tagline",
        "Student Intervention Platform",
        SettingType.STRING,
        "general",
        True,
        "Tagline shown on the login page",
    ),
    (
        "maintenance_mode",
        "false",
        SettingType.BOOLEAN,
        "general",
        True,
        "Enable maintenance mode across the application",
    ),
    (
        "max_file_upload_mb",
        "10",
        SettingType.INTEGER,
        "general",
        False,
        "Maximum file upload size in megabytes",
    ),
    # ── Appearance ──
    (
        "primary_color",
        "#6366f1",
        SettingType.STRING,
        "appearance",
        True,
        "Brand primary color (hex)",
    ),
    (
        "theme_mode",
        "system",
        SettingType.STRING,
        "appearance",
        True,
        "Default theme mode: light, dark, or system",
    ),
    # ── Notifications ──
    (
        "enable_email_notifications",
        "true",
        SettingType.BOOLEAN,
        "notifications",
        False,
        "Toggle email sending globally",
    ),
    (
        "smtp_host",
        "",
        SettingType.STRING,
        "notifications",
        False,
        "SMTP server host",
    ),
    (
        "smtp_port",
        "587",
        SettingType.INTEGER,
        "notifications",
        False,
        "SMTP server port",
    ),
    # ── AI ──
    (
        "openai_api_key",
        "",
        SettingType.STRING,
        "ai",
        False,
        "API key for OpenAI services",
    ),
    (
        "ai_model",
        "gpt-4o-mini",
        SettingType.STRING,
        "ai",
        False,
        "Default AI model to use for generation tasks",
    ),
    (
        "enable_ai_features",
        "true",
        SettingType.BOOLEAN,
        "ai",
        True,
        "Toggle AI features visibility for all users",
    ),
    (
        "prediction_weights",
        '{"attendance": 0.3, "grades": 0.4, "behavior": 0.3}',
        SettingType.JSON,
        "ai",
        False,
        "Weight distribution for the prediction model",
    ),
    # ── Security ──
    (
        "session_timeout_minutes",
        "30",
        SettingType.INTEGER,
        "security",
        False,
        "Access token TTL in minutes (JWT expiry)",
    ),
    (
        "max_login_attempts",
        "5",
        SettingType.INTEGER,
        "security",
        False,
        "Maximum consecutive failed login attempts before lockout",
    ),
]


def seed(db: Session) -> None:
    """Insert default settings, skipping any that already exist."""
    existing_keys = {row.key for row in db.query(Setting.key).all()}
    inserted = 0

    for key, value, stype, group, is_public, desc in DEFAULTS:
        if key in existing_keys:
            continue
        db.add(
            Setting(
                key=key,
                value=value,
                type=stype,
                group=group,
                is_public=is_public,
                description=desc,
            )
        )
        inserted += 1

    db.commit()
    print(f"Seeded {inserted} new setting(s). {len(existing_keys)} already existed.")


if __name__ == "__main__":
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
