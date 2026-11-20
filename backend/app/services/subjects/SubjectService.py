from fastapi import HTTPException
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.Subject import Subject
from app.schemas.Subject import SubjectCreate, SubjectUpdate
from app.services.subjects.SubjectCodeGenerator import (
    SubjectCodeConflictError,
    SubjectCodeGenerationError,
    generate_subject_code,
    normalize_subject_code,
    normalize_subject_name,
)
from app.services.subjects.SubjectShared import (
    DEFAULT_SUBJECT_STATUS,
    get_academic_level_or_404, get_template_or_422,
    normalize_optional_text, normalize_subject_status, subject_to_item,
)
from app.services.subject_offerings.SubjectOfferingShared import validate_subject_is_core_toggle


def find_subject_name_conflict(
    db: Session,
    subject_name: str,
    academic_level_id: int,
    *,
    exclude_subject_id: int | None = None,
    active_only: bool = False,
) -> Subject | None:
    normalized_name = normalize_subject_name(subject_name)
    active_rank = case(
        (func.lower(func.coalesce(Subject.status, DEFAULT_SUBJECT_STATUS)) == "active", 0),
        else_=1,
    )
    query = db.query(Subject).filter(Subject.academic_level_id == academic_level_id)
    if active_only:
        query = query.filter(
            func.lower(func.coalesce(Subject.status, DEFAULT_SUBJECT_STATUS)) == "active"
        )
    if exclude_subject_id is not None:
        query = query.filter(Subject.subject_id != exclude_subject_id)
    for subject in query.order_by(active_rank.asc(), Subject.subject_id.asc()).all():
        if normalize_subject_name(subject.subject_name) == normalized_name:
            return subject
    return None


def _ensure_subject_name_available(
    db: Session,
    subject_name: str,
    academic_level_id: int,
    *,
    exclude_subject_id: int | None = None,
) -> None:
    conflict = find_subject_name_conflict(
        db,
        subject_name,
        academic_level_id,
        exclude_subject_id=exclude_subject_id,
    )
    if conflict is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f'A subject named "{conflict.subject_name}" already exists in this grade, '
                "including archived subjects."
            ),
        )


def generate_available_subject_code(
    db: Session,
    subject_name: str,
    grade_level: int,
    *,
    exclude_subject_id: int | None = None,
    additional_codes: tuple[str, ...] = (),
) -> str:
    query = db.query(Subject)
    if exclude_subject_id is not None:
        query = query.filter(Subject.subject_id != exclude_subject_id)
    existing_subjects = query.all()
    try:
        return generate_subject_code(
            subject_name,
            grade_level,
            existing_codes=[subject.subject_codename for subject in existing_subjects] + list(additional_codes),
        )
    except SubjectCodeConflictError as exc:
        normalized_conflict = normalize_subject_code(exc.conflicting_code)
        conflict = next(
            (
                subject
                for subject in existing_subjects
                if subject.subject_codename
                and normalize_subject_code(subject.subject_codename) == normalized_conflict
            ),
            None,
        )
        conflict_detail = f' by "{conflict.subject_name}"' if conflict is not None else ""
        raise HTTPException(
            status_code=409,
            detail=(
                f'Generated subject code "{exc.code}" is already used{conflict_detail}. '
                "Use a more specific subject name."
            ),
        ) from exc
    except SubjectCodeGenerationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def preview_subject_code_record(
    db: Session,
    subject_name: str,
    academic_level_id: int,
    subject_id: int | None = None,
) -> dict:
    level = get_academic_level_or_404(db, academic_level_id)
    name = normalize_optional_text(subject_name)
    if name is None:
        raise HTTPException(status_code=422, detail="Subject name is required.")

    current_subject = None
    if subject_id is not None:
        current_subject = db.get(Subject, subject_id)
        if current_subject is None:
            raise HTTPException(status_code=404, detail="Subject not found.")
        if current_subject.academic_level_id != academic_level_id:
            raise HTTPException(status_code=400, detail="Grade level cannot be changed after a subject is created.")
        if (
            current_subject.subject_codename
            and normalize_subject_name(current_subject.subject_name) == normalize_subject_name(name)
        ):
            return {"subject_codename": current_subject.subject_codename}

    _ensure_subject_name_available(
        db,
        name,
        academic_level_id,
        exclude_subject_id=subject_id,
    )
    code = generate_available_subject_code(
        db,
        name,
        level.grade_level,
        exclude_subject_id=subject_id,
    )
    return {"subject_codename": code}


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
    level = get_academic_level_or_404(db, payload.academic_level_id)
    name = normalize_optional_text(payload.subject_name)
    if name is None:
        raise HTTPException(status_code=422, detail="Subject name is required.")
    _ensure_subject_name_available(db, name, payload.academic_level_id)
    code = generate_available_subject_code(db, name, level.grade_level)
    subject = Subject(
        subject_name=name, subject_codename=code,
        grading_template_id=payload.grading_template_id,
        is_core=payload.is_core,
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
    if "subject_codename" in data:
        submitted_code = normalize_optional_text(data.pop("subject_codename"))
        if normalize_subject_code(submitted_code or "") != normalize_subject_code(subject.subject_codename or ""):
            raise HTTPException(
                status_code=422,
                detail="Subject codes are generated automatically. Change the subject name to generate a new code.",
            )
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
    if "subject_name" in data:
        name = normalize_optional_text(data["subject_name"])
        if name is None:
            raise HTTPException(status_code=422, detail="Subject name is required.")
        if normalize_subject_name(name) != normalize_subject_name(subject.subject_name):
            _ensure_subject_name_available(
                db,
                name,
                subject.academic_level_id,
                exclude_subject_id=subject_id,
            )
            level = get_academic_level_or_404(db, subject.academic_level_id)
            subject.subject_codename = generate_available_subject_code(
                db,
                name,
                level.grade_level,
                exclude_subject_id=subject_id,
            )
        subject.subject_name = name
    if "description" in data:
        subject.description = normalize_optional_text(data["description"])
    if "status" in data:
        target = normalize_subject_status(data["status"])
        current_status = (subject.status or DEFAULT_SUBJECT_STATUS).casefold()
        if target == "archived" and current_status != "archived":
            validate_subject_can_be_archived(db, subject)
        elif target == "active" and current_status != "active":
            validate_subject_can_be_restored(db, subject)
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


def validate_subject_can_be_restored(db: Session, subject: Subject) -> None:
    if subject.academic_level_id is not None:
        active_name_conflict = find_subject_name_conflict(
            db,
            subject.subject_name,
            subject.academic_level_id,
            exclude_subject_id=subject.subject_id,
            active_only=True,
        )
        if active_name_conflict is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f'Cannot restore "{subject.subject_name}" because active subject '
                    f'"{active_name_conflict.subject_name}" already exists in this grade.'
                ),
            )

    current_code = normalize_optional_text(subject.subject_codename)
    if current_code is not None:
        normalized_code = normalize_subject_code(current_code)
        other_subjects = (
            db.query(Subject)
            .filter(Subject.subject_id != subject.subject_id)
            .all()
        )
        code_conflict = next(
            (
                other
                for other in other_subjects
                if other.subject_codename
                and normalize_subject_code(other.subject_codename) == normalized_code
            ),
            None,
        )
        if code_conflict is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f'Cannot restore "{subject.subject_name}" because subject code '
                    f'"{current_code}" conflicts with "{code_conflict.subject_name}".'
                ),
            )
    elif subject.academic_level_id is not None:
        level = get_academic_level_or_404(db, subject.academic_level_id)
        subject.subject_codename = generate_available_subject_code(
            db,
            subject.subject_name,
            level.grade_level,
            exclude_subject_id=subject.subject_id,
        )


def restore_subject_record(db: Session, subject_id: int) -> dict:
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")
    if (subject.status or DEFAULT_SUBJECT_STATUS).casefold() != "active":
        validate_subject_can_be_restored(db, subject)
    subject.status = "active"
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Unable to restore subject because it conflicts with existing data.",
        ) from exc
    db.refresh(subject)
    return subject_to_item(subject)
