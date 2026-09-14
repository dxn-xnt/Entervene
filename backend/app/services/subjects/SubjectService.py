from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.Subject import Subject
from app.schemas.Subject import SubjectCreate, SubjectUpdate
from app.services.subjects.SubjectShared import (
    DEFAULT_SUBJECT_STATUS,
    ensure_subject_code_available,
    get_academic_level_or_404,
    get_subject_group_or_404,
    normalize_optional_text,
    normalize_subject_status,
    subject_to_item,
)


from app.services.subject_offerings.SubjectOfferingShared import validate_subject_is_core_toggle


def create_subject_record(db: Session, payload: SubjectCreate) -> dict:
    get_academic_level_or_404(db, payload.academic_level_id)
    get_subject_group_or_404(db, payload.subject_group_id)

    subject_name = normalize_optional_text(payload.subject_name)
    if subject_name is None:
        raise HTTPException(status_code=422, detail="Subject name is required.")
    code = normalize_optional_text(payload.subject_codename)
    ensure_subject_code_available(db, code, payload.academic_level_id)

    subject = Subject(
        subject_name=subject_name,
        subject_codename=code,
        subject_group_id=payload.subject_group_id,
        is_core=payload.is_core,
        is_math_or_science=payload.is_math_or_science,
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
    if "academic_level_id" in data and data["academic_level_id"] != subject.academic_level_id:
        raise HTTPException(
            status_code=400,
            detail="Grade level cannot be changed after a subject is created.",
        )

    if "subject_group_id" in data and data["subject_group_id"] is not None:
        get_subject_group_or_404(db, data["subject_group_id"])

    if "is_core" in data and data["is_core"] is not None:
        validate_subject_is_core_toggle(db, subject.subject_id, data["is_core"])

    target_code = normalize_optional_text(data.get("subject_codename", subject.subject_codename))
    ensure_subject_code_available(db, target_code, subject.academic_level_id, exclude_subject_id=subject.subject_id)

    if "subject_name" in data:
        subject_name = normalize_optional_text(data["subject_name"])
        if subject_name is None:
            raise HTTPException(status_code=422, detail="Subject name is required.")
        subject.subject_name = subject_name
    if "subject_codename" in data:
        subject.subject_codename = target_code
    if "subject_group_id" in data and data["subject_group_id"] is not None:
        subject.subject_group_id = data["subject_group_id"]
    if "is_core" in data and data["is_core"] is not None:
        subject.is_core = data["is_core"]
    if "is_math_or_science" in data and data["is_math_or_science"] is not None:
        subject.is_math_or_science = data["is_math_or_science"]
    if "default_grading_template" in data:
        subject.default_grading_template = normalize_optional_text(data["default_grading_template"])
    if "description" in data:
        subject.description = normalize_optional_text(data["description"])
    if "status" in data:
        target_status = normalize_subject_status(data["status"])
        if target_status == "archived" and (subject.status or DEFAULT_SUBJECT_STATUS).casefold() != "archived":
            validate_subject_can_be_archived(db, subject)
        subject.status = target_status

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Unable to update subject because it conflicts with existing data.") from exc
    db.refresh(subject)
    return subject_to_item(subject)


def validate_subject_can_be_archived(db: Session, subject: Subject) -> None:
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.AcademicYear import AcademicYear
    from app.models.academic.Class_ import Class
    from app.models.academic.SubjectLoad import SubjectLoad
    from app.models.academic.SubjectOffering import SubjectOffering

    # 1. Check for active offerings in an active academic year
    active_offering = (
        db.query(SubjectOffering, AcademicYear)
        .join(AcademicYear, SubjectOffering.academic_year_id == AcademicYear.academic_year_id)
        .filter(
            SubjectOffering.subject_id == subject.subject_id,
            SubjectOffering.status == "active",
            AcademicYear.is_active.is_(True),
        )
        .first()
    )
    if active_offering:
        _, year = active_offering
        raise HTTPException(
            status_code=409,
            detail=f"Cannot archive '{subject.subject_name}' because it has active curriculum offerings in School Year {year.year_label}. Please remove or archive those offerings first.",
        )

    # 2. Check for active or published class schedules in an active academic year
    active_load = (
        db.query(SubjectLoad, AcademicYear, Class)
        .join(AcademicPeriod, SubjectLoad.academic_period_id == AcademicPeriod.academic_period_id)
        .join(AcademicYear, AcademicPeriod.academic_year_id == AcademicYear.academic_year_id)
        .outerjoin(Class, SubjectLoad.class_id == Class.class_id)
        .filter(
            SubjectLoad.subject_id == subject.subject_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
            AcademicYear.is_active.is_(True),
        )
        .first()
    )
    if active_load:
        _, year, cls = active_load
        section_detail = f" (section '{cls.section_name}')" if cls else ""
        raise HTTPException(
            status_code=409,
            detail=f"Cannot archive '{subject.subject_name}' because it is assigned to active class schedules{section_detail} in School Year {year.year_label}. Please reassign or archive those schedules first.",
        )


def archive_subject_record(db: Session, subject_id: int) -> dict:
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")
    if (subject.status or DEFAULT_SUBJECT_STATUS).casefold() == "archived":
        raise HTTPException(status_code=409, detail="Subject is already archived.")
    validate_subject_can_be_archived(db, subject)
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
