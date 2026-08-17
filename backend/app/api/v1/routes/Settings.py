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


@router.get("/academic-years")
def fetch_academic_years(
    db: Session = Depends(get_db),
):
    """Fetch all academic years from the database."""
    from app.models.academic.AcademicYear import AcademicYear

    years = (
        db.query(AcademicYear)
        .order_by(AcademicYear.start_date.desc())
        .all()
    )
    return {
        "years": [
            {
                "academic_year_id": y.academic_year_id,
                "year_label": y.year_label,
                "start_date": y.start_date.isoformat() if y.start_date else None,
                "end_date": y.end_date.isoformat() if y.end_date else None,
                "is_active": bool(y.is_active),
            }
            for y in years
        ]
    }


@router.get("/academic-levels")
def fetch_academic_levels(
    db: Session = Depends(get_db),
):
    """Fetch all academic levels from the database."""
    from app.models.academic.AcademicLevel import AcademicLevel

    levels = (
        db.query(AcademicLevel)
        .order_by(AcademicLevel.grade_level.asc())
        .all()
    )
    return {
        "levels": [
            {
                "academic_level_id": l.academic_level_id,
                "level_name": l.level_name,
                "grade_level": l.grade_level,
                "stage": "Junior High" if l.grade_level <= 10 else "Senior High",
            }
            for l in levels
        ]
    }


@router.get("/academic-periods")
def fetch_academic_periods(
    academic_year_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Fetch academic periods from the database, optionally filtered by academic_year_id."""
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.AcademicYear import AcademicYear

    query = (
        db.query(AcademicPeriod, AcademicYear)
        .join(AcademicYear, AcademicPeriod.academic_year_id == AcademicYear.academic_year_id)
    )

    if academic_year_id is not None:
        query = query.filter(AcademicPeriod.academic_year_id == academic_year_id)
    else:
        # Default to active academic year if not specified
        active_year = db.query(AcademicYear).filter(AcademicYear.is_active == True).first()
        if active_year:
            query = query.filter(AcademicPeriod.academic_year_id == active_year.academic_year_id)

    periods = query.order_by(AcademicPeriod.period_sequence.asc()).all()

    result = []
    for p, y in periods:
        result.append({
            "id": p.academic_period_id,
            "period": p.period_name,
            "period_sequence": p.period_sequence,
            "total_periods": p.total_periods_in_year or 3,
            "academicyear": y.year_label,
            "academic_year_id": p.academic_year_id,
            "startDate": p.start_date.isoformat() if p.start_date else None,
            "endDate": p.end_date.isoformat() if p.end_date else None,
            "is_active": bool(p.is_active),
            "status": "Active" if p.is_active else ("Passed" if p.period_sequence < 1 else "Upcoming"),
        })
    return {"periods": result}


@router.put("/active-academic-year/{academic_year_id}")
def set_active_academic_year(
    academic_year_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Admin only — set the active academic year."""
    from fastapi import HTTPException
    from app.models.academic.AcademicYear import AcademicYear

    target_year = db.query(AcademicYear).filter(AcademicYear.academic_year_id == academic_year_id).first()
    if not target_year:
        raise HTTPException(status_code=404, detail="Academic year not found.")

    # Deactivate all, activate target
    all_years = db.query(AcademicYear).all()
    for y in all_years:
        y.is_active = (y.academic_year_id == academic_year_id)

    # Sync setting
    user_id = current_user.get("sub") or current_user.get("user_id")
    update_setting(db=db, key="current_school_year", value=target_year.year_label, user_id=user_id)

    db.commit()
    return {"message": f"Academic year {target_year.year_label} set as active.", "academic_year_id": academic_year_id}


@router.put("/active-period/{academic_period_id}")
def set_active_academic_period(
    academic_period_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Admin only — set the active academic period."""
    from fastapi import HTTPException
    from app.models.academic.AcademicPeriod import AcademicPeriod

    target_period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == academic_period_id).first()
    if not target_period:
        raise HTTPException(status_code=404, detail="Academic period not found.")

    # Deactivate other periods in the same academic year, activate target
    year_periods = db.query(AcademicPeriod).filter(AcademicPeriod.academic_year_id == target_period.academic_year_id).all()
    for p in year_periods:
        p.is_active = (p.academic_period_id == academic_period_id)

    # Sync setting
    user_id = current_user.get("sub") or current_user.get("user_id")
    update_setting(db=db, key="active_term", value=str(target_period.period_sequence), user_id=user_id)

    db.commit()
    return {
        "message": f"Period {target_period.period_name} set as active.",
        "academic_period_id": academic_period_id,
        "period_sequence": target_period.period_sequence,
    }


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
