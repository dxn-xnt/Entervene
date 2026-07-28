from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.schemas.GradingTemplate import GradingTemplateCreate, GradingTemplateUpdate
from app.models.academic.Subject import Subject
from app.services.grading_templates.GradingTemplateShared import (
    DEFAULT_GRADING_TEMPLATE_STATUS,
    check_template_locked,
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


def sync_subject_assignments(db: Session, template: GradingTemplate, subject_ids: list[int] | None) -> None:
    if subject_ids is None:
        return
    # Find all subjects currently linked
    existing = db.query(Subject).filter(
        (Subject.default_grading_template == template.template_name) |
        (Subject.default_grading_template == str(template.grading_template_id)) |
        (Subject.subject_id == template.subject_id)
    ).all()
    
    target_ids = set(subject_ids)
    for sub in existing:
        if sub.subject_id not in target_ids:
            sub.default_grading_template = None
            
    if target_ids:
        new_subjects = db.query(Subject).filter(Subject.subject_id.in_(target_ids)).all()
        for sub in new_subjects:
            sub.default_grading_template = template.template_name


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
    
    if payload.subject_ids:
        sync_subject_assignments(db, template, payload.subject_ids)
        db.commit()
        
    return template_to_item(get_template_or_404(db, template.grading_template_id), db)


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

    if "components" in data and payload.components is not None:
        is_locked, lock_reason = check_template_locked(db, template)
        if is_locked:
            raise HTTPException(
                status_code=422,
                detail="Template weights cannot be modified after the term has started. Please create a new template.",
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
    if "components" in data and payload.components is not None:
        replace_components(template, normalized_components(payload.components), db=db)

    if "subject_ids" in data:
        sync_subject_assignments(db, template, payload.subject_ids)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to update grading template because it conflicts with existing data.") from exc
    return template_to_item(get_template_or_404(db, grading_template_id), db)


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
