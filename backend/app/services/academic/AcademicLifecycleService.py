from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.SettingsCache import settings_cache
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.settings.Setting import Setting, SettingType
from app.services.settings.SettingsService import update_setting


def resolve_active_academic_year(
    db: Session,
    *,
    required: bool = True,
    lock: bool = False,
) -> AcademicYear | None:
    query = db.query(AcademicYear).filter(AcademicYear.is_active.is_(True))
    if lock:
        query = query.with_for_update()
    active_years = query.order_by(AcademicYear.academic_year_id).all()
    if len(active_years) > 1:
        raise HTTPException(
            status_code=409,
            detail="Academic lifecycle is inconsistent: multiple academic years are active.",
        )
    if not active_years:
        if required:
            raise HTTPException(status_code=409, detail="No active academic year is configured.")
        return None
    return active_years[0]


def resolve_active_academic_period(
    db: Session,
    *,
    required: bool = True,
    lock: bool = False,
) -> AcademicPeriod | None:
    active_year = resolve_active_academic_year(db, required=required, lock=lock)
    query = db.query(AcademicPeriod).filter(AcademicPeriod.is_active.is_(True))
    if lock:
        query = query.with_for_update()
    active_periods = query.order_by(
        AcademicPeriod.period_sequence,
        AcademicPeriod.academic_period_id,
    ).all()
    if len(active_periods) > 1:
        raise HTTPException(
            status_code=409,
            detail="Academic lifecycle is inconsistent: multiple grading periods are active.",
        )
    if not active_periods:
        if required:
            raise HTTPException(status_code=409, detail="No active grading period is configured.")
        return None
    active_period = active_periods[0]
    if active_year is None or active_period.academic_year_id != active_year.academic_year_id:
        raise HTTPException(
            status_code=409,
            detail="Academic lifecycle is inconsistent: the active grading period is not in the active academic year.",
        )
    return active_period


def _stage_lifecycle_setting(
    db: Session,
    *,
    key: str,
    value: str,
    actor_user_id: UUID | None = None,
) -> None:
    row = db.query(Setting).filter(Setting.key == key).with_for_update().one_or_none()
    if row is None:
        descriptions = {
            "current_school_year": "Current active school year",
            "active_term": "Current active term sequence",
        }
        db.add(Setting(
            key=key,
            value=value,
            type=SettingType.STRING,
            group="calendar",
            is_public=True,
            description=descriptions[key],
            updated_by=actor_user_id,
        ))
        return
    update_setting(
        db=db,
        key=key,
        value=value,
        user_id=actor_user_id,
        commit=False,
        allow_lifecycle_update=True,
    )


def activate_academic_year(
    db: Session,
    *,
    academic_year_id: int,
    actor_user_id: UUID | None = None,
) -> tuple[AcademicYear, AcademicPeriod]:
    try:
        years = db.query(AcademicYear).order_by(AcademicYear.academic_year_id).with_for_update().all()
        target_year = next(
            (year for year in years if year.academic_year_id == academic_year_id),
            None,
        )
        if target_year is None:
            raise HTTPException(status_code=404, detail="Academic year not found.")

        all_periods = (
            db.query(AcademicPeriod)
            .order_by(AcademicPeriod.academic_year_id, AcademicPeriod.period_sequence, AcademicPeriod.academic_period_id)
            .with_for_update()
            .all()
        )
        target_periods = [
            period for period in all_periods
            if period.academic_year_id == academic_year_id
        ]
        if not target_periods:
            raise HTTPException(
                status_code=409,
                detail="Configure at least one grading period before activating this academic year.",
            )

        active_target_periods = [period for period in target_periods if period.is_active]
        selected_period = (
            active_target_periods[0]
            if len(active_target_periods) == 1
            else target_periods[0]
        )

        for year in years:
            year.is_active = year.academic_year_id == academic_year_id
        for period in all_periods:
            period.is_active = period.academic_period_id == selected_period.academic_period_id

        _stage_lifecycle_setting(
            db,
            key="current_school_year",
            value=target_year.year_label,
            actor_user_id=actor_user_id,
        )
        _stage_lifecycle_setting(
            db,
            key="active_term",
            value=str(selected_period.period_sequence),
            actor_user_id=actor_user_id,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    settings_cache.invalidate()
    db.refresh(target_year)
    db.refresh(selected_period)
    return target_year, selected_period


def activate_academic_period(
    db: Session,
    *,
    academic_period_id: int,
    actor_user_id: UUID | None = None,
) -> tuple[AcademicYear, AcademicPeriod]:
    try:
        db.query(AcademicYear).order_by(AcademicYear.academic_year_id).with_for_update().all()
        active_year = resolve_active_academic_year(db)
        all_periods = (
            db.query(AcademicPeriod)
            .order_by(AcademicPeriod.academic_year_id, AcademicPeriod.period_sequence, AcademicPeriod.academic_period_id)
            .with_for_update()
            .all()
        )
        target_period = next(
            (period for period in all_periods if period.academic_period_id == academic_period_id),
            None,
        )
        if target_period is None:
            raise HTTPException(status_code=404, detail="Academic period not found.")

        if target_period.academic_year_id != active_year.academic_year_id:
            raise HTTPException(
                status_code=409,
                detail="Only a grading period in the active academic year can be activated.",
            )

        for period in all_periods:
            period.is_active = period.academic_period_id == academic_period_id

        _stage_lifecycle_setting(
            db,
            key="current_school_year",
            value=active_year.year_label,
            actor_user_id=actor_user_id,
        )
        _stage_lifecycle_setting(
            db,
            key="active_term",
            value=str(target_period.period_sequence),
            actor_user_id=actor_user_id,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    settings_cache.invalidate()
    db.refresh(active_year)
    db.refresh(target_period)
    return active_year, target_period
