from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.Subject import Subject

ALLOWED_SUBJECT_STATUSES = ["active", "archived"]
DEFAULT_SUBJECT_STATUS = "active"


def readable_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalized_text(value: Any) -> str:
    return readable_text(value).casefold()


def normalize_optional_text(value: Any) -> str | None:
    return readable_text(value) or None


def normalize_subject_status(value: Any) -> str:
    status = normalized_text(value or DEFAULT_SUBJECT_STATUS)
    if status not in ALLOWED_SUBJECT_STATUSES:
        raise HTTPException(status_code=422, detail="Subject status must be active or archived.")
    return status


def get_academic_level_or_404(db: Session, academic_level_id: int) -> AcademicLevel:
    level = db.get(AcademicLevel, academic_level_id)
    if level is None:
        raise HTTPException(status_code=404, detail="Academic level not found.")
    return level


def get_template_or_422(db: Session, template_id: int) -> GradingTemplate:
    template = db.get(GradingTemplate, template_id)
    if template is None or template.status != "active":
        raise HTTPException(status_code=422, detail="Select an active grading template.")
    return template


def ensure_subject_code_available(db: Session, subject_codename: str | None, academic_level_id: int,
                                  exclude_subject_id: int | None = None) -> None:
    code = normalize_optional_text(subject_codename)
    if code is None:
        return
    query = db.query(Subject).filter(Subject.academic_level_id == academic_level_id)
    query = query.filter(func.lower(Subject.subject_codename) == code.casefold())
    if exclude_subject_id is not None:
        query = query.filter(Subject.subject_id != exclude_subject_id)
    if query.first() is not None:
        raise HTTPException(status_code=409, detail="Subject code already exists for this academic level.")


def subject_to_item(subject: Subject, academic_level: AcademicLevel | None = None,
                    template_name_map: dict[str, str] | None = None) -> dict:
    level = academic_level or subject.academic_level
    template = subject.grading_template
    return {
        "subject_id": subject.subject_id,
        "subject_name": subject.subject_name,
        "subject_codename": subject.subject_codename,
        "grading_template_id": subject.grading_template_id,
        "grading_template": {
            "grading_template_id": template.grading_template_id,
            "template_name": template.template_name,
            "passing_threshold": float(template.passing_threshold),
            "components": [{"component_name": c.component_name, "weight": float(c.weight)} for c in template.components],
        },
        "is_core": bool(subject.is_core),
        "is_math_or_science": bool(subject.is_math_or_science),
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
