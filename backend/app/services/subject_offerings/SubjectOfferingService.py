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
from sqlalchemy import func
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
from app.models.academic.Subject import Subject
from app.services.subject_offerings.SubjectOfferingShared import (
    DEFAULT_OFFERING_STATUS,
    ensure_academic_year_is_active,
    ensure_offering_available,
    get_academic_year_or_404,
    get_offering_legacy_pathway,
    normalize_offering_status,
    offering_to_item,
    validate_core_subject_pathway_restriction,
    validate_offering_scope,
)


def _resolve_pathway_ids(db: Session, pathway_ids: list[int] | None, legacy_pathway: str | None, academic_level: AcademicLevel, academic_year_id: int, subject: Subject | None = None) -> list[int]:
    if subject and getattr(subject, "is_core", False):
        if pathway_ids is not None and len(pathway_ids) > 0:
            raise HTTPException(status_code=422, detail="Core subjects are mandatory for all pathways and cannot have pathway restrictions.")
        if pathway_ids is None and legacy_pathway is not None and legacy_pathway.strip().lower() not in ("general", ""):
            raise HTTPException(status_code=422, detail="Core subjects are mandatory for all pathways and cannot have pathway restrictions.")
        return []

    from app.services.pathways.PathwayScopeService import resolve_pathway_scope
    requires_pathway = resolve_pathway_scope(db, academic_year_id, academic_level.academic_level_id)

    if pathway_ids is not None and len(pathway_ids) > 0:
        if not requires_pathway:
            raise HTTPException(status_code=422, detail=f"Grade {academic_level.grade_level} offerings must use the general pathway for this academic year.")
        return pathway_ids
    if legacy_pathway is not None:
        norm = legacy_pathway.strip().lower()
        if not requires_pathway and norm not in ("general", ""):
            raise HTTPException(status_code=422, detail=f"Grade {academic_level.grade_level} offerings must use the general pathway for this academic year.")
        if requires_pathway and norm in ("general", ""):
            raise HTTPException(status_code=422, detail=f"Grade {academic_level.grade_level} offerings require a specific pathway for this academic year.")
        if norm in ("general", ""):
            return []
        if norm == "both":
            return [p.id for p in db.query(AcademicPathway).filter(AcademicPathway.is_enabled.is_(True)).all()]
        if norm in ("stem_medical", "medical"):
            p = db.query(AcademicPathway).filter(AcademicPathway.code.like("%medical%")).first()
            return [p.id] if p else []
        if norm in ("stem_engineering", "engineering"):
            p = db.query(AcademicPathway).filter(AcademicPathway.code.like("%engineering%")).first()
            return [p.id] if p else []
        p = db.query(AcademicPathway).filter(func.lower(AcademicPathway.code) == norm).first()
        if p:
            return [p.id]
    if requires_pathway:
        raise HTTPException(status_code=422, detail=f"Grade {academic_level.grade_level} offerings require a specific pathway for this academic year.")
    return []


def create_subject_offering_record(db: Session, payload: SubjectOfferingCreate) -> dict:
    subject, academic_year, academic_level, _period = validate_offering_scope(
        db,
        payload.subject_id,
        payload.academic_year_id,
        payload.academic_level_id,
        payload.academic_period_id,
    )
    ensure_academic_year_is_active(academic_year)
    pathway_ids = _resolve_pathway_ids(db, payload.pathway_ids, payload.pathway, academic_level, payload.academic_year_id, subject)
    validate_core_subject_pathway_restriction(subject, pathway_ids)

    ensure_offering_available(
        db,
        payload.subject_id,
        payload.academic_year_id,
        payload.academic_level_id,
        payload.academic_period_id,
        pathway_ids=pathway_ids,
    )

    offering = SubjectOffering(
        subject_id=payload.subject_id,
        academic_year_id=payload.academic_year_id,
        academic_level_id=payload.academic_level_id,
        academic_period_id=payload.academic_period_id,
        status=normalize_offering_status(payload.status),
    )
    db.add(offering)
    db.flush()

    for pid in pathway_ids:
        db.add(SubjectOfferingPathway(subject_offering_id=offering.subject_offering_id, pathway_id=pid))

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

    subject, academic_year, academic_level, _period = validate_offering_scope(db, target_subject_id, target_year_id, target_level_id, target_period_id)
    ensure_academic_year_is_active(academic_year)

    if "pathway_ids" in data or "pathway" in data:
        target_pathway_ids = _resolve_pathway_ids(db, data.get("pathway_ids"), data.get("pathway"), academic_level, target_year_id, subject)
    else:
        target_pathway_ids = [link.pathway_id for link in offering.offering_pathways]

    validate_core_subject_pathway_restriction(subject, target_pathway_ids)

    ensure_offering_available(
        db,
        target_subject_id,
        target_year_id,
        target_level_id,
        target_period_id,
        pathway_ids=target_pathway_ids,
        exclude_subject_offering_id=offering.subject_offering_id,
    )

    offering.subject_id = target_subject_id
    offering.academic_year_id = target_year_id
    offering.academic_level_id = target_level_id
    offering.academic_period_id = target_period_id
    if "status" in data:
        offering.status = normalize_offering_status(data["status"])

    if "pathway_ids" in data or "pathway" in data:
        db.query(SubjectOfferingPathway).filter(SubjectOfferingPathway.subject_offering_id == offering.subject_offering_id).delete()
        for pid in target_pathway_ids:
            db.add(SubjectOfferingPathway(subject_offering_id=offering.subject_offering_id, pathway_id=pid))

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
    pathway_ids = [p.pathway_id for p in db.query(SubjectOfferingPathway).filter(SubjectOfferingPathway.subject_offering_id == offering.subject_offering_id).all()]
    validate_core_subject_pathway_restriction(_subject, pathway_ids)
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

    from app.services.pathways.PathwayScopeService import clone_prior_year_pathway_scopes
    clone_prior_year_pathway_scopes(db, target_year.academic_year_id)

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
            get_offering_legacy_pathway(offering),
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
        pathways_by_base_scope.setdefault(base_key, set()).add(get_offering_legacy_pathway(offering))

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

        src_pw = get_offering_legacy_pathway(source_offering)
        scope_key = (
            source_offering.subject_id,
            source_offering.academic_level_id,
            target_period.academic_period_id,
            src_pw,
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
        if src_pw in existing_pathways:
            conflict_reason = "Subject offering already exists for this scope and pathway."
        elif src_pw == "both" and ({"stem_medical", "stem_engineering"} & existing_pathways):
            conflict_reason = "Shared offering conflicts with an existing pathway-specific offering."
        elif src_pw in {"stem_medical", "stem_engineering"} and "both" in existing_pathways:
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
                src_pw,
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
            status=normalize_offering_status(source_offering.status),
        )
        db.add(offering)
        db.flush()

        for link in source_offering.offering_pathways or []:
            db.add(SubjectOfferingPathway(subject_offering_id=offering.subject_offering_id, pathway_id=link.pathway_id))

        existing_by_scope[scope_key] = offering
        existing_pathways.add(src_pw)
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
