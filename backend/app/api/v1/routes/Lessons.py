# app/api/v1/routes/Lessons.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from starlette.datastructures import UploadFile as StarletteUploadFile
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional
from datetime import datetime, timezone

from app.db.Session import get_db
from app.core.Dependencies import require_role, get_staff_id, get_student_record
from app.core.FileUpload import save_file, delete_file
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAttachment import LessonAttachment
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.Classwork import Classwork
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Lesson import (
    LessonCreate, LessonUpdate, LessonResponse,
    LessonAttachmentResponse, LessonAssignRequest,
)
from app.services.lesson.LessonShared import (
    authorize_lesson_access as _authorize_lesson_access,
    ensure_student_enrolled as _ensure_student_enrolled,
    ensure_teacher_class_subject as _ensure_teacher_class_subject,
    ensure_teacher_subject as _ensure_teacher_subject,
    get_owned_lesson as _get_owned_lesson,
)
from app.services.lesson.LessonFileService import (
    files_from_form as _files_from_form,
    resolve_lesson_file_path as _resolve_lesson_file_path,
)
from app.services.lesson.LessonResponseService import (
    build_lesson_attachment_response as _lesson_attachment_response,
    build_lesson_response as _build_lesson_response,
)

router = APIRouter()


# ──────────────────────────── TEACHER ENDPOINTS ────────────────────────────


@router.post("/", response_model=LessonResponse)
def create_lesson(
    body: LessonCreate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Create a new lesson."""
    _ensure_teacher_subject(db, staff_id, body.subject_id)

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
    return _build_lesson_response(lesson, db)


@router.get("/my-lessons", response_model=List[LessonResponse])
def get_my_lessons(
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """List all lessons created by the logged-in teacher."""
    lessons = (
        db.query(Lesson)
        .filter(Lesson.created_by_staff_id == staff_id)
        .order_by(Lesson.created_at.desc())
        .all()
    )
    return [_build_lesson_response(l, db) for l in lessons]


@router.get("/drafts", response_model=List[LessonResponse])
def get_draft_lessons(
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """List all draft lessons created by the logged-in teacher."""
    lessons = (
        db.query(Lesson)
        .filter(
            Lesson.created_by_staff_id == staff_id,
            Lesson.is_draft == True,
        )
        .order_by(Lesson.created_at.desc())
        .all()
    )
    return [_build_lesson_response(l, db) for l in lessons]


@router.get("/my-class/{class_id}/subject/{subject_id}", response_model=List[LessonResponse])
def get_teacher_lessons_for_class_subject(
    class_id: int,
    subject_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Lessons you created for this subject that are assigned to this class section."""
    _ensure_teacher_class_subject(db, staff_id, class_id, subject_id)

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
    return [_build_lesson_response(l, db) for l in lessons]


@router.get("/my-class/{class_id}/lesson/{lesson_id}/linked-classwork")
def get_teacher_lesson_linked_classwork(
    class_id: int,
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Classwork items linked to a lesson for this class (teacher view)."""
    lesson = db.query(Lesson).filter(Lesson.lesson_id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    _ensure_teacher_class_subject(db, staff_id, class_id, lesson.subject_id)

    assigned_here = (
        db.query(LessonAssignment)
        .filter(
            LessonAssignment.lesson_id == lesson_id,
            LessonAssignment.class_id == class_id,
        )
        .first()
    )
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

    out = []
    for ca, cw in rows:
        out.append({
            "classwork_assignment_id": ca.classwork_assignment_id,
            "classwork_id": ca.classwork_id,
            "title": cw.title,
            "classwork_type": cw.classwork_type,
            "due_date": ca.due_date.isoformat() if ca.due_date else None,
            "attachment_count": len(cw.attachments),
        })
    return out


# ──────────────────────────── STUDENT ENDPOINTS (static paths) ─────────────


@router.get("/class/{class_id}/subject/{subject_id}", response_model=List[LessonResponse])
def get_lessons_for_class_subject(
    class_id: int,
    subject_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    """List published lessons for a subject in a student's class."""
    _ensure_student_enrolled(db, student.student_id, class_id)

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
    return [_build_lesson_response(l, db) for l in lessons]


# ──────────────────────────── WILDCARD /{lesson_id} ROUTES BELOW ───────────
# IMPORTANT: All static-path routes MUST be defined above this section.
# FastAPI matches top-to-bottom; /{lesson_id} will swallow any path below it.


@router.get("/{lesson_id}", response_model=LessonResponse)
def get_lesson(
    lesson_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    """Get a single lesson by ID."""
    lesson = db.query(Lesson).filter(Lesson.lesson_id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    _authorize_lesson_access(db, lesson, current_user)
    return _build_lesson_response(lesson, db)


@router.put("/{lesson_id}", response_model=LessonResponse)
def update_lesson(
    lesson_id: int,
    body: LessonUpdate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Update a lesson."""
    lesson = _get_owned_lesson(db, staff_id, lesson_id)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(lesson, field, value)

    db.commit()
    db.refresh(lesson)
    return _build_lesson_response(lesson, db)


@router.delete("/{lesson_id}")
def delete_lesson(
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Archive a lesson without deleting linked classworks or uploaded files."""
    lesson = _get_owned_lesson(db, staff_id, lesson_id)

    lesson.is_archived = True
    db.commit()
    return {"message": "Lesson archived", "lesson_id": lesson_id, "is_archived": True}


@router.put("/{lesson_id}/publish")
def publish_lesson(
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Publish a lesson (mark as published and not draft). Also auto-publishes all LessonAssignments."""
    lesson = _get_owned_lesson(db, staff_id, lesson_id)

    lesson.is_published = True
    lesson.is_draft = False
    
    # Auto-publish all LessonAssignments for this lesson so students can see it
    assignments = db.query(LessonAssignment).filter(
        LessonAssignment.lesson_id == lesson_id
    ).all()
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


@router.post("/{lesson_id}/assign")
def assign_lesson(
    lesson_id: int,
    body: LessonAssignRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Assign a lesson to one or more classes. If lesson is already published, assignment will be published too."""
    lesson = _get_owned_lesson(db, staff_id, lesson_id)

    class_ids = list(dict.fromkeys(body.class_ids))
    for class_id in class_ids:
        _ensure_teacher_class_subject(db, staff_id, class_id, lesson.subject_id)

    created = []
    try:
        for class_id in class_ids:
            existing = db.query(LessonAssignment).filter(
                LessonAssignment.lesson_id == lesson_id,
                LessonAssignment.class_id == class_id,
            ).first()
            if existing:
                continue

            # Auto-publish assignment if the lesson is already published.
            is_published = body.is_published if body.is_published is not None else True
            if lesson.is_published:
                is_published = True

            assignment = LessonAssignment(
                lesson_id=lesson_id,
                class_id=class_id,
                assigned_by_staff_id=staff_id,
                is_published=is_published,
            )
            db.add(assignment)
            created.append(class_id)

        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"message": f"Lesson assigned to {len(created)} class(es)", "class_ids": created}


@router.post("/{lesson_id}/attachments", response_model=LessonAttachmentResponse)
async def upload_lesson_attachment(
    lesson_id: int,
    request: Request,
    file: Optional[UploadFile] = File(None),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Upload a file attachment to a lesson."""
    lesson = _get_owned_lesson(db, staff_id, lesson_id)

    upload: UploadFile | StarletteUploadFile | None = file
    if upload is None:
        candidates = await _files_from_form(request, {"file", "files", "attachment", "attachments"})
        upload = candidates[0] if candidates else None

    if upload is None:
        raise HTTPException(status_code=400, detail="Attach a file using the 'file' form field.")

    file_info = await save_file(upload, "lessons")
    try:
        attachment = LessonAttachment(lesson_id=lesson_id, **file_info)
        db.add(attachment)
        db.commit()
        db.refresh(attachment)
    except Exception:
        db.rollback()
        delete_file(file_info["file_path"])
        raise

    return _lesson_attachment_response(attachment)


@router.delete("/{lesson_id}/attachments/{attachment_id}")
def delete_lesson_attachment(
    lesson_id: int,
    attachment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Delete a lesson attachment."""
    _get_owned_lesson(db, staff_id, lesson_id)

    att = db.query(LessonAttachment).filter(
        LessonAttachment.lesson_attachment_id == attachment_id,
        LessonAttachment.lesson_id == lesson_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    delete_file(att.file_path)
    db.delete(att)
    db.commit()
    return {"message": "Attachment deleted"}


@router.get("/{lesson_id}/classwork-assignments")
def get_lesson_classwork_assignments(
    lesson_id: int,
    class_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    """Return classwork assignments for a lesson for the student's class."""
    _ensure_student_enrolled(db, student.student_id, class_id)

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
    # Use timezone-aware current time
    now = datetime.now(timezone.utc)
    
    for ca in rows:
        cw = db.query(Classwork).filter(Classwork.classwork_id == ca.classwork_id).first()
        sub = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == ca.classwork_assignment_id,
            StudentSubmission.student_id == student.student_id,
        ).first()
        
        # Calculate display status based on submission status and due date
        display_status = None
        if sub:
            # If there's a submission record, use its status
            display_status = sub.status
        else:
            # No submission yet - check if due date has passed
            if ca.due_date:
                # If due_date is naive, make it aware (or convert to naive)
                if ca.due_date.tzinfo is None:
                    # If due_date is naive, assume it's UTC
                    due_date_aware = ca.due_date.replace(tzinfo=timezone.utc)
                else:
                    due_date_aware = ca.due_date
                
                if now >= due_date_aware:
                    display_status = "missing"  # Past due date, no submission = Missing
                else:
                    display_status = "not_submitted_yet"  # Before due date = Not submitted yet
            else:
                display_status = "not_submitted_yet"  # No due date, so not missing
        
        results.append({
            "classwork_assignment_id": ca.classwork_assignment_id,
            "classwork_id":           ca.classwork_id,
            "title":                  cw.title if cw else "Untitled",
            "classwork_type":         cw.classwork_type if cw else None,
            "total_points":           float(cw.total_points) if cw and cw.total_points else None,
            "due_date":               ca.due_date.isoformat() if ca.due_date else None,
            "submission_status":      display_status,
        })

    return results


@router.get("/{lesson_id}/attachments/{attachment_id}/download")
def download_lesson_attachment(
    lesson_id: int,
    attachment_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    """Download a lesson attachment file."""
    att = db.query(LessonAttachment).filter(
        LessonAttachment.lesson_attachment_id == attachment_id,
        LessonAttachment.lesson_id == lesson_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    lesson = db.query(Lesson).filter(Lesson.lesson_id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    _authorize_lesson_access(db, lesson, current_user)

    file_path = _resolve_lesson_file_path(att.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on server")

    return FileResponse(
        path=str(file_path),
        filename=att.file_name,
        media_type=att.file_type or "application/octet-stream",
    )


@router.put("/{lesson_id}/archive")
def archive_lesson(
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Archive a lesson (soft delete). Lesson remains in database but is hidden from view."""
    lesson = _get_owned_lesson(db, staff_id, lesson_id)

    lesson.is_archived = True
    db.commit()
    db.refresh(lesson)

    return {
        "message": "Lesson archived",
        "lesson_id": lesson_id,
        "is_archived": lesson.is_archived,
    }


@router.put("/{lesson_id}/unarchive")
def unarchive_lesson(
    lesson_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Restore an archived lesson."""
    lesson = _get_owned_lesson(db, staff_id, lesson_id)

    lesson.is_archived = False
    db.commit()
    db.refresh(lesson)

    return {
        "message": "Lesson restored",
        "lesson_id": lesson_id,
        "is_archived": lesson.is_archived,
    }


@router.delete("/{lesson_id}/classwork/{classwork_id}")
def unlink_classwork_from_lesson(
    lesson_id: int,
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Unlink a classwork from a lesson without deleting either resource."""
    _get_owned_lesson(db, staff_id, lesson_id)

    cw_lesson = db.query(ClassworkLesson).filter(
        ClassworkLesson.lesson_id == lesson_id,
        ClassworkLesson.classwork_id == classwork_id,
    ).first()
    if not cw_lesson:
        raise HTTPException(status_code=404, detail="Classwork is not linked to this lesson")

    db.delete(cw_lesson)
    db.commit()

    return {
        "message": "Classwork unlinked from lesson",
        "lesson_id": lesson_id,
        "classwork_id": classwork_id,
    }
