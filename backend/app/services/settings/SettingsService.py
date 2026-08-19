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
        if key in ("school_day_start", "school_day_end"):
            _validate_school_hours(db, key, value)
            row = Setting(
                key=key,
                value=value,
                type=SettingType.STRING,
                group="academic",
                is_public=True,
                description="School operational hours boundary",
                updated_by=user_id,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            settings_cache.invalidate()
            return {
                "key": row.key,
                "value": row.value,
                "type": row.type.value,
                "group": row.group,
                "is_public": row.is_public,
                "description": row.description,
            }
        raise HTTPException(status_code=404, detail=f"Setting '{key}' not found.")

    # ── Strict type validation ──
    _validate_value(value, row.type)

    if key in ("school_day_start", "school_day_end"):
        _validate_school_hours(db, key, value)

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


def _time_str_to_minutes(t_str: str) -> int:
    try:
        h, m = t_str.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        raise ValueError("Invalid time format. Expected HH:MM")

def _validate_school_hours(db: Session, key: str, value: str) -> None:
    """Validate school_day_start and school_day_end constraints."""
    try:
        new_mins = _time_str_to_minutes(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="Time must be in HH:MM format.")

    # Extreme bounds check (e.g. not before 4 AM or after 11 PM)
    if new_mins < 4 * 60 or new_mins > 23 * 60:
        raise HTTPException(
            status_code=422,
            detail="School hours must be between 04:00 and 23:00."
        )

    # Cross-field validation (start < end)
    other_key = "school_day_end" if key == "school_day_start" else "school_day_start"
    other_row = db.query(Setting).filter(Setting.key == other_key).first()
    
    # If other setting doesn't exist yet, we fall back to defaults
    other_val = other_row.value if other_row and other_row.value else ("20:00" if other_key == "school_day_end" else "06:00")
    
    try:
        other_mins = _time_str_to_minutes(other_val)
    except ValueError:
        other_mins = 20 * 60 if other_key == "school_day_end" else 6 * 60

    if key == "school_day_start" and new_mins >= other_mins:
        raise HTTPException(status_code=422, detail="School day start time must be before end time.")
    if key == "school_day_end" and new_mins <= other_mins:
        raise HTTPException(status_code=422, detail="School day end time must be after start time.")
