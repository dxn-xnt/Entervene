from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.Subject import Subject
from app.schemas.Subject import SubjectCreate, SubjectUpdate
from app.services.subjects.SubjectShared import (
    DEFAULT_SUBJECT_STATUS, ensure_subject_code_available,
    get_academic_level_or_404, get_template_or_422,
    normalize_optional_text, normalize_subject_status, subject_to_item,
)
from app.services.subject_offerings.SubjectOfferingShared import validate_subject_is_core_toggle


def _assert_assignment_unlocked(db: Session, subject_id: int) -> None:
    from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
    from app.models.classwork.Classwork import Classwork
    from app.models.classwork.ClassworkAssignment import ClassworkAssignment
    from app.models.submissions.StudentSubmission import StudentSubmission
    if db.query(StudentPeriodGrade.period_grade_id).filter_by(subject_id=subject_id).first():
        raise HTTPException(status_code=409, detail="A subject with recorded grades cannot change grading template.")
    submission = (db.query(StudentSubmission.submission_id)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(Classwork.subject_id == subject_id, StudentSubmission.grade.isnot(None)).first())
    if submission:
        raise HTTPException(status_code=409, detail="A subject with graded classwork cannot change grading template.")


def create_subject_record(db: Session, payload: SubjectCreate) -> dict:
    if payload.grading_template_id is None:
        raise HTTPException(status_code=422, detail="Grading template is required.")
    get_template_or_422(db, payload.grading_template_id)
    get_academic_level_or_404(db, payload.academic_level_id)
    name = normalize_optional_text(payload.subject_name)
    if name is None:
        raise HTTPException(status_code=422, detail="Subject name is required.")
    code = normalize_optional_text(payload.subject_codename)
    ensure_subject_code_available(db, code, payload.academic_level_id)
    subject = Subject(
        subject_name=name, subject_codename=code,
        grading_template_id=payload.grading_template_id,
        is_core=payload.is_core, is_math_or_science=payload.is_math_or_science,
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
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")
    data = payload.model_dump(exclude_unset=True)
    if "academic_level_id" in data and data["academic_level_id"] != subject.academic_level_id:
        raise HTTPException(status_code=400, detail="Grade level cannot be changed after a subject is created.")
    if "subject_group_id" in data or "default_grading_template" in data:
        raise HTTPException(status_code=422, detail="Use grading_template_id to assign a subject.")
    if "grading_template_id" in data:
        template_id = data["grading_template_id"]
        if template_id is None:
            raise HTTPException(status_code=422, detail="Grading template is required.")
        get_template_or_422(db, template_id)
        if template_id != subject.grading_template_id:
            _assert_assignment_unlocked(db, subject_id)
            subject.grading_template_id = template_id
    if "is_core" in data and data["is_core"] is not None:
        validate_subject_is_core_toggle(db, subject.subject_id, data["is_core"])
        subject.is_core = data["is_core"]
    code = normalize_optional_text(data.get("subject_codename", subject.subject_codename))
    ensure_subject_code_available(db, code, subject.academic_level_id, exclude_subject_id=subject_id)
    if "subject_name" in data:
        name = normalize_optional_text(data["subject_name"])
        if name is None:
            raise HTTPException(status_code=422, detail="Subject name is required.")
        subject.subject_name = name
    if "subject_codename" in data:
        subject.subject_codename = code
    if "is_math_or_science" in data and data["is_math_or_science"] is not None:
        subject.is_math_or_science = data["is_math_or_science"]
    if "description" in data:
        subject.description = normalize_optional_text(data["description"])
    if "status" in data:
        target = normalize_subject_status(data["status"])
        if target == "archived" and (subject.status or DEFAULT_SUBJECT_STATUS).casefold() != "archived":
            validate_subject_can_be_archived(db, subject)
        subject.status = target
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
