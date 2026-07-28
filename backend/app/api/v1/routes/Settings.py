"""
Settings API router.

Endpoints:
  GET  /settings/public   — No auth. Returns only ``is_public=True`` settings.
  GET  /settings           — Admin only. Returns all settings grouped by category.
  PUT  /settings/{key}     — Admin only. Updates a setting with strict type validation.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.schemas.Settings import (
    SettingRead,
    SettingUpdate,
    SettingsGroupedResponse,
    SettingsPublicResponse,
)
from app.services.settings.SettingsService import (
    get_all_settings_grouped,
    get_public_settings,
    update_setting,
)

router = APIRouter()


@router.get("/public", response_model=SettingsPublicResponse)
def fetch_public_settings(db: Session = Depends(get_db)):
    """No auth required — returns only ``is_public=True`` settings as a flat dict."""
    return get_public_settings(db)


@router.get("", response_model=SettingsGroupedResponse)
def fetch_all_settings(
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Admin only — returns all settings grouped by category."""
    return get_all_settings_grouped(db)


@router.get("/academic-periods")
def fetch_academic_periods(
    db: Session = Depends(get_db),
):
    """Fetch all academic periods from the database for system settings."""
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.AcademicYear import AcademicYear

    periods = (
        db.query(AcademicPeriod, AcademicYear)
        .join(AcademicYear, AcademicPeriod.academic_year_id == AcademicYear.academic_year_id)
        .order_by(AcademicPeriod.period_sequence)
        .all()
    )

    result = []
    for p, y in periods:
        result.append({
            "id": p.academic_period_id,
            "period": p.period_name,
            "period_sequence": p.period_sequence,
            "academicyear": getattr(y, "year_name", None) or getattr(y, "year_code", None) or "2025-2026",
            "startDate": p.start_date.isoformat() if p.start_date else None,
            "endDate": p.end_date.isoformat() if p.end_date else None,
            "is_active": p.is_active,
            "status": "Active" if p.is_active else ("Passed" if p.period_sequence < 1 else "Upcoming"),
        })
    return {"periods": result}


@router.put("/{key}", response_model=SettingRead)
def update_single_setting(
    key: str,
    payload: SettingUpdate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Admin only — update a setting value with strict type validation."""
    user_id = current_user.get("sub") or current_user.get("user_id")
    return update_setting(db=db, key=key, value=payload.value, user_id=user_id)
