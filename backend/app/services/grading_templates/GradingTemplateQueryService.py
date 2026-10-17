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
    return {"default_components": DEFAULT_GRADING_TEMPLATE_COMPONENTS}


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
        joinedload(GradingTemplate.components),
    )
    if status is not None:
        query = query.filter(func.lower(GradingTemplate.status) == normalize_status(status))
    if academic_level_id is not None or subject_id is not None:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="Template scope filters are no longer supported.")

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
        "grading_templates": [template_to_item(template, db) for template in templates],
    }


def get_grading_template_detail_data(db: Session, grading_template_id: int) -> dict:
    template = (
        db.query(GradingTemplate)
        .options(
            joinedload(GradingTemplate.components),
        )
        .filter(GradingTemplate.grading_template_id == grading_template_id)
        .first()
    )
    if template is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Grading template not found.")
    return template_to_item(template, db)
