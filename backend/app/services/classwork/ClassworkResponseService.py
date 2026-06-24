from pathlib import Path

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.schemas.Classwork import ClassworkAttachmentResponse, ClassworkResponse
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
            "max_attempts": assignment.max_attempts,
            "is_published": assignment.is_published,
            "is_locked": assignment_is_locked(assignment),
        })

    return ClassworkResponse(
        classwork_id=cw.classwork_id,
        title=cw.title,
        description=cw.description,
        instructions=cw.instructions,
        classwork_type=cw.classwork_type,
        classwork_category=cw.classwork_category,
        total_points=float(cw.total_points) if cw.total_points else None,
        is_published=cw.is_published,
        is_locked=cw.is_locked,
        is_archived=cw.is_archived,
        subject_id=cw.subject_id,
        subject_name=subject.subject_name if subject else None,
        created_by_staff_id=cw.created_by_staff_id,
        teacher_name=f"{staff.first_name} {staff.last_name}" if staff else None,
        attachments=[build_attachment_response(attachment) for attachment in cw.attachments],
        assignments=assignments_data,
        created_at=cw.created_at,
        updated_at=cw.updated_at,
    )
