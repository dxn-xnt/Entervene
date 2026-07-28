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
    # ── General & System ──
    (
        "app_name",
        "ENTERVENE",
        SettingType.STRING,
        "general",
        True,
        "Application display name",
    ),
    (
        "maintenance_mode",
        "false",
        SettingType.BOOLEAN,
        "general",
        True,
        "Enable maintenance mode across the application",
    ),

    # ── Passing Thresholds ──
    (
        "subject_passing_grade",
        "80",
        SettingType.INTEGER,
        "thresholds",
        True,
        "Minimum passing grade per subject",
    ),
    (
        "general_average_passing_grade",
        "80",
        SettingType.INTEGER,
        "thresholds",
        True,
        "Minimum general average passing grade",
    ),

    # ── Academic Calendar ──
    (
        "current_school_year",
        "AY2025-2026",
        SettingType.STRING,
        "calendar",
        True,
        "Current active school year",
    ),
    (
        "active_term",
        "1",
        SettingType.STRING,
        "calendar",
        True,
        "Current active term sequence",
    ),

    # ── Curriculum Scope ──
    (
        "jhs_enabled",
        "true",
        SettingType.BOOLEAN,
        "curriculum",
        True,
        "Enable Junior High School grade levels",
    ),
    (
        "shs_enabled",
        "true",
        SettingType.BOOLEAN,
        "curriculum",
        True,
        "Enable Senior High School grade levels",
    ),
    (
        "medical_pathway_enabled",
        "true",
        SettingType.BOOLEAN,
        "curriculum",
        True,
        "Enable STEM Medical strand pathway",
    ),
    (
        "engineering_pathway_enabled",
        "true",
        SettingType.BOOLEAN,
        "curriculum",
        True,
        "Enable STEM Engineering strand pathway",
    ),

    # ── Random Forest ML Risk Model ──
    (
        "risk_threshold_high",
        "75.0",
        SettingType.STRING,
        "ml_prediction",
        False,
        "Grade threshold for High Risk classification in Random Forest model",
    ),
    (
        "risk_threshold_moderate",
        "80.0",
        SettingType.STRING,
        "ml_prediction",
        False,
        "Grade threshold for Moderate Risk classification in Random Forest model",
    ),
]

OBSOLETE_KEYS = [
    "openai_api_key",
    "ai_model",
    "enable_ai_features",
    "prediction_weights",
    "smtp_host",
    "smtp_port",
    "enable_email_notifications",
    "app_tagline",
    "primary_color",
    "theme_mode",
    "session_timeout_minutes",
    "max_login_attempts",
    "max_file_upload_mb",
]


def seed(db: Session) -> None:
    """Insert default settings, purge obsolete keys, skipping any that already exist."""
    # 1. Purge obsolete keys
    deleted = db.query(Setting).filter(Setting.key.in_(OBSOLETE_KEYS)).delete(synchronize_session=False)

    # 2. Add active defaults
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
    print(f"Seeded {inserted} new setting(s). Deleted {deleted} obsolete key(s).")


if __name__ == "__main__":
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
