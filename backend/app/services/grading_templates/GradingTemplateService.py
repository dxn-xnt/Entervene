from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.schemas.GradingTemplate import GradingTemplateCreate, GradingTemplateUpdate
from app.services.grading_templates.GradingTemplateShared import (
    DEFAULT_GRADING_TEMPLATE_STATUS,
    ensure_template_name_available,
    normalize_optional_text,
    normalize_status,
    normalized_components,
    template_to_item,
    validate_scope,
)


def get_template_or_404(db: Session, grading_template_id: int) -> GradingTemplate:
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
        raise HTTPException(status_code=404, detail="Grading template not found.")
    return template


def replace_components(template: GradingTemplate, components: list[dict], db: Session | None = None) -> None:
    template.components.clear()
    if db is not None and template.grading_template_id is not None:
        db.flush()
    for component in components:
        template.components.append(
            GradingTemplateComponent(
                component_name=component["component_name"],
                weight=component["weight"],
                display_order=component["display_order"],
            )
        )


def create_grading_template_record(db: Session, payload: GradingTemplateCreate) -> dict:
    template_name = normalize_optional_text(payload.template_name)
    if template_name is None:
        raise HTTPException(status_code=422, detail="Template name is required.")

    validate_scope(db, payload.academic_level_id, payload.subject_id)
    ensure_template_name_available(db, template_name, payload.academic_level_id, payload.subject_id)
    components = normalized_components(payload.components)

    template = GradingTemplate(
        template_name=template_name,
        description=normalize_optional_text(payload.description),
        academic_level_id=payload.academic_level_id,
        subject_id=payload.subject_id,
        status=normalize_status(payload.status),
    )
    replace_components(template, components)
    db.add(template)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to create grading template because it conflicts with existing data.") from exc
    db.refresh(template)
    return template_to_item(get_template_or_404(db, template.grading_template_id))


def update_grading_template_record(db: Session, grading_template_id: int, payload: GradingTemplateUpdate) -> dict:
    template = get_template_or_404(db, grading_template_id)
    data = payload.model_dump(exclude_unset=True)

    target_name = normalize_optional_text(data.get("template_name", template.template_name))
    if target_name is None:
        raise HTTPException(status_code=422, detail="Template name is required.")

    target_level_id = data.get("academic_level_id", template.academic_level_id)
    target_subject_id = data.get("subject_id", template.subject_id)
    validate_scope(db, target_level_id, target_subject_id)
    ensure_template_name_available(
        db,
        target_name,
        target_level_id,
        target_subject_id,
        exclude_template_id=template.grading_template_id,
    )

    if "template_name" in data:
        template.template_name = target_name
    if "description" in data:
        template.description = normalize_optional_text(data["description"])
    if "academic_level_id" in data:
        template.academic_level_id = target_level_id
    if "subject_id" in data:
        template.subject_id = target_subject_id
    if "status" in data:
        template.status = normalize_status(data["status"])
    if "components" in data:
        replace_components(template, normalized_components(payload.components or []), db=db)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to update grading template because it conflicts with existing data.") from exc
    return template_to_item(get_template_or_404(db, grading_template_id))


def archive_grading_template_record(db: Session, grading_template_id: int) -> dict:
    template = get_template_or_404(db, grading_template_id)
    if (template.status or DEFAULT_GRADING_TEMPLATE_STATUS).casefold() == "archived":
        raise HTTPException(status_code=409, detail="Grading template is already archived.")
    template.status = "archived"
    db.commit()
    return template_to_item(get_template_or_404(db, grading_template_id))


def restore_grading_template_record(db: Session, grading_template_id: int) -> dict:
    template = get_template_or_404(db, grading_template_id)
    template.status = "active"
    db.commit()
    return template_to_item(get_template_or_404(db, grading_template_id))
