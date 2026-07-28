"""
Settings service — business logic for reading and updating settings.

Follows the same pattern as SubjectService.py:
  - Pure functions that accept a ``db: Session`` and return dicts.
  - Raise ``HTTPException`` on validation errors.
  - Invalidate the settings cache on every successful write.
"""

import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.SettingsCache import settings_cache
from app.models.settings.Setting import Setting, SettingType


# ── Reads ────────────────────────────────────────────────────────────


def get_all_settings_grouped(db: Session) -> dict:
    """Return all settings grouped by category for the admin UI."""
    rows = db.query(Setting).order_by(Setting.group, Setting.key).all()
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row.group, []).append({
            "key": row.key,
            "value": row.value,
            "type": row.type.value,
            "group": row.group,
            "is_public": row.is_public,
            "description": row.description,
        })
    return {"groups": groups}


def get_public_settings(db: Session) -> dict:
    """Return ``is_public=True`` settings as a flat ``{key: value}`` dict.

    Uses the TTL cache — typically zero DB hits on hot paths.
    """
    return {"settings": settings_cache.get_all_public(db=db)}


# ── Write ────────────────────────────────────────────────────────────


def update_setting(db: Session, key: str, value: str, user_id: str) -> dict:
    """Validate type, update the row, and invalidate the cache.

    Raises 404 if the key does not exist.
    Raises 422 if the value does not match the setting's declared type.
    """
    row = db.query(Setting).filter(Setting.key == key).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found.")

    # ── Strict type validation ──
    _validate_value(value, row.type)

    row.value = value
    row.updated_by = user_id
    db.commit()
    db.refresh(row)

    # Invalidate the cache on THIS worker immediately.
    # Other workers will self-heal within the TTL window.
    settings_cache.invalidate()

    return {
        "key": row.key,
        "value": row.value,
        "type": row.type.value,
        "group": row.group,
        "is_public": row.is_public,
        "description": row.description,
    }


# ── Type validation ─────────────────────────────────────────────────


def _validate_value(value: str, setting_type: SettingType) -> None:
    """Raise 422 if the value doesn't match the expected type."""
    if setting_type == SettingType.BOOLEAN:
        if value.lower() not in ("true", "false"):
            raise HTTPException(
                status_code=422,
                detail=f"Boolean setting must be 'true' or 'false', got '{value}'.",
            )

    elif setting_type == SettingType.INTEGER:
        try:
            int(value)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail=f"Integer setting must be a valid number, got '{value}'.",
            )

    elif setting_type == SettingType.JSON:
        try:
            json.loads(value)
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(
                status_code=422,
                detail=f"JSON setting must be valid JSON, got '{value}'.",
            )

    # SettingType.STRING — any value is valid, no validation needed.
