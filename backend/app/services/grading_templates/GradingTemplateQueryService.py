from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.Subject import Subject
from app.services.grading_templates.GradingTemplateShared import (
    ALLOWED_GRADING_TEMPLATE_STATUSES,
    DEFAULT_GRADING_TEMPLATE_COMPONENTS,
    DEFAULT_GRADING_TEMPLATE_STATUS,
    normalize_optional_text,
    normalize_status,
    template_to_item,
)


def get_grading_template_form_options_data(db: Session) -> dict:
    academic_levels = (
        db.query(AcademicLevel)
        .order_by(AcademicLevel.grade_level, func.lower(AcademicLevel.level_name))
        .all()
    )
    subjects = (
        db.query(Subject)
        .order_by(Subject.academic_level_id, func.lower(Subject.subject_name))
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
        "subjects": [
            {
                "subject_id": subject.subject_id,
                "subject_name": subject.subject_name,
                "subject_codename": subject.subject_codename,
                "academic_level_id": subject.academic_level_id,
            }
            for subject in subjects
        ],
        "statuses": ALLOWED_GRADING_TEMPLATE_STATUSES,
        "default_status": DEFAULT_GRADING_TEMPLATE_STATUS,
        "default_components": DEFAULT_GRADING_TEMPLATE_COMPONENTS,
    }


def list_grading_templates_data(
    db: Session,
    status: str | None = None,
    academic_level_id: int | None = None,
    subject_id: int | None = None,
    search: str = "",
) -> dict:
    base_query = db.query(GradingTemplate)
    all_templates = base_query.all()

    query = base_query.options(
        joinedload(GradingTemplate.academic_level),
        joinedload(GradingTemplate.subject),
        joinedload(GradingTemplate.components),
    )
    if status is not None:
        query = query.filter(func.lower(GradingTemplate.status) == normalize_status(status))
    if academic_level_id is not None:
        query = query.filter(GradingTemplate.academic_level_id == academic_level_id)
    if subject_id is not None:
        query = query.filter(GradingTemplate.subject_id == subject_id)

    search_term = normalize_optional_text(search)
    if search_term is not None:
        like_term = f"%{search_term.casefold()}%"
        query = query.filter(
            or_(
                func.lower(GradingTemplate.template_name).like(like_term),
                func.lower(func.coalesce(GradingTemplate.description, "")).like(like_term),
            )
        )

    templates = query.order_by(func.lower(GradingTemplate.template_name)).all()
    return {
        "summary": {
            "total_templates": len(all_templates),
            "active_templates": sum(1 for item in all_templates if (item.status or DEFAULT_GRADING_TEMPLATE_STATUS).casefold() == "active"),
            "archived_templates": sum(1 for item in all_templates if (item.status or "").casefold() == "archived"),
        },
        "grading_templates": [template_to_item(template) for template in templates],
    }


def get_grading_template_detail_data(db: Session, grading_template_id: int) -> dict:
    template = (
        db.query(GradingTemplate)
        .options(
            joinedload(GradingTemplate.academic_level),
            joinedload(GradingTemplate.subject),
            joinedload(GradingTemplate.components),
        )
        .filter(GradingTemplate.grading_template_id == grading_template_id)
        .first()
    )
    if template is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Grading template not found.")
    return template_to_item(template)
