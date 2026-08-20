from pathlib import Path

from app.models.academic.Lesson import Lesson
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.schemas.Classwork import (
    ClassworkAttachmentResponse,
    ClassworkResponse,
    LinkedLessonAttachmentResponse,
    LinkedLessonResponse,
    LinkedReadingResponse,
)
from app.services.classwork.ClassworkShared import assignment_is_locked

# Project root = backend/app. Keep file resolution out of HTTP route handlers.
BASE_DIR = Path(__file__).resolve().parent.parent.parent
UPLOADS_DIR = BASE_DIR / "uploads"


def resolve_classwork_file_path(stored_path: str) -> Path:
    """
    Resolve a stored classwork file path from either current relative paths or
    older absolute Windows paths.
    """
    path = Path(stored_path)
    if path.exists():
        return path

    normalized = stored_path.replace("\\", "/")
    parts = Path(normalized).parts
    try:
        uploads_idx = next(i for i, part in enumerate(parts) if part == "uploads")
        relative = Path(*parts[uploads_idx:])
        path = BASE_DIR / relative
        if path.exists():
            return path
    except StopIteration:
        pass

    return UPLOADS_DIR / "classworks" / Path(normalized).name


def build_attachment_response(attachment: ClassworkAttachment) -> ClassworkAttachmentResponse:
    return ClassworkAttachmentResponse(
        classwork_attachment_id=attachment.classwork_attachment_id,
        file_name=attachment.file_name,
        file_type=attachment.file_type,
        file_size=attachment.file_size,
        uploaded_at=attachment.uploaded_at,
    )


def build_linked_lesson_response(lesson: Lesson) -> LinkedLessonResponse:
    readings = []
    for cw in getattr(lesson, "linked_classworks", []) or []:
        if getattr(cw, "classwork_type", None) == "READING" and not getattr(cw, "is_archived", False):
            readings.append(
                LinkedReadingResponse(
                    classwork_id=cw.classwork_id,
                    title=cw.title,
                    description=cw.description,
                    instructions=cw.instructions,
                    activity_mode=getattr(cw, "activity_mode", "ONLINE"),
                )
            )

    return LinkedLessonResponse(
        lesson_id=lesson.lesson_id,
        title=lesson.title,
        description=lesson.description,
        attachments=[
            LinkedLessonAttachmentResponse(
                lesson_attachment_id=att.lesson_attachment_id,
                file_name=att.file_name,
                file_type=att.file_type,
                file_size=att.file_size,
                uploaded_at=att.uploaded_at,
            )
            for att in (getattr(lesson, "attachments", None) or [])
        ],
        readings=readings,
    )


def build_classwork_response(cw: Classwork) -> ClassworkResponse:
    subject = cw.subject
    staff = cw.staff

    assignments_data = []
    for assignment in cw.assignments:
        class_row = assignment.class_
        assignments_data.append({
            "classwork_assignment_id": assignment.classwork_assignment_id,
            "classwork_id": assignment.classwork_id,
            "class_id": assignment.class_id,
            "title": class_row.section_name if class_row else "Unknown Section",
            "classwork_type": cw.classwork_type,
            "due_date": assignment.due_date,
            "lock_date": assignment.lock_date,
            "allow_late_submissions": assignment.allow_late_submissions,
            "max_attempts": assignment.max_attempts,
            "is_published": assignment.is_published,
            "show_scores": cw.show_scores,
            "is_locked": assignment_is_locked(assignment),
        })

    linked_lessons = [
        build_linked_lesson_response(lesson)
        for lesson in (getattr(cw, "lessons", None) or [])
    ]

    return ClassworkResponse(
        classwork_id=cw.classwork_id,
        title=cw.title,
        description=cw.description,
        instructions=cw.instructions,
        classwork_type=cw.classwork_type,
        classwork_category=cw.classwork_category,
        activity_mode=getattr(cw, "activity_mode", "ONLINE"),
        is_graded=getattr(cw, "is_graded", True),
        total_points=float(cw.total_points) if cw.total_points is not None else None,
        is_published=cw.is_published,
        show_scores=cw.show_scores,
        is_locked=cw.is_locked,
        is_archived=cw.is_archived,
        subject_id=cw.subject_id,
        subject_name=getattr(subject, "subject_name", None) if subject else None,
        created_by_staff_id=cw.created_by_staff_id,
        teacher_name=f"{getattr(staff, 'first_name', '')} {getattr(staff, 'last_name', '')}".strip() or None if staff else None,
        attachments=[build_attachment_response(attachment) for attachment in cw.attachments],
        assignments=assignments_data,
        linked_lessons=linked_lessons,
        created_at=cw.created_at,
        updated_at=cw.updated_at,
    )
