# app/api/v1/routes/Lessons.py
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Request, UploadFile
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, get_student_record, require_role
from app.core.FileUpload import delete_file, save_file
from app.db.Session import get_db
from app.schemas.Lesson import LessonAssignRequest, LessonAttachmentResponse, LessonCreate, LessonResponse, LessonUpdate
from app.services.lesson.LessonService import (
    add_lesson_attachment,
    archive_lesson_record,
    assign_lesson_to_classes,
    create_lesson_record,
    download_lesson_file,
    lesson_classwork_assignments,
    lesson_detail,
    publish_lesson_record,
    remove_lesson_attachment,
    student_lessons_for_class_subject,
    teacher_draft_lessons,
    teacher_lesson_linked_classwork,
    teacher_lessons,
    teacher_lessons_for_class_subject,
    unarchive_lesson_record,
    unlink_classwork,
    update_lesson_record,
)

router = APIRouter()


@router.post("/", response_model=LessonResponse)
def create_lesson(
    body: LessonCreate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return create_lesson_record(body, staff_id, db)


@router.get("/my-lessons", response_model=List[LessonResponse])
def get_my_lessons(
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_lessons(staff_id, db)


@router.get("/drafts", response_model=List[LessonResponse])
def get_draft_lessons(
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_draft_lessons(staff_id, db)


@router.get("/my-class/{class_id}/subject/{subject_id}", response_model=List[LessonResponse])
def get_teacher_lessons_for_class_subject(
    class_id: int,
    subject_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_lessons_for_class_subject(class_id, subject_id, staff_id, db)


@router.get("/my-class/{class_id}/lesson/{lesson_id}/linked-classwork")
def get_teacher_lesson_linked_classwork(
    class_id: int,
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_lesson_linked_classwork(class_id, lesson_id, staff_id, db)


@router.get("/class/{class_id}/subject/{subject_id}", response_model=List[LessonResponse])
def get_lessons_for_class_subject(
    class_id: int,
    subject_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return student_lessons_for_class_subject(class_id, subject_id, student, db)


# Static routes must remain above this lesson_id wildcard section.
@router.get("/{lesson_id}", response_model=LessonResponse)
def get_lesson(
    lesson_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return lesson_detail(lesson_id, current_user, db)


@router.put("/{lesson_id}", response_model=LessonResponse)
def update_lesson(
    lesson_id: int,
    body: LessonUpdate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return update_lesson_record(lesson_id, body, staff_id, db)


@router.delete("/{lesson_id}")
def delete_lesson(
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return archive_lesson_record(lesson_id, staff_id, db)


@router.put("/{lesson_id}/publish")
def publish_lesson(
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return publish_lesson_record(lesson_id, staff_id, db)


@router.post("/{lesson_id}/assign")
def assign_lesson(
    lesson_id: int,
    body: LessonAssignRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return assign_lesson_to_classes(lesson_id, body, staff_id, db)


@router.post("/{lesson_id}/attachments", response_model=LessonAttachmentResponse)
async def upload_lesson_attachment(
    lesson_id: int,
    request: Request,
    file: Optional[UploadFile] = File(None),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return await add_lesson_attachment(lesson_id, request, file, staff_id, db, save_file, delete_file)


@router.delete("/{lesson_id}/attachments/{attachment_id}")
def delete_lesson_attachment(
    lesson_id: int,
    attachment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return remove_lesson_attachment(lesson_id, attachment_id, staff_id, db, delete_file)


@router.get("/{lesson_id}/classwork-assignments")
def get_lesson_classwork_assignments(
    lesson_id: int,
    class_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return lesson_classwork_assignments(lesson_id, class_id, student, db)


@router.get("/{lesson_id}/attachments/{attachment_id}/download")
def download_lesson_attachment(
    lesson_id: int,
    attachment_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return download_lesson_file(lesson_id, attachment_id, current_user, db)


@router.put("/{lesson_id}/archive")
def archive_lesson(
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return archive_lesson_record(lesson_id, staff_id, db)


@router.put("/{lesson_id}/unarchive")
def unarchive_lesson(
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return unarchive_lesson_record(lesson_id, staff_id, db)


@router.delete("/{lesson_id}/classwork/{classwork_id}")
def unlink_classwork_from_lesson(
    lesson_id: int,
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return unlink_classwork(lesson_id, classwork_id, staff_id, db)
