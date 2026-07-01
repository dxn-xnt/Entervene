from datetime import datetime, timezone
from typing import Optional, cast

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.FileUpload import delete_file, save_file
from app.core.Security import decode_access_token
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.people.AcademicStaff import AcademicStaff
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Classwork import (
    ClassworkAssignRequest,
    ClassworkAssignmentResponse,
    ClassworkAttachmentResponse,
    ClassworkCreate,
    ClassworkResponse,
    ClassworkUpdate,
)
from app.schemas.Quiz import QuizBuilderUpsert
from app.services.classwork.ClassworkAccessService import (
    authorize_assignment_access,
    authorize_classwork_access,
    classwork_has_submissions,
)
from app.services.classwork.ClassworkResponseService import (
    build_attachment_response,
    build_classwork_response,
    resolve_classwork_file_path,
)
from app.services.classwork.ClassworkShared import (
    assignment_is_available,
    assignment_is_locked,
    cleanup_saved_files,
    dedupe_ids,
    ensure_class_targets,
    ensure_lessons_owned,
    ensure_subject_owner,
    is_quiz_type,
    is_reading_type,
    normalize_classwork_type,
    normalize_uploaded_path,
    parse_id_list,
    validate_classwork_values,
    validate_schedule,
)
from app.services.quiz.QuizBuilderService import upsert_quiz_builder


def create_classwork_record(body: ClassworkCreate, staff_id: str, db: Session) -> ClassworkResponse:
    classwork_type = normalize_classwork_type(body.classwork_type)
    total_points = None if is_reading_type(classwork_type) else body.total_points
    validate_classwork_values(total_points=total_points)
    ensure_subject_owner(db, staff_id, body.subject_id)
    lesson_ids = dedupe_ids(body.lesson_ids)
    ensure_lessons_owned(db, staff_id, body.subject_id, lesson_ids)

    classwork = Classwork(
        title=body.title,
        description=body.description,
        instructions=body.instructions,
        classwork_type=classwork_type,
        classwork_category=body.classwork_category,
        total_points=total_points,
        subject_id=body.subject_id,
        is_published=body.is_published,
        created_by_staff_id=staff_id,
    )
    try:
        db.add(classwork)
        db.flush()
        if is_reading_type(classwork_type):
            classwork.total_points = None
        for lesson_id in lesson_ids:
            db.add(ClassworkLesson(classwork_id=classwork.classwork_id, lesson_id=lesson_id))
        db.commit()
        db.refresh(classwork)
    except Exception:
        db.rollback()
        raise
    return build_classwork_response(classwork)


async def create_classwork_wizard_record(
    *,
    title: str,
    classwork_type: str,
    subject_id: int,
    description: Optional[str],
    instructions: Optional[str],
    classwork_category: Optional[str],
    total_points: Optional[float],
    is_published: bool,
    class_ids: str,
    lesson_ids: Optional[str],
    due_date: Optional[datetime],
    lock_date: Optional[datetime],
    allow_late_submissions: bool,
    max_attempts: Optional[int],
    quiz_payload: Optional[str],
    files: Optional[list[UploadFile]],
    staff_id: str,
    db: Session,
    save_file_func=save_file,
) -> ClassworkResponse:
    normalized_type = normalize_classwork_type(classwork_type)
    total_points = None if is_reading_type(normalized_type) else total_points
    max_attempts = max_attempts if is_quiz_type(normalized_type) else None
    selected_class_ids = parse_id_list(class_ids, "class_ids")
    selected_lesson_ids = parse_id_list(lesson_ids, "lesson_ids")
    validate_classwork_values(total_points=total_points, max_attempts=max_attempts)
    validate_schedule(None, due_date, lock_date)
    ensure_subject_owner(db, staff_id, subject_id)
    ensure_lessons_owned(db, staff_id, subject_id, selected_lesson_ids)
    ensure_class_targets(db, staff_id, subject_id, selected_class_ids)
    quiz_builder = _parse_quiz_payload(quiz_payload, normalized_type)

    saved_paths: list[str] = []
    try:
        classwork = Classwork(
            title=title.strip(),
            description=description,
            instructions=instructions,
            classwork_type=normalized_type,
            classwork_category=classwork_category,
            total_points=total_points,
            subject_id=subject_id,
            is_published=is_published,
            created_by_staff_id=staff_id,
        )
        db.add(classwork)
        db.flush()

        for lesson_id in selected_lesson_ids:
            db.add(ClassworkLesson(classwork_id=classwork.classwork_id, lesson_id=lesson_id))

        created_assignments = []
        for class_id in selected_class_ids:
            assignment = ClassworkAssignment(
                classwork_id=classwork.classwork_id,
                class_id=class_id,
                assigned_by_staff_id=staff_id,
                publish_date=None,
                due_date=due_date,
                lock_date=lock_date,
                allow_late_submissions=allow_late_submissions,
                max_attempts=max_attempts,
                is_published=is_published,
            )
            db.add(assignment)
            created_assignments.append(assignment)

        for upload in files or []:
            info = normalize_uploaded_path(await save_file_func(upload, "classworks"))
            saved_paths.append(info["file_path"])
            db.add(ClassworkAttachment(classwork_id=classwork.classwork_id, **info))

        if is_reading_type(normalized_type):
            db.flush()
            classwork.total_points = None
            for assignment in created_assignments:
                assignment.max_attempts = None

        if quiz_builder:
            # Save quiz builder rows before committing so classwork+quiz creation is atomic.
            upsert_quiz_builder(db, classwork, quiz_builder)

        db.commit()
        db.refresh(classwork)
        return build_classwork_response(classwork)
    except Exception:
        db.rollback()
        cleanup_saved_files(saved_paths)
        raise


def _parse_quiz_payload(raw_payload: Optional[str], normalized_type: str) -> QuizBuilderUpsert | None:
    if not is_quiz_type(normalized_type):
        return None
    if not raw_payload:
        raise HTTPException(status_code=400, detail="Quiz questions are required for quiz classwork")
    try:
        return QuizBuilderUpsert.model_validate_json(raw_payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail=[error["msg"] for error in exc.errors()],
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid quiz payload") from exc


def teacher_classworks(staff_id: str, db: Session) -> list[ClassworkResponse]:
    classworks = (
        db.query(Classwork)
        .options(
            joinedload(Classwork.subject),
            joinedload(Classwork.staff),
            selectinload(Classwork.attachments),
            selectinload(Classwork.assignments).joinedload(ClassworkAssignment.class_),
        )
        .filter(Classwork.created_by_staff_id == staff_id, Classwork.is_archived == False)
        .order_by(Classwork.created_at.desc())
        .all()
    )
    return [build_classwork_response(classwork) for classwork in classworks]


def classwork_detail(
    classwork_id: int,
    class_id: Optional[int],
    current_user: dict,
    db: Session,
) -> dict:
    classwork = (
        db.query(Classwork)
        .options(
            joinedload(Classwork.subject),
            joinedload(Classwork.staff),
            selectinload(Classwork.attachments),
            selectinload(Classwork.assignments).joinedload(ClassworkAssignment.class_),
        )
        .filter(Classwork.classwork_id == classwork_id)
        .first()
    )
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found")
    authorize_classwork_access(classwork, current_user, db, class_id)

    due_date = None
    if class_id:
        assignment = db.query(ClassworkAssignment).filter(
            ClassworkAssignment.classwork_id == classwork_id,
            ClassworkAssignment.class_id == class_id,
        ).first()
        if assignment:
            due_date = assignment.due_date

    result = build_classwork_response(classwork).dict()
    result["due_date"] = due_date
    return result


def update_classwork_record(
    classwork_id: int,
    body: ClassworkUpdate,
    staff_id: str,
    db: Session,
) -> ClassworkResponse:
    classwork = (
        db.query(Classwork)
        .options(
            joinedload(Classwork.subject),
            joinedload(Classwork.staff),
            selectinload(Classwork.attachments),
            selectinload(Classwork.assignments).joinedload(ClassworkAssignment.class_),
        )
        .filter(Classwork.classwork_id == classwork_id, Classwork.created_by_staff_id == staff_id)
        .first()
    )
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    values = body.model_dump(exclude_unset=True)
    if "classwork_type" in values and values["classwork_type"]:
        values["classwork_type"] = normalize_classwork_type(values["classwork_type"])
    if is_reading_type(values.get("classwork_type", classwork.classwork_type)):
        values["total_points"] = None
    validate_classwork_values(total_points=values.get("total_points"))
    lesson_ids = values.pop("lesson_ids", None)
    if lesson_ids is not None:
        lesson_ids = dedupe_ids(lesson_ids)
        ensure_lessons_owned(db, staff_id, classwork.subject_id, lesson_ids)
    try:
        for field, value in values.items():
            setattr(classwork, field, value)
        if lesson_ids is not None:
            db.query(ClassworkLesson).filter(ClassworkLesson.classwork_id == classwork_id).delete()
            for lesson_id in lesson_ids:
                db.add(ClassworkLesson(classwork_id=classwork_id, lesson_id=lesson_id))
        db.commit()
        db.refresh(classwork)
    except Exception:
        db.rollback()
        raise
    return build_classwork_response(classwork)


def archive_classwork_record(classwork_id: int, staff_id: str, db: Session) -> dict:
    classwork = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if classwork_has_submissions(db, classwork_id):
        raise HTTPException(status_code=409, detail="Classwork has turned-in submissions and cannot be archived")
    classwork.is_archived = True
    db.commit()
    return {"message": "Classwork archived", "classwork_id": classwork_id, "is_archived": True}


def unarchive_classwork_record(classwork_id: int, staff_id: str, db: Session) -> dict:
    classwork = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    classwork.is_archived = False
    db.commit()
    return {"message": "Classwork restored", "classwork_id": classwork_id, "is_archived": False}


async def add_classwork_attachment(
    classwork_id: int,
    file: UploadFile,
    staff_id: str,
    db: Session,
    save_file_func=save_file,
    delete_file_func=delete_file,
) -> ClassworkAttachmentResponse:
    classwork = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if classwork.is_archived:
        raise HTTPException(status_code=400, detail="Cannot attach files to archived classwork")
    info = normalize_uploaded_path(await save_file_func(file, "classworks"))
    try:
        attachment = ClassworkAttachment(classwork_id=classwork_id, **info)
        db.add(attachment)
        db.commit()
        db.refresh(attachment)
    except Exception:
        db.rollback()
        delete_file_func(info["file_path"])
        raise
    return build_attachment_response(attachment)


def remove_classwork_attachment(
    classwork_id: int,
    attachment_id: int,
    staff_id: str,
    db: Session,
    delete_file_func=delete_file,
) -> dict:
    classwork = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if classwork.is_archived:
        raise HTTPException(status_code=400, detail="Cannot remove files from archived classwork")

    attachment = db.query(ClassworkAttachment).filter(
        ClassworkAttachment.classwork_attachment_id == attachment_id,
        ClassworkAttachment.classwork_id == classwork_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    delete_file_func(attachment.file_path)
    db.delete(attachment)
    db.commit()
    return {"message": "Attachment deleted"}


def download_classwork_file(
    classwork_id: int,
    attachment_id: int,
    payload: dict,
    inline: bool,
    db: Session,
) -> FileResponse:
    classwork = db.query(Classwork).filter(Classwork.classwork_id == classwork_id).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found")
    authorize_classwork_access(classwork, payload, db)

    attachment = db.query(ClassworkAttachment).filter(
        ClassworkAttachment.classwork_attachment_id == attachment_id,
        ClassworkAttachment.classwork_id == classwork_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    path = resolve_classwork_file_path(attachment.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found on server (resolved: {path})")

    return FileResponse(
        path=str(path),
        filename=attachment.file_name,
        media_type=attachment.file_type or "application/octet-stream",
        content_disposition_type="inline" if inline else "attachment",
    )


def assign_classwork_to_classes(
    classwork_id: int,
    body: ClassworkAssignRequest,
    staff_id: str,
    db: Session,
) -> dict:
    classwork = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if classwork.is_archived:
        raise HTTPException(status_code=400, detail="Cannot assign archived classwork")
    class_ids = dedupe_ids(body.class_ids)
    max_attempts = body.max_attempts if is_quiz_type(classwork.classwork_type) else None
    validate_classwork_values(max_attempts=max_attempts)
    validate_schedule(None, body.due_date, body.lock_date)
    ensure_class_targets(db, staff_id, classwork.subject_id, class_ids)
    created = []
    updated = []
    new_assignments = []
    try:
        for class_id in class_ids:
            existing = db.query(ClassworkAssignment).filter(
                ClassworkAssignment.classwork_id == classwork_id,
                ClassworkAssignment.class_id == class_id,
            ).first()
            if existing:
                existing.publish_date = None
                existing.due_date = body.due_date
                existing.lock_date = body.lock_date
                existing.allow_late_submissions = bool(body.allow_late_submissions)
                existing.max_attempts = max_attempts
                existing.is_published = bool(body.is_published)
                existing.is_locked = False
                updated.append(class_id)
                continue
            assignment = ClassworkAssignment(
                classwork_id=classwork_id,
                class_id=class_id,
                assigned_by_staff_id=staff_id,
                publish_date=None,
                due_date=body.due_date,
                lock_date=body.lock_date,
                allow_late_submissions=bool(body.allow_late_submissions),
                max_attempts=max_attempts,
                is_published=body.is_published,
            )
            db.add(assignment)
            new_assignments.append(assignment)
            created.append(class_id)
        if not is_quiz_type(classwork.classwork_type) and new_assignments:
            db.flush()
            for assignment in new_assignments:
                assignment.max_attempts = None
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {
        "message": f"Assigned to {len(created)} class(es), updated {len(updated)} class(es)",
        "class_ids": created,
        "updated_class_ids": updated,
    }


def student_classworks_for_subject(
    class_id: int,
    subject_id: int,
    student,
    db: Session,
) -> list[ClassworkAssignmentResponse]:
    enrollment = db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")
    rows = (
        db.query(ClassworkAssignment, Classwork, Class)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(Class, Class.class_id == ClassworkAssignment.class_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            Classwork.subject_id == subject_id,
            Classwork.is_archived == False,
            ClassworkAssignment.is_published == True,
        )
        .order_by(ClassworkAssignment.created_at.desc())
        .all()
    )
    results = []
    now = datetime.now(timezone.utc)
    for assignment, classwork, class_ in rows:
        if not assignment_is_available(assignment, now):
            continue
        submission = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id,
            StudentSubmission.student_id == student.student_id,
        ).first()
        staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == classwork.created_by_staff_id).first()
        display_status = submission.status if submission else _missing_status(assignment, now)
        results.append(_assignment_response(assignment, classwork, class_, staff, display_status))
    return results


def classwork_assignment_detail(assignment_id: int, current_user: dict, db: Session) -> ClassworkAssignmentResponse:
    assignment = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found")
    authorize_assignment_access(assignment, classwork, current_user, db)
    class_ = db.query(Class).filter(Class.class_id == assignment.class_id).first()
    staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == classwork.created_by_staff_id).first()
    return _assignment_response(assignment, classwork, class_, staff, None)


def teacher_classes(staff_id: str, db: Session) -> list[dict]:
    rows = (
        db.query(SubjectLoad, Subject, Class)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(Class, Class.class_id == SubjectLoad.class_id)
        .filter(SubjectLoad.staff_id == staff_id, SubjectLoad.status == "active")
        .all()
    )
    return [
        {
            "subject_load_id": subject_load.subject_load_id,
            "subject_id": subject.subject_id,
            "subject_name": subject.subject_name,
            "subject_codename": subject.subject_codename,
            "class_id": class_.class_id,
            "section_name": _class_section_name(class_),
        }
        for subject_load, subject, class_ in rows
    ]


def teacher_assignments_for_class_subject(
    class_id: int,
    subject_id: int,
    staff_id: str,
    db: Session,
) -> list[ClassworkAssignmentResponse]:
    load = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.class_id == class_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.status == "active",
    ).first()
    if not load:
        raise HTTPException(status_code=403, detail="Not assigned to this class/subject")

    rows = (
        db.query(ClassworkAssignment, Classwork, Class)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(Class, Class.class_id == ClassworkAssignment.class_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            Classwork.subject_id == subject_id,
            Classwork.created_by_staff_id == staff_id,
            Classwork.is_archived == False,
        )
        .order_by(ClassworkAssignment.created_at.desc())
        .all()
    )
    results = []
    for assignment, classwork, class_ in rows:
        staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == classwork.created_by_staff_id).first()
        results.append(_assignment_response(assignment, classwork, class_, staff, None))
    return results


def student_assignments(student, db: Session) -> dict:
    enrolled_classes = db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.enrollment_status == "enrolled",
    ).all()
    class_ids = [student_class.class_id for student_class in enrolled_classes]
    if not class_ids:
        return {"pending": [], "submitted": [], "graded": []}

    assignments = (
        db.query(ClassworkAssignment, Classwork, Subject, AcademicStaff)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .outerjoin(Subject, Subject.subject_id == Classwork.subject_id)
        .outerjoin(AcademicStaff, AcademicStaff.staff_id == Classwork.created_by_staff_id)
        .filter(
            ClassworkAssignment.class_id.in_(class_ids),
            Classwork.is_archived == False,
            ClassworkAssignment.is_published == True,
        )
        .order_by(ClassworkAssignment.due_date.asc())
        .all()
    )

    pending, submitted, graded = [], [], []
    for assignment, classwork, subject, staff in assignments:
        if not assignment_is_available(assignment):
            continue
        submission = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id,
            StudentSubmission.student_id == student.student_id,
        ).first()
        item = {
            "classwork_assignment_id": assignment.classwork_assignment_id,
            "classwork_id": classwork.classwork_id,
            "classwork_title": classwork.title,
            "classwork_type": classwork.classwork_type,
            "classwork_category": classwork.classwork_category,
            "total_points": float(classwork.total_points) if classwork.total_points else None,
            "subject_name": subject.subject_name,
            "subject_id": subject.subject_id,
            "teacher_name": f"{staff.first_name} {staff.last_name}",
            "publish_date": assignment.publish_date.isoformat() if assignment.publish_date else None,
            "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
            "lock_date": assignment.lock_date.isoformat() if assignment.lock_date else None,
            "allow_late_submissions": assignment.allow_late_submissions,
            "is_published": assignment.is_published,
            "is_locked": assignment_is_locked(assignment),
            "max_attempts": assignment.max_attempts,
            "submission_status": submission.status if submission else None,
            "grade": float(submission.grade) if submission and submission.grade else None,
            "submitted_at": submission.submitted_at.isoformat() if submission and submission.submitted_at else None,
            "attempt_count": submission.attempt_count if submission else 0,
        }
        if submission and submission.status == "graded":
            graded.append(item)
        elif submission and submission.status in ("submitted", "late"):
            submitted.append(item)
        else:
            pending.append(item)
    return {"pending": pending, "submitted": submitted, "graded": graded}


def auth_payload_from_request(request, access_cookie_name: str, token: Optional[str]) -> dict:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        payload = decode_access_token(auth_header[7:])
    elif request.cookies.get(access_cookie_name):
        payload = decode_access_token(request.cookies[access_cookie_name])
    elif token:
        payload = decode_access_token(token)
    else:
        payload = None
    if not payload:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return payload


def _missing_status(assignment: ClassworkAssignment, now: datetime) -> str:
    if not assignment.due_date:
        return "not_submitted_yet"
    due_date = assignment.due_date.replace(tzinfo=timezone.utc) if assignment.due_date.tzinfo is None else assignment.due_date
    return "missing" if now >= due_date else "not_submitted_yet"


def _assignment_response(
    assignment: ClassworkAssignment,
    classwork: Classwork,
    class_: Class | None,
    staff: AcademicStaff | None,
    submission_status: Optional[str],
) -> ClassworkAssignmentResponse:
    return ClassworkAssignmentResponse(
        classwork_assignment_id=assignment.classwork_assignment_id,
        classwork_id=classwork.classwork_id,
        class_id=assignment.class_id,
        section_name=_class_section_name(class_),
        title=classwork.title,
        description=classwork.description,
        instructions=classwork.instructions,
        classwork_type=classwork.classwork_type,
        classwork_category=classwork.classwork_category,
        total_points=float(classwork.total_points) if classwork.total_points else None,
        due_date=assignment.due_date,
        lock_date=assignment.lock_date,
        allow_late_submissions=assignment.allow_late_submissions,
        is_published=assignment.is_published,
        is_locked=assignment_is_locked(assignment),
        max_attempts=assignment.max_attempts,
        teacher_name=f"{staff.first_name} {staff.last_name}" if staff else None,
        attachments=[build_attachment_response(attachment) for attachment in classwork.attachments],
        submission_status=submission_status,
    )


def _class_section_name(class_: Class | None) -> str | None:
    if not class_:
        return None
    return cast(str | None, class_.section_name)
