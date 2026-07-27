from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Subject import Subject


ALLOWED_SUBJECT_GROUPS = [
    "Core",
    "Applied",
    "Specialized",
    "Research",
    "Other",
]
ALLOWED_SUBJECT_STATUSES = ["active", "archived"]
DEFAULT_SUBJECT_STATUS = "active"
DEFAULT_GRADING_TEMPLATES = [
    "Default SHS",
    "STEM Written/Performance/Exam",
]


def readable_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalized_text(value: Any) -> str:
    return readable_text(value).casefold()


def normalize_optional_text(value: Any) -> str | None:
    text = readable_text(value)
    return text or None


def normalize_subject_status(value: Any) -> str:
    status = normalized_text(value or DEFAULT_SUBJECT_STATUS)
    if status not in ALLOWED_SUBJECT_STATUSES:
        raise HTTPException(status_code=422, detail="Subject status must be active or archived.")
    return status


def normalize_subject_group(value: Any) -> str | None:
    group = normalize_optional_text(value)
    if group is None:
        return None
    allowed_by_key = {normalized_text(item): item for item in ALLOWED_SUBJECT_GROUPS}
    return allowed_by_key.get(normalized_text(group), group)


def get_academic_level_or_404(db: Session, academic_level_id: int) -> AcademicLevel:
    academic_level = db.query(AcademicLevel).filter(AcademicLevel.academic_level_id == academic_level_id).first()
    if academic_level is None:
        raise HTTPException(status_code=404, detail="Academic level not found.")
    return academic_level


def ensure_subject_code_available(
    db: Session,
    subject_codename: str | None,
    academic_level_id: int,
    exclude_subject_id: int | None = None,
) -> None:
    code = normalize_optional_text(subject_codename)
    if code is None:
        return

    query = (
        db.query(Subject)
        .filter(Subject.academic_level_id == academic_level_id)
        .filter(func.lower(Subject.subject_codename) == code.casefold())
    )
    if exclude_subject_id is not None:
        query = query.filter(Subject.subject_id != exclude_subject_id)

    if query.first() is not None:
        raise HTTPException(
            status_code=409,
            detail="Subject code already exists for this academic level.",
        )


def subject_to_item(subject: Subject, academic_level: AcademicLevel | None = None) -> dict:
    level = academic_level or subject.academic_level
    return {
        "subject_id": subject.subject_id,
        "subject_name": subject.subject_name,
        "subject_codename": subject.subject_codename,
        "subject_group": subject.subject_group,
        "hours": subject.hours,
        "default_grading_template": subject.default_grading_template,
        "description": subject.description,
        "status": subject.status or DEFAULT_SUBJECT_STATUS,
        "academic_level": {
            "academic_level_id": level.academic_level_id,
            "level_name": level.level_name,
            "grade_level": level.grade_level,
        },
        "created_at": subject.created_at,
        "updated_at": subject.updated_at,
    }
