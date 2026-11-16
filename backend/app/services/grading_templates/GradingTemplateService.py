from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject
from app.schemas.GradingTemplate import GradingTemplateCreate, GradingTemplateRevisionCreate, GradingTemplateUpdate
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


def _ensure_reassignments_confirmed(
    subjects: list[Subject], target_template_id: int | None, confirmed_subject_ids: list[int],
) -> None:
    moving_ids = {
        subject.subject_id
        for subject in subjects
        if subject.grading_template_id is not None
        and (target_template_id is None or subject.grading_template_id != target_template_id)
    }
    confirmed_ids = set(confirmed_subject_ids)
    unexpected = sorted(confirmed_ids - moving_ids)
    if unexpected:
        raise HTTPException(
            status_code=422,
            detail=f"Confirmed reassignment IDs are not pending moves: {unexpected}",
        )
    missing = sorted(moving_ids - confirmed_ids)
    if missing:
        raise HTTPException(status_code=409, detail={
            "code": "SUBJECT_REASSIGNMENT_CONFIRMATION_REQUIRED",
            "message": "Confirm each subject move before changing its grading template.",
            "subject_ids": missing,
        })


def create_grading_template_record(db: Session, payload: GradingTemplateCreate) -> dict:
    name = _ensure_unique_name(db, payload.template_name)
    components = normalized_components(payload.components)
    subjects = _subjects_for_ids(db, payload.subject_ids)
    status = normalize_status(payload.status)
    if status == "archived" and subjects:
        raise HTTPException(status_code=422, detail="An archived template cannot receive subject assignments.")
    _ensure_reassignments_confirmed(subjects, None, payload.confirmed_reassignment_subject_ids)
    _ensure_reassignment_unlocked(db, subjects)
    template = GradingTemplate(
        template_name=name,
        template_family_code=f"template-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
        revision=1,
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


def create_grading_template_revision(
    db: Session, grading_template_id: int, payload: GradingTemplateRevisionCreate, actor,
) -> dict:
    source = get_template_or_404(db, grading_template_id, for_update=True)
    components = normalized_components(payload.components)
    latest_revision = db.query(func.max(GradingTemplate.revision)).filter(
        GradingTemplate.template_family_code == source.template_family_code
    ).scalar() or source.revision
    target = GradingTemplate(
        template_name=source.template_name,
        template_family_code=source.template_family_code,
        revision=latest_revision + 1,
        supersedes_template_id=source.grading_template_id,
        policy_reference=normalize_optional_text(payload.policy_reference),
        change_reason=normalize_optional_text(payload.change_reason),
        created_by_user_id=actor,
        description=source.description,
        passing_threshold=source.passing_threshold,
        status=normalize_status(payload.status),
        updated_at=datetime.now(timezone.utc),
        components=[GradingTemplateComponent(**component) for component in components],
    )
    db.add(target)
    db.flush()
    if payload.subject_id is not None:
        subject = db.get(Subject, payload.subject_id)
        if subject is None:
            raise HTTPException(status_code=404, detail="Subject not found.")
        from app.services.subject_offerings.SubjectOfferingTemplateService import (
            set_subject_period_template, set_subject_year_template,
        )
        if payload.academic_period_id is not None:
            set_subject_period_template(
                db, subject=subject, academic_period_id=payload.academic_period_id,
                grading_template_id=target.grading_template_id,
                policy_reference=target.policy_reference, change_reason=target.change_reason or "Policy revision",
            )
        elif payload.academic_year_id is not None:
            set_subject_year_template(
                db, subject=subject, academic_year_id=payload.academic_year_id,
                grading_template_id=target.grading_template_id,
            )
        else:
            raise HTTPException(status_code=422, detail="Select an academic year or period for the subject assignment.")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A newer revision was created concurrently. Reload and try again.") from exc
    return template_to_item(get_template_or_404(db, target.grading_template_id), db)


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
        target_status = normalize_status(data.get("status", template.status))
        if target_status != "active" and requested:
            raise HTTPException(status_code=422, detail="An archived template cannot receive subject assignments.")
        _ensure_reassignments_confirmed(
            added,
            grading_template_id,
            data.get("confirmed_reassignment_subject_ids") or [],
        )
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
