from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.SubjectOffering import SubjectOffering
from app.schemas.SubjectOffering import (
    SubjectOfferingCopyAcademicYearRequest,
    SubjectOfferingCreate,
    SubjectOfferingUpdate,
)
from app.services.subject_offerings.SubjectOfferingShared import (
    DEFAULT_OFFERING_STATUS,
    ensure_academic_year_is_active,
    ensure_offering_available,
    get_academic_year_or_404,
    normalize_offering_status,
    normalize_pathway,
    offering_to_item,
    validate_pathway_for_grade,
    validate_offering_scope,
)


def create_subject_offering_record(db: Session, payload: SubjectOfferingCreate) -> dict:
    _subject, academic_year, academic_level, _period = validate_offering_scope(
        db,
        payload.subject_id,
        payload.academic_year_id,
        payload.academic_level_id,
        payload.academic_period_id,
    )
    ensure_academic_year_is_active(academic_year)
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
    ensure_academic_year_is_active(get_academic_year_or_404(db, offering.academic_year_id))

    data = payload.model_dump(exclude_unset=True)
    target_subject_id = data.get("subject_id", offering.subject_id)
    target_year_id = data.get("academic_year_id", offering.academic_year_id)
    target_level_id = data.get("academic_level_id", offering.academic_level_id)
    target_period_id = data.get("academic_period_id", offering.academic_period_id)
    target_pathway = normalize_pathway(data.get("pathway", offering.pathway))

    _subject, academic_year, academic_level, _period = validate_offering_scope(db, target_subject_id, target_year_id, target_level_id, target_period_id)
    ensure_academic_year_is_active(academic_year)
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
    ensure_academic_year_is_active(get_academic_year_or_404(db, offering.academic_year_id))
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
    _subject, academic_year, academic_level, _period = validate_offering_scope(
        db,
        offering.subject_id,
        offering.academic_year_id,
        offering.academic_level_id,
        offering.academic_period_id,
    )
    ensure_academic_year_is_active(academic_year)
    validate_pathway_for_grade(offering.pathway, academic_level)
    offering.status = "active"
    db.commit()
    db.refresh(offering)
    return offering_to_item(offering)


def copy_subject_offerings_between_academic_years(
    db: Session,
    payload: SubjectOfferingCopyAcademicYearRequest,
) -> dict:
    source_year = get_academic_year_or_404(db, payload.source_academic_year_id)
    target_year = get_academic_year_or_404(db, payload.target_academic_year_id)
    ensure_academic_year_is_active(target_year)

    if source_year.academic_year_id == target_year.academic_year_id:
        raise HTTPException(status_code=409, detail="Source and target academic years must be different.")

    target_periods_by_sequence = {
        period.period_sequence: period
        for period in db.query(AcademicPeriod)
        .filter(AcademicPeriod.academic_year_id == target_year.academic_year_id)
        .all()
    }
    source_offerings = (
        db.query(SubjectOffering)
        .join(AcademicPeriod, SubjectOffering.academic_period_id == AcademicPeriod.academic_period_id)
        .filter(SubjectOffering.academic_year_id == source_year.academic_year_id)
        .order_by(AcademicPeriod.period_sequence, SubjectOffering.subject_offering_id)
        .all()
    )

    existing_target_offerings = (
        db.query(SubjectOffering)
        .filter(SubjectOffering.academic_year_id == target_year.academic_year_id)
        .all()
    )
    existing_by_scope = {
        (
            offering.subject_id,
            offering.academic_level_id,
            offering.academic_period_id,
            offering.pathway,
        ): offering
        for offering in existing_target_offerings
    }
    pathways_by_base_scope: dict[tuple[int, int, int], set[str]] = {}
    for offering in existing_target_offerings:
        base_key = (
            offering.subject_id,
            offering.academic_level_id,
            offering.academic_period_id,
        )
        pathways_by_base_scope.setdefault(base_key, set()).add(offering.pathway)

    created_count = 0
    updated_count = 0
    skipped: list[dict] = []

    for source_offering in source_offerings:
        source_period = source_offering.academic_period
        target_period = target_periods_by_sequence.get(source_period.period_sequence)
        if target_period is None:
            skipped.append({
                "subject_id": source_offering.subject_id,
                "source_subject_offering_id": source_offering.subject_offering_id,
                "reason": f"Matching target period not found for period_sequence {source_period.period_sequence}.",
            })
            continue

        scope_key = (
            source_offering.subject_id,
            source_offering.academic_level_id,
            target_period.academic_period_id,
            source_offering.pathway,
        )
        base_scope_key = (
            source_offering.subject_id,
            source_offering.academic_level_id,
            target_period.academic_period_id,
        )
        existing = existing_by_scope.get(scope_key)
        if existing is not None:
            if payload.overwrite_existing:
                existing.status = normalize_offering_status(source_offering.status)
                updated_count += 1
            else:
                skipped.append({
                    "subject_id": source_offering.subject_id,
                    "source_subject_offering_id": source_offering.subject_offering_id,
                    "reason": "Duplicate target subject offering already exists.",
                })
            continue

        existing_pathways = pathways_by_base_scope.setdefault(base_scope_key, set())
        conflict_reason = None
        if source_offering.pathway in existing_pathways:
            conflict_reason = "Subject offering already exists for this scope and pathway."
        elif source_offering.pathway == "both" and ({"stem_medical", "stem_engineering"} & existing_pathways):
            conflict_reason = "Shared offering conflicts with an existing pathway-specific offering."
        elif source_offering.pathway in {"stem_medical", "stem_engineering"} and "both" in existing_pathways:
            conflict_reason = "Pathway-specific offering conflicts with an existing shared offering."

        if conflict_reason:
            skipped.append({
                "subject_id": source_offering.subject_id,
                "source_subject_offering_id": source_offering.subject_offering_id,
                "reason": conflict_reason,
            })
            continue

        try:
            ensure_offering_available(
                db,
                source_offering.subject_id,
                target_year.academic_year_id,
                source_offering.academic_level_id,
                target_period.academic_period_id,
                source_offering.pathway,
            )
        except HTTPException as exc:
            skipped.append({
                "subject_id": source_offering.subject_id,
                "source_subject_offering_id": source_offering.subject_offering_id,
                "reason": str(exc.detail),
            })
            continue

        offering = SubjectOffering(
            subject_id=source_offering.subject_id,
            academic_year_id=target_year.academic_year_id,
            academic_level_id=source_offering.academic_level_id,
            academic_period_id=target_period.academic_period_id,
            pathway=source_offering.pathway,
            status=normalize_offering_status(source_offering.status),
        )
        db.add(offering)
        existing_by_scope[scope_key] = offering
        existing_pathways.add(source_offering.pathway)
        created_count += 1

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to copy subject offerings because they conflict with existing data.") from exc

    return {
        "source_academic_year_id": source_year.academic_year_id,
        "target_academic_year_id": target_year.academic_year_id,
        "created_count": created_count,
        "updated_count": updated_count,
        "skipped_count": len(skipped),
        "skipped": skipped,
    }
