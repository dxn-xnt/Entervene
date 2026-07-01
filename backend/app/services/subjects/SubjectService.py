from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.Subject import Subject
from app.schemas.Subject import SubjectCreate, SubjectUpdate
from app.services.subjects.SubjectShared import (
    DEFAULT_SUBJECT_STATUS,
    ensure_subject_code_available,
    get_academic_level_or_404,
    normalize_optional_text,
    normalize_subject_group,
    normalize_subject_status,
    subject_to_item,
)


def create_subject_record(db: Session, payload: SubjectCreate) -> dict:
    get_academic_level_or_404(db, payload.academic_level_id)
    subject_name = normalize_optional_text(payload.subject_name)
    if subject_name is None:
        raise HTTPException(status_code=422, detail="Subject name is required.")
    code = normalize_optional_text(payload.subject_codename)
    ensure_subject_code_available(db, code, payload.academic_level_id)

    subject = Subject(
        subject_name=subject_name,
        subject_codename=code,
        subject_group=normalize_subject_group(payload.subject_group),
        hours=payload.hours,
        default_grading_template=normalize_optional_text(payload.default_grading_template),
        description=normalize_optional_text(payload.description),
        status=normalize_subject_status(payload.status),
        academic_level_id=payload.academic_level_id,
    )
    db.add(subject)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to create subject because it conflicts with existing data.") from exc
    db.refresh(subject)
    return subject_to_item(subject)


def update_subject_record(db: Session, subject_id: int, payload: SubjectUpdate) -> dict:
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    data = payload.model_dump(exclude_unset=True)
    target_level_id = data.get("academic_level_id", subject.academic_level_id)
    if "academic_level_id" in data:
        get_academic_level_or_404(db, target_level_id)

    target_code = normalize_optional_text(data.get("subject_codename", subject.subject_codename))
    ensure_subject_code_available(db, target_code, target_level_id, exclude_subject_id=subject.subject_id)

    if "subject_name" in data:
        subject_name = normalize_optional_text(data["subject_name"])
        if subject_name is None:
            raise HTTPException(status_code=422, detail="Subject name is required.")
        subject.subject_name = subject_name
    if "subject_codename" in data:
        subject.subject_codename = target_code
    if "subject_group" in data:
        subject.subject_group = normalize_subject_group(data["subject_group"])
    if "hours" in data:
        subject.hours = data["hours"]
    if "default_grading_template" in data:
        subject.default_grading_template = normalize_optional_text(data["default_grading_template"])
    if "description" in data:
        subject.description = normalize_optional_text(data["description"])
    if "status" in data:
        subject.status = normalize_subject_status(data["status"])
    if "academic_level_id" in data:
        subject.academic_level_id = target_level_id

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to update subject because it conflicts with existing data.") from exc
    db.refresh(subject)
    return subject_to_item(subject)


def archive_subject_record(db: Session, subject_id: int) -> dict:
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")
    if (subject.status or DEFAULT_SUBJECT_STATUS).casefold() == "archived":
        raise HTTPException(status_code=409, detail="Subject is already archived.")
    subject.status = "archived"
    db.commit()
    db.refresh(subject)
    return subject_to_item(subject)


def restore_subject_record(db: Session, subject_id: int) -> dict:
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")
    subject.status = "active"
    db.commit()
    db.refresh(subject)
    return subject_to_item(subject)
