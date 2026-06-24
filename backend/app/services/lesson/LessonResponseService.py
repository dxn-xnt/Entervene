from sqlalchemy.orm import Session

from app.models.academic.Lesson import Lesson
from app.models.academic.Subject import Subject
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.Lesson import LessonAttachmentResponse, LessonResponse


def build_lesson_attachment_response(attachment) -> LessonAttachmentResponse:
    """Return the public attachment fields used by lesson endpoints."""
    return LessonAttachmentResponse(
        lesson_attachment_id=attachment.lesson_attachment_id,
        file_name=attachment.file_name,
        file_type=attachment.file_type,
        file_size=attachment.file_size,
        uploaded_at=attachment.uploaded_at,
    )


def build_lesson_response(lesson: Lesson, db: Session) -> LessonResponse:
    """Build the lesson API response outside the route handler."""
    subject = db.query(Subject).filter(Subject.subject_id == lesson.subject_id).first()
    staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == lesson.created_by_staff_id).first()

    return LessonResponse(
        lesson_id=lesson.lesson_id,
        title=lesson.title,
        description=lesson.description,
        content=lesson.content,
        order_index=lesson.order_index,
        is_published=lesson.is_published,
        is_draft=lesson.is_draft,
        is_locked=lesson.is_locked,
        is_archived=lesson.is_archived,
        subject_id=lesson.subject_id,
        subject_name=subject.subject_name if subject else None,
        created_by_staff_id=lesson.created_by_staff_id,
        teacher_name=f"{staff.first_name} {staff.last_name}" if staff else None,
        attachments=[
            build_lesson_attachment_response(attachment)
            for attachment in lesson.attachments
        ],
        created_at=lesson.created_at,
        updated_at=lesson.updated_at,
    )
