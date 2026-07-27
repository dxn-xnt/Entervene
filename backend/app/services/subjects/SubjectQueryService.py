from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Subject import Subject
from app.services.subjects.SubjectShared import (
    ALLOWED_SUBJECT_GROUPS,
    ALLOWED_SUBJECT_STATUSES,
    DEFAULT_GRADING_TEMPLATES,
    DEFAULT_SUBJECT_STATUS,
    normalize_optional_text,
    normalize_subject_status,
    subject_to_item,
)


def get_subject_form_options_data(db: Session) -> dict:
    academic_levels = (
        db.query(AcademicLevel)
        .order_by(AcademicLevel.grade_level, func.lower(AcademicLevel.level_name))
        .all()
    )
    return {
        "academic_levels": [
            {
                "academic_level_id": level.academic_level_id,
                "level_name": level.level_name,
                "grade_level": level.grade_level,
            }
            for level in academic_levels
        ],
        "subject_groups": ALLOWED_SUBJECT_GROUPS,
        "statuses": ALLOWED_SUBJECT_STATUSES,
        "default_status": DEFAULT_SUBJECT_STATUS,
        "grading_templates": DEFAULT_GRADING_TEMPLATES,
    }


def list_subjects_data(
    db: Session,
    status: str | None = None,
    academic_level_id: int | None = None,
    subject_group: str | None = None,
    search: str = "",
) -> dict:
    query = db.query(Subject, AcademicLevel).join(
        AcademicLevel,
        Subject.academic_level_id == AcademicLevel.academic_level_id,
    )
    all_rows = query.all()

    if status is not None:
        query = query.filter(func.lower(func.coalesce(Subject.status, DEFAULT_SUBJECT_STATUS)) == normalize_subject_status(status))
    if academic_level_id is not None:
        query = query.filter(Subject.academic_level_id == academic_level_id)
    group_filter = normalize_optional_text(subject_group)
    if group_filter is not None:
        query = query.filter(func.lower(func.coalesce(Subject.subject_group, "")) == group_filter.casefold())
    search_term = normalize_optional_text(search)
    if search_term is not None:
        like_term = f"%{search_term.casefold()}%"
        query = query.filter(
            or_(
                func.lower(Subject.subject_name).like(like_term),
                func.lower(func.coalesce(Subject.subject_codename, "")).like(like_term),
            )
        )

    rows = (
        query
        .order_by(AcademicLevel.grade_level, func.lower(Subject.subject_name), func.lower(func.coalesce(Subject.subject_codename, "")))
        .all()
    )
    active_subjects = sum(1 for subject, _ in all_rows if (subject.status or DEFAULT_SUBJECT_STATUS).casefold() == "active")
    archived_subjects = sum(1 for subject, _ in all_rows if (subject.status or "").casefold() == "archived")
    return {
        "summary": {
            "total_subjects": len(all_rows),
            "active_subjects": active_subjects,
            "archived_subjects": archived_subjects,
        },
        "subjects": [subject_to_item(subject, level) for subject, level in rows],
    }


def get_subject_detail_data(db: Session, subject_id: int) -> dict:
    row = (
        db.query(Subject, AcademicLevel)
        .join(AcademicLevel, Subject.academic_level_id == AcademicLevel.academic_level_id)
        .filter(Subject.subject_id == subject_id)
        .first()
    )
    if row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Subject not found.")
    subject, academic_level = row
    return subject_to_item(subject, academic_level)
