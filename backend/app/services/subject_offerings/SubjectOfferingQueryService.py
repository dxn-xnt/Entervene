from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.services.subject_offerings.SubjectOfferingShared import (
    ALLOWED_OFFERING_STATUSES,
    ALLOWED_PATHWAYS,
    DEFAULT_OFFERING_STATUS,
    normalize_offering_status,
    normalize_pathway,
    normalized_text,
    offering_to_item,
    readable_text,
)


def get_subject_offering_form_options_data(db: Session) -> dict:
    academic_years = (
        db.query(AcademicYear)
        .order_by(AcademicYear.start_date.desc(), func.lower(AcademicYear.year_label))
        .all()
    )
    academic_levels = (
        db.query(AcademicLevel)
        .order_by(AcademicLevel.grade_level, func.lower(AcademicLevel.level_name))
        .all()
    )
    academic_periods = (
        db.query(AcademicPeriod)
        .order_by(AcademicPeriod.academic_year_id, AcademicPeriod.period_sequence, func.lower(AcademicPeriod.period_name))
        .all()
    )
    active_subjects = (
        db.query(Subject)
        .filter(func.lower(func.coalesce(Subject.status, "active")) == "active")
        .order_by(Subject.academic_level_id, func.lower(Subject.subject_name))
        .all()
    )
    return {
        "academic_years": [
            {
                "academic_year_id": year.academic_year_id,
                "year_label": year.year_label,
                "is_active": year.is_active,
                "start_date": year.start_date,
                "end_date": year.end_date,
            }
            for year in academic_years
        ],
        "academic_levels": [
            {
                "academic_level_id": level.academic_level_id,
                "level_name": level.level_name,
                "grade_level": level.grade_level,
            }
            for level in academic_levels
        ],
        "academic_periods": [
            {
                "academic_period_id": period.academic_period_id,
                "period_name": period.period_name,
                "period_type": period.period_type,
                "period_sequence": period.period_sequence,
                "academic_year_id": period.academic_year_id,
            }
            for period in academic_periods
        ],
        "pathways": ALLOWED_PATHWAYS,
        "statuses": ALLOWED_OFFERING_STATUSES,
        "default_status": DEFAULT_OFFERING_STATUS,
        "active_subjects": [
            {
                "subject_id": subject.subject_id,
                "subject_name": subject.subject_name,
                "subject_codename": subject.subject_codename,
                "subject_group": subject.subject_group,
                "academic_level_id": subject.academic_level_id,
            }
            for subject in active_subjects
        ],
    }


def list_subject_offerings_data(
    db: Session,
    academic_year_id: int | None = None,
    academic_level_id: int | None = None,
    academic_period_id: int | None = None,
    pathway: str | None = None,
    status: str | None = None,
    search: str = "",
) -> dict:
    query = (
        db.query(SubjectOffering, Subject, AcademicYear, AcademicLevel, AcademicPeriod)
        .join(Subject, Subject.subject_id == SubjectOffering.subject_id)
        .join(AcademicYear, AcademicYear.academic_year_id == SubjectOffering.academic_year_id)
        .join(AcademicLevel, AcademicLevel.academic_level_id == SubjectOffering.academic_level_id)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectOffering.academic_period_id)
    )
    all_rows = query.all()

    if academic_year_id is not None:
        query = query.filter(SubjectOffering.academic_year_id == academic_year_id)
    if academic_level_id is not None:
        query = query.filter(SubjectOffering.academic_level_id == academic_level_id)
    if academic_period_id is not None:
        query = query.filter(SubjectOffering.academic_period_id == academic_period_id)
    if pathway is not None:
        query = query.filter(SubjectOffering.pathway == normalize_pathway(pathway))
    if status is not None:
        query = query.filter(func.lower(func.coalesce(SubjectOffering.status, DEFAULT_OFFERING_STATUS)) == normalize_offering_status(status))
    search_term = readable_text(search)
    if search_term:
        like_term = f"%{normalized_text(search_term)}%"
        query = query.filter(
            or_(
                func.lower(Subject.subject_name).like(like_term),
                func.lower(func.coalesce(Subject.subject_codename, "")).like(like_term),
            )
        )

    rows = (
        query
        .order_by(
            AcademicYear.start_date.desc(),
            AcademicLevel.grade_level,
            AcademicPeriod.period_sequence,
            SubjectOffering.pathway,
            func.lower(Subject.subject_name),
        )
        .all()
    )
    active_offerings = sum(1 for offering, *_ in all_rows if (offering.status or DEFAULT_OFFERING_STATUS).casefold() == "active")
    archived_offerings = sum(1 for offering, *_ in all_rows if (offering.status or "").casefold() == "archived")
    return {
        "summary": {
            "total_offerings": len(all_rows),
            "active_offerings": active_offerings,
            "archived_offerings": archived_offerings,
        },
        "subject_offerings": [
            offering_to_item(offering, subject, academic_year, academic_level, academic_period)
            for offering, subject, academic_year, academic_level, academic_period in rows
        ],
    }


def get_subject_offering_detail_data(db: Session, subject_offering_id: int) -> dict:
    row = (
        db.query(SubjectOffering, Subject, AcademicYear, AcademicLevel, AcademicPeriod)
        .join(Subject, Subject.subject_id == SubjectOffering.subject_id)
        .join(AcademicYear, AcademicYear.academic_year_id == SubjectOffering.academic_year_id)
        .join(AcademicLevel, AcademicLevel.academic_level_id == SubjectOffering.academic_level_id)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectOffering.academic_period_id)
        .filter(SubjectOffering.subject_offering_id == subject_offering_id)
        .first()
    )
    if row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Subject offering not found.")
    offering, subject, academic_year, academic_level, academic_period = row
    return offering_to_item(offering, subject, academic_year, academic_level, academic_period)
