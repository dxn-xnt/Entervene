from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.SubjectOffering import SubjectOffering
from app.schemas.SubjectOffering import SubjectOfferingCreate, SubjectOfferingUpdate
from app.services.subject_offerings.SubjectOfferingShared import (
    DEFAULT_OFFERING_STATUS,
    ensure_offering_available,
    normalize_offering_status,
    normalize_pathway,
    offering_to_item,
    validate_pathway_for_grade,
    validate_offering_scope,
)


def create_subject_offering_record(db: Session, payload: SubjectOfferingCreate) -> dict:
    _subject, _year, academic_level, _period = validate_offering_scope(
        db,
        payload.subject_id,
        payload.academic_year_id,
        payload.academic_level_id,
        payload.academic_period_id,
    )
    pathway = normalize_pathway(payload.pathway)
    validate_pathway_for_grade(pathway, academic_level)
    ensure_offering_available(
        db,
        payload.subject_id,
        payload.academic_year_id,
        payload.academic_level_id,
        payload.academic_period_id,
        pathway,
    )

    offering = SubjectOffering(
        subject_id=payload.subject_id,
        academic_year_id=payload.academic_year_id,
        academic_level_id=payload.academic_level_id,
        academic_period_id=payload.academic_period_id,
        pathway=pathway,
        status=normalize_offering_status(payload.status),
    )
    db.add(offering)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to create subject offering because it conflicts with existing data.") from exc
    db.refresh(offering)
    return offering_to_item(offering)


def update_subject_offering_record(db: Session, subject_offering_id: int, payload: SubjectOfferingUpdate) -> dict:
    offering = db.query(SubjectOffering).filter(SubjectOffering.subject_offering_id == subject_offering_id).first()
    if offering is None:
        raise HTTPException(status_code=404, detail="Subject offering not found.")

    data = payload.model_dump(exclude_unset=True)
    target_subject_id = data.get("subject_id", offering.subject_id)
    target_year_id = data.get("academic_year_id", offering.academic_year_id)
    target_level_id = data.get("academic_level_id", offering.academic_level_id)
    target_period_id = data.get("academic_period_id", offering.academic_period_id)
    target_pathway = normalize_pathway(data.get("pathway", offering.pathway))

    _subject, _year, academic_level, _period = validate_offering_scope(db, target_subject_id, target_year_id, target_level_id, target_period_id)
    validate_pathway_for_grade(target_pathway, academic_level)
    ensure_offering_available(
        db,
        target_subject_id,
        target_year_id,
        target_level_id,
        target_period_id,
        target_pathway,
        exclude_subject_offering_id=offering.subject_offering_id,
    )

    offering.subject_id = target_subject_id
    offering.academic_year_id = target_year_id
    offering.academic_level_id = target_level_id
    offering.academic_period_id = target_period_id
    offering.pathway = target_pathway
    if "status" in data:
        offering.status = normalize_offering_status(data["status"])

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to update subject offering because it conflicts with existing data.") from exc
    db.refresh(offering)
    return offering_to_item(offering)


def archive_subject_offering_record(db: Session, subject_offering_id: int) -> dict:
    offering = db.query(SubjectOffering).filter(SubjectOffering.subject_offering_id == subject_offering_id).first()
    if offering is None:
        raise HTTPException(status_code=404, detail="Subject offering not found.")
    if (offering.status or DEFAULT_OFFERING_STATUS).casefold() == "archived":
        raise HTTPException(status_code=409, detail="Subject offering is already archived.")
    offering.status = "archived"
    db.commit()
    db.refresh(offering)
    return offering_to_item(offering)


def restore_subject_offering_record(db: Session, subject_offering_id: int) -> dict:
    offering = db.query(SubjectOffering).filter(SubjectOffering.subject_offering_id == subject_offering_id).first()
    if offering is None:
        raise HTTPException(status_code=404, detail="Subject offering not found.")
    _subject, _year, academic_level, _period = validate_offering_scope(
        db,
        offering.subject_id,
        offering.academic_year_id,
        offering.academic_level_id,
        offering.academic_period_id,
    )
    validate_pathway_for_grade(offering.pathway, academic_level)
    offering.status = "active"
    db.commit()
    db.refresh(offering)
    return offering_to_item(offering)
