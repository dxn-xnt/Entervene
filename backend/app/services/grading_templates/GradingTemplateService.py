from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject
from app.schemas.GradingTemplate import GradingTemplateCreate, GradingTemplateUpdate
from app.services.grading_templates.GradingTemplateShared import (
    check_template_locked, normalize_optional_text, normalize_status,
    normalized_components, template_to_item,
)


def get_template_or_404(db: Session, grading_template_id: int, for_update: bool = False) -> GradingTemplate:
    query = db.query(GradingTemplate).options(joinedload(GradingTemplate.components)).filter_by(
        grading_template_id=grading_template_id,
    )
    if for_update:
        query = query.with_for_update(of=GradingTemplate)
    template = query.first()
    if template is None:
        raise HTTPException(status_code=404, detail="Grading template not found.")
    return template


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _ensure_unique_name(
    db: Session, template_name: str, exclude_template_id: int | None = None,
) -> str:
    name = normalize_optional_text(template_name)
    if name is None:
        raise HTTPException(status_code=422, detail="Template name is required.")
    query = db.query(GradingTemplate.grading_template_id).filter(
        func.lower(GradingTemplate.template_name) == name.casefold(),
    )
    if exclude_template_id is not None:
        query = query.filter(GradingTemplate.grading_template_id != exclude_template_id)
    if query.first():
        raise HTTPException(status_code=409, detail="A grading template with this name already exists.")
    return name


def _subjects_for_ids(db: Session, subject_ids: list[int]) -> list[Subject]:
    unique_ids = list(dict.fromkeys(subject_ids))
    subjects = (
        db.query(Subject).filter(Subject.subject_id.in_(unique_ids)).with_for_update().all()
        if unique_ids else []
    )
    found = {subject.subject_id for subject in subjects}
    missing = sorted(set(unique_ids) - found)
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown subject IDs: {missing}")
    return subjects


def _ensure_reassignment_unlocked(db: Session, subjects: list[Subject]) -> None:
    from app.services.subjects.SubjectService import _assert_assignment_unlocked
    for subject in subjects:
        _assert_assignment_unlocked(db, subject.subject_id)


def create_grading_template_record(db: Session, payload: GradingTemplateCreate) -> dict:
    name = _ensure_unique_name(db, payload.template_name)
    components = normalized_components(payload.components)
    subjects = _subjects_for_ids(db, payload.subject_ids)
    status = normalize_status(payload.status)
    if status == "archived" and subjects:
        raise HTTPException(status_code=422, detail="An archived template cannot receive subject assignments.")
    _ensure_reassignment_unlocked(db, subjects)
    template = GradingTemplate(
        template_name=name,
        description=normalize_optional_text(payload.description),
        passing_threshold=payload.passing_threshold,
        status=status,
        updated_at=datetime.now(timezone.utc),
    )
    template.components = [GradingTemplateComponent(**component) for component in components]
    db.add(template)
    db.flush()
    for subject in subjects:
        subject.grading_template_id = template.grading_template_id
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to create grading template because it conflicts with existing data.") from exc
    return template_to_item(get_template_or_404(db, template.grading_template_id), db)


def update_grading_template_record(db: Session, grading_template_id: int, payload: GradingTemplateUpdate) -> dict:
    template = get_template_or_404(db, grading_template_id, for_update=True)
    data = payload.model_dump(exclude_unset=True)
    if "passing_threshold" in data:
        raise HTTPException(status_code=422, detail={
            "code": "THRESHOLD_AUDIT_REQUIRED",
            "message": "Use the audited passing-threshold action to edit this value.",
        })
    expected = data.get("updated_at")
    if expected is None:
        raise HTTPException(status_code=428, detail="Reload the template before saving changes.")
    actual = template.updated_at
    if actual is None or _utc(expected) != _utc(actual):
        raise HTTPException(status_code=409, detail="This template changed. Reload it before saving.")
    changed = any(key in data for key in (
        "template_name", "description", "passing_threshold", "status", "subject_ids", "components",
    ))
    if not changed:
        return template_to_item(template, db)
    configuration_changed = any(key in data for key in (
        "template_name", "description", "passing_threshold", "status", "components",
    ))
    if configuration_changed:
        locked, reason = check_template_locked(db, template)
        if locked:
            raise HTTPException(status_code=409, detail=reason or "Template is locked.")
    if "template_name" in data:
        template.template_name = _ensure_unique_name(db, data["template_name"], grading_template_id)
    if "description" in data:
        template.description = normalize_optional_text(data["description"])
    if "passing_threshold" in data:
        if data["passing_threshold"] is None:
            raise HTTPException(status_code=422, detail="Passing threshold is required.")
        template.passing_threshold = data["passing_threshold"]
    if "components" in data:
        components = normalized_components(payload.components or [])
        template.components.clear()
        db.flush()
        template.components.extend(GradingTemplateComponent(**component) for component in components)
    if "subject_ids" in data:
        requested = _subjects_for_ids(db, data["subject_ids"] or [])
        requested_ids = {subject.subject_id for subject in requested}
        current = (
            db.query(Subject)
            .filter(Subject.grading_template_id == grading_template_id)
            .with_for_update()
            .all()
        )
        removed = [subject for subject in current if subject.subject_id not in requested_ids]
        added = [subject for subject in requested if subject.grading_template_id != grading_template_id]
        _ensure_reassignment_unlocked(db, [*removed, *added])
        if removed:
            replacement_id = data.get("replacement_template_id")
            if replacement_id is None or replacement_id == grading_template_id:
                raise HTTPException(
                    status_code=422,
                    detail="Choose a different replacement template for removed subjects.",
                )
            replacement = get_template_or_404(db, replacement_id)
            if normalize_status(replacement.status) != "active":
                raise HTTPException(status_code=422, detail="Replacement template must be active.")
            for subject in removed:
                subject.grading_template_id = replacement_id
        for subject in added:
            subject.grading_template_id = grading_template_id
    if "status" in data:
        target_status = normalize_status(data["status"])
        assigned_count = db.query(Subject.subject_id).filter(
            Subject.grading_template_id == grading_template_id,
        ).count()
        if target_status == "archived" and assigned_count:
            raise HTTPException(status_code=409, detail="Reassign all subjects before archiving this template.")
        template.status = target_status
    template.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to update grading template because it conflicts with existing data.") from exc
    return template_to_item(get_template_or_404(db, grading_template_id), db)
