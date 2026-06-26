from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.core.FileUpload import delete_file, save_file
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.LessonAttachment import LessonAttachment
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Lesson import LessonAssignRequest, LessonAttachmentResponse, LessonCreate, LessonResponse, LessonUpdate
from app.services.lesson.LessonFileService import files_from_form, resolve_lesson_file_path
from app.services.lesson.LessonResponseService import build_lesson_attachment_response, build_lesson_response
from app.services.lesson.LessonShared import (
    authorize_lesson_access,
    ensure_student_enrolled,
    ensure_teacher_class_subject,
    ensure_teacher_subject,
    get_owned_lesson,
)


def create_lesson_record(body: LessonCreate, staff_id: str, db: Session) -> LessonResponse:
    ensure_teacher_subject(db, staff_id, body.subject_id)
    lesson = Lesson(
        title=body.title,
        description=body.description,
        content=body.content,
        subject_id=body.subject_id,
        order_index=body.order_index,
        is_published=body.is_published,
        is_draft=body.is_draft if body.is_draft is not None else True,
        created_by_staff_id=staff_id,
    )
    try:
        db.add(lesson)
        db.commit()
        db.refresh(lesson)
    except Exception:
        db.rollback()
        raise
    return build_lesson_response(lesson, db)


def teacher_lessons(staff_id: str, db: Session) -> list[LessonResponse]:
    lessons = (
        db.query(Lesson)
        .filter(Lesson.created_by_staff_id == staff_id)
        .order_by(Lesson.created_at.desc())
        .all()
    )
    return [build_lesson_response(lesson, db) for lesson in lessons]


def teacher_draft_lessons(staff_id: str, db: Session) -> list[LessonResponse]:
    lessons = (
        db.query(Lesson)
        .filter(Lesson.created_by_staff_id == staff_id, Lesson.is_draft == True)
        .order_by(Lesson.created_at.desc())
        .all()
    )
    return [build_lesson_response(lesson, db) for lesson in lessons]


def teacher_lessons_for_class_subject(
    class_id: int,
    subject_id: int,
    staff_id: str,
    db: Session,
) -> list[LessonResponse]:
    ensure_teacher_class_subject(db, staff_id, class_id, subject_id)
    lessons = (
        db.query(Lesson)
        .join(LessonAssignment, LessonAssignment.lesson_id == Lesson.lesson_id)
        .filter(
            LessonAssignment.class_id == class_id,
            Lesson.subject_id == subject_id,
            Lesson.created_by_staff_id == staff_id,
        )
        .order_by(Lesson.order_index.asc(), Lesson.created_at.desc())
        .all()
    )
    return [build_lesson_response(lesson, db) for lesson in lessons]


def teacher_lesson_linked_classwork(
    class_id: int,
    lesson_id: int,
    staff_id: str,
    db: Session,
) -> list[dict]:
    lesson = db.query(Lesson).filter(Lesson.lesson_id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    ensure_teacher_class_subject(db, staff_id, class_id, lesson.subject_id)

    assigned_here = db.query(LessonAssignment).filter(
        LessonAssignment.lesson_id == lesson_id,
        LessonAssignment.class_id == class_id,
    ).first()
    if not assigned_here:
        raise HTTPException(status_code=403, detail="Lesson is not assigned to this class")

    rows = (
        db.query(ClassworkAssignment, Classwork)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(ClassworkLesson, ClassworkLesson.classwork_id == Classwork.classwork_id)
        .filter(
            ClassworkLesson.lesson_id == lesson_id,
            ClassworkAssignment.class_id == class_id,
            Classwork.created_by_staff_id == staff_id,
            Classwork.is_archived == False,
        )
        .order_by(ClassworkAssignment.created_at.desc())
        .all()
    )
    return [
        {
            "classwork_assignment_id": assignment.classwork_assignment_id,
            "classwork_id": assignment.classwork_id,
            "title": classwork.title,
            "classwork_type": classwork.classwork_type,
            "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
            "attachment_count": len(classwork.attachments),
        }
        for assignment, classwork in rows
    ]


def student_lessons_for_class_subject(
    class_id: int,
    subject_id: int,
    student,
    db: Session,
) -> list[LessonResponse]:
    ensure_student_enrolled(db, student.student_id, class_id)
    lessons = (
        db.query(Lesson)
        .join(LessonAssignment, LessonAssignment.lesson_id == Lesson.lesson_id)
        .filter(
            LessonAssignment.class_id == class_id,
            Lesson.subject_id == subject_id,
            Lesson.is_published == True,
            LessonAssignment.is_published == True,
            Lesson.is_archived == False,
        )
        .order_by(Lesson.order_index.asc(), Lesson.created_at.desc())
        .all()
    )
    return [build_lesson_response(lesson, db) for lesson in lessons]


def lesson_detail(lesson_id: int, current_user: dict, db: Session) -> LessonResponse:
    lesson = db.query(Lesson).filter(Lesson.lesson_id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    authorize_lesson_access(db, lesson, current_user)
    return build_lesson_response(lesson, db)


def update_lesson_record(
    lesson_id: int,
    body: LessonUpdate,
    staff_id: str,
    db: Session,
) -> LessonResponse:
    lesson = get_owned_lesson(db, staff_id, lesson_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(lesson, field, value)
    db.commit()
    db.refresh(lesson)
    return build_lesson_response(lesson, db)


def archive_lesson_record(lesson_id: int, staff_id: str, db: Session) -> dict:
    lesson = get_owned_lesson(db, staff_id, lesson_id)
    lesson.is_archived = True
    db.commit()
    return {"message": "Lesson archived", "lesson_id": lesson_id, "is_archived": True}


def publish_lesson_record(lesson_id: int, staff_id: str, db: Session) -> dict:
    lesson = get_owned_lesson(db, staff_id, lesson_id)
    lesson.is_published = True
    lesson.is_draft = False
    assignments = db.query(LessonAssignment).filter(LessonAssignment.lesson_id == lesson_id).all()
    for assignment in assignments:
        assignment.is_published = True
    db.commit()
    db.refresh(lesson)
    return {
        "message": "Lesson published",
        "is_published": lesson.is_published,
        "is_draft": lesson.is_draft,
        "assignments_published": len(assignments),
    }


def assign_lesson_to_classes(
    lesson_id: int,
    body: LessonAssignRequest,
    staff_id: str,
    db: Session,
) -> dict:
    lesson = get_owned_lesson(db, staff_id, lesson_id)
    class_ids = list(dict.fromkeys(body.class_ids))
    for class_id in class_ids:
        ensure_teacher_class_subject(db, staff_id, class_id, lesson.subject_id)

    created = []
    try:
        for class_id in class_ids:
            existing = db.query(LessonAssignment).filter(
                LessonAssignment.lesson_id == lesson_id,
                LessonAssignment.class_id == class_id,
            ).first()
            if existing:
                continue
            is_published = body.is_published if body.is_published is not None else True
            if lesson.is_published:
                is_published = True
            db.add(LessonAssignment(
                lesson_id=lesson_id,
                class_id=class_id,
                assigned_by_staff_id=staff_id,
                is_published=is_published,
            ))
            created.append(class_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"message": f"Lesson assigned to {len(created)} class(es)", "class_ids": created}


async def add_lesson_attachment(
    lesson_id: int,
    request: Request,
    file: Optional[UploadFile],
    staff_id: str,
    db: Session,
    save_file_func=save_file,
    delete_file_func=delete_file,
) -> LessonAttachmentResponse:
    get_owned_lesson(db, staff_id, lesson_id)
    upload: UploadFile | StarletteUploadFile | None = file
    if upload is None:
        candidates = await files_from_form(request, {"file", "files", "attachment", "attachments"})
        upload = candidates[0] if candidates else None
    if upload is None:
        raise HTTPException(status_code=400, detail="Attach a file using the 'file' form field.")

    file_info = await save_file_func(upload, "lessons")
    try:
        attachment = LessonAttachment(lesson_id=lesson_id, **file_info)
        db.add(attachment)
        db.commit()
        db.refresh(attachment)
    except Exception:
        db.rollback()
        delete_file_func(file_info["file_path"])
        raise
    return build_lesson_attachment_response(attachment)


def remove_lesson_attachment(
    lesson_id: int,
    attachment_id: int,
    staff_id: str,
    db: Session,
    delete_file_func=delete_file,
) -> dict:
    get_owned_lesson(db, staff_id, lesson_id)
    attachment = db.query(LessonAttachment).filter(
        LessonAttachment.lesson_attachment_id == attachment_id,
        LessonAttachment.lesson_id == lesson_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    delete_file_func(attachment.file_path)
    db.delete(attachment)
    db.commit()
    return {"message": "Attachment deleted"}


def lesson_classwork_assignments(lesson_id: int, class_id: int, student, db: Session) -> list[dict]:
    ensure_student_enrolled(db, student.student_id, class_id)
    rows = (
        db.query(ClassworkAssignment)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(ClassworkLesson, ClassworkLesson.classwork_id == Classwork.classwork_id)
        .filter(
            ClassworkLesson.lesson_id == lesson_id,
            ClassworkAssignment.class_id == class_id,
            Classwork.is_archived == False,
            ClassworkAssignment.is_published == True,
        )
        .all()
    )
    results = []
    now = datetime.now(timezone.utc)
    for assignment in rows:
        classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first()
        submission = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id,
            StudentSubmission.student_id == student.student_id,
        ).first()
        display_status = submission.status if submission else _missing_status(assignment, now)
        results.append({
            "classwork_assignment_id": assignment.classwork_assignment_id,
            "classwork_id": assignment.classwork_id,
            "title": classwork.title if classwork else "Untitled",
            "classwork_type": classwork.classwork_type if classwork else None,
            "total_points": float(classwork.total_points) if classwork and classwork.total_points else None,
            "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
            "submission_status": display_status,
        })
    return results


def download_lesson_file(
    lesson_id: int,
    attachment_id: int,
    current_user: dict,
    db: Session,
) -> FileResponse:
    attachment = db.query(LessonAttachment).filter(
        LessonAttachment.lesson_attachment_id == attachment_id,
        LessonAttachment.lesson_id == lesson_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    lesson = db.query(Lesson).filter(Lesson.lesson_id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    authorize_lesson_access(db, lesson, current_user)

    file_path = resolve_lesson_file_path(attachment.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on server")
    return FileResponse(
        path=str(file_path),
        filename=attachment.file_name,
        media_type=attachment.file_type or "application/octet-stream",
    )


def unarchive_lesson_record(lesson_id: int, staff_id: str, db: Session) -> dict:
    lesson = get_owned_lesson(db, staff_id, lesson_id)
    lesson.is_archived = False
    db.commit()
    db.refresh(lesson)
    return {"message": "Lesson restored", "lesson_id": lesson_id, "is_archived": lesson.is_archived}


def unlink_classwork(lesson_id: int, classwork_id: int, staff_id: str, db: Session) -> dict:
    get_owned_lesson(db, staff_id, lesson_id)
    classwork_lesson = db.query(ClassworkLesson).filter(
        ClassworkLesson.lesson_id == lesson_id,
        ClassworkLesson.classwork_id == classwork_id,
    ).first()
    if not classwork_lesson:
        raise HTTPException(status_code=404, detail="Classwork is not linked to this lesson")
    db.delete(classwork_lesson)
    db.commit()
    return {
        "message": "Classwork unlinked from lesson",
        "lesson_id": lesson_id,
        "classwork_id": classwork_id,
    }


def _missing_status(assignment: ClassworkAssignment, now: datetime) -> str:
    if not assignment.due_date:
        return "not_submitted_yet"
    due_date = assignment.due_date.replace(tzinfo=timezone.utc) if assignment.due_date.tzinfo is None else assignment.due_date
    return "missing" if now >= due_date else "not_submitted_yet"
