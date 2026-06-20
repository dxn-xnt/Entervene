# app/api/v1/routes/Classworks.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Query, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload, selectinload
from typing import List, Optional, cast
from pathlib import Path
from datetime import datetime, timezone
from uuid import UUID

from app.db.Session import get_db
from app.core.Dependencies import require_role, get_staff_id, get_student_record
from app.core.Security import decode_access_token
from app.core.FileUpload import save_file, delete_file
from app.api.v1.routes.Auth import ACCESS_COOKIE_NAME
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Class_ import Class
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.schemas.Classwork import (
    ClassworkCreate, ClassworkUpdate, ClassworkResponse,
    ClassworkAttachmentResponse, ClassworkAssignRequest,
    ClassworkAssignmentResponse,
)
from app.services.classwork.ClassworkShared import (
    assignment_is_available as _assignment_is_available,
    assignment_is_locked as _assignment_is_locked,
    cleanup_saved_files as _cleanup_saved_files,
    dedupe_ids as _dedupe_ids,
    ensure_class_targets as _ensure_class_targets,
    ensure_lessons_owned as _ensure_lessons_owned,
    ensure_subject_owner as _ensure_subject_owner,
    normalize_uploaded_path as _normalize_uploaded_path,
    parse_id_list as _parse_id_list,
    validate_classwork_values as _validate_classwork_values,
    validate_schedule as _validate_schedule,
)

router = APIRouter()

# Project root = 4 levels up from this file (app/api/v1/routes/Classworks.py)
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
UPLOADS_DIR = BASE_DIR / "uploads"


def _user_id(current_user: dict):
    value = current_user.get("sub")
    try:
        return UUID(value) if isinstance(value, str) else value
    except ValueError:
        return value


def _resolve_file_path(stored_path: str) -> Path:
    """
    Resolve a stored file_path to an actual Path on disk.
    Handles both legacy Windows absolute paths and clean relative paths.
    """
    # First try the stored path as-is (works if already relative/correct)
    p = Path(stored_path)
    if p.exists():
        return p

    # Legacy: stored as Windows absolute path — extract just the filename
    # and rebuild from the known uploads directory structure.
    # e.g. C:\Users\...\backend\uploads\classworks\abc123.pdf
    normalized = stored_path.replace("\\", "/")
    parts = Path(normalized).parts

    # Walk backwards to find "uploads" in the stored path, then rebuild from there
    try:
        uploads_idx = next(i for i, part in enumerate(parts) if part == "uploads")
        relative = Path(*parts[uploads_idx:])  # e.g. uploads/classworks/abc123.pdf
        p = BASE_DIR / relative
        if p.exists():
            return p
    except StopIteration:
        pass

    # Last resort: assume filename lives in uploads/classworks/
    filename = Path(normalized).name
    p = UPLOADS_DIR / "classworks" / filename
    return p  # Caller checks .exists()


def _att_resp(a):
    return ClassworkAttachmentResponse(
        classwork_attachment_id=a.classwork_attachment_id,
        file_name=a.file_name, file_type=a.file_type,
        file_size=a.file_size, uploaded_at=a.uploaded_at,
    )


def _build_cw(cw, db):
    subj = cw.subject
    staff = cw.staff
    
    assignments_data = []
    for a in cw.assignments:
        cls = a.class_
        assignments_data.append({
            "classwork_assignment_id": a.classwork_assignment_id,
            "classwork_id": a.classwork_id,
            "class_id": a.class_id,
            "title": cls.section_name if cls else "Unknown Section",
            "classwork_type": cw.classwork_type,
            "due_date": a.due_date,
            "is_published": a.is_published
        })

    return ClassworkResponse(
        classwork_id=cw.classwork_id, title=cw.title, description=cw.description,
        instructions=cw.instructions, classwork_type=cw.classwork_type,
        classwork_category=cw.classwork_category,
        total_points=float(cw.total_points) if cw.total_points else None,
        is_published=cw.is_published, is_locked=cw.is_locked,
        is_archived=cw.is_archived,
        subject_id=cw.subject_id, subject_name=subj.subject_name if subj else None,
        created_by_staff_id=cw.created_by_staff_id,
        teacher_name=f"{staff.first_name} {staff.last_name}" if staff else None,
        attachments=[_att_resp(a) for a in cw.attachments],
        assignments=assignments_data,
        created_at=cw.created_at, updated_at=cw.updated_at,
    )


def _authorize_classwork_access(
    cw: Classwork,
    current_user: dict,
    db: Session,
    class_id: Optional[int] = None,
) -> None:
    role = current_user.get("role")
    user_id = _user_id(current_user)
    if role == "admin":
        return
    if role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff and cw.created_by_staff_id == staff.staff_id:
            return
    if cw.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    if role == "student":
        student = db.query(Student).filter(Student.user_id == user_id).first()
        if student:
            query = (
                db.query(ClassworkAssignment)
                .join(StudentClass, StudentClass.class_id == ClassworkAssignment.class_id)
                .filter(
                    ClassworkAssignment.classwork_id == cw.classwork_id,
                    StudentClass.student_id == student.student_id,
                    StudentClass.enrollment_status == "enrolled",
                )
            )
            if class_id is not None:
                query = query.filter(ClassworkAssignment.class_id == class_id)
            if any(_assignment_is_available(assignment) for assignment in query.all()):
                return
    raise HTTPException(status_code=403, detail="Access denied")


def _authorize_assignment_access(
    assignment: ClassworkAssignment,
    cw: Classwork,
    current_user: dict,
    db: Session,
) -> None:
    role = current_user.get("role")
    user_id = _user_id(current_user)
    if role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff and cw.created_by_staff_id == staff.staff_id:
            return
    if cw.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    if role == "student" and _assignment_is_available(assignment):
        student = db.query(Student).filter(Student.user_id == user_id).first()
        if student and db.query(StudentClass).filter(
            StudentClass.student_id == student.student_id,
            StudentClass.class_id == assignment.class_id,
            StudentClass.enrollment_status == "enrolled",
        ).first():
            return
    raise HTTPException(status_code=403, detail="Access denied")


def _classwork_has_submissions(db: Session, classwork_id: int) -> bool:
    """Classwork can only be archived while no student work is turned in."""
    return (
        db.query(StudentSubmission)
        .join(
            ClassworkAssignment,
            ClassworkAssignment.classwork_assignment_id == StudentSubmission.classwork_assignment_id,
        )
        .filter(
            ClassworkAssignment.classwork_id == classwork_id,
            StudentSubmission.status.in_(("submitted", "late", "graded")),
        )
        .first()
        is not None
    )


@router.post("/", response_model=ClassworkResponse)
def create_classwork(body: ClassworkCreate, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    _validate_classwork_values(total_points=body.total_points)
    _ensure_subject_owner(db, staff_id, body.subject_id)
    lesson_ids = _dedupe_ids(body.lesson_ids)
    _ensure_lessons_owned(db, staff_id, body.subject_id, lesson_ids)

    cw = Classwork(title=body.title, description=body.description, instructions=body.instructions,
                   classwork_type=body.classwork_type, classwork_category=body.classwork_category,
                   total_points=body.total_points, subject_id=body.subject_id,
                   is_published=body.is_published, created_by_staff_id=staff_id)
    try:
        db.add(cw); db.flush()
        for lesson_id in lesson_ids:
            db.add(ClassworkLesson(classwork_id=cw.classwork_id, lesson_id=lesson_id))
        db.commit(); db.refresh(cw)
    except Exception:
        db.rollback()
        raise
    return _build_cw(cw, db)


@router.post("/with-assignments", response_model=ClassworkResponse)
async def create_classwork_with_assignments(
    title: str = Form(...),
    classwork_type: str = Form(...),
    subject_id: int = Form(...),
    description: Optional[str] = Form(None),
    instructions: Optional[str] = Form(None),
    classwork_category: Optional[str] = Form(None),
    total_points: Optional[float] = Form(100),
    is_published: bool = Form(False),
    class_ids: str = Form(...),
    lesson_ids: Optional[str] = Form(None),
    publish_date: Optional[datetime] = Form(None),
    due_date: Optional[datetime] = Form(None),
    lock_date: Optional[datetime] = Form(None),
    max_attempts: Optional[int] = Form(1),
    files: Optional[List[UploadFile]] = File(None),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Atomic navbar wizard endpoint: create, link, attach, and assign together."""
    selected_class_ids = _parse_id_list(class_ids, "class_ids")
    selected_lesson_ids = _parse_id_list(lesson_ids, "lesson_ids")
    _validate_classwork_values(total_points=total_points, max_attempts=max_attempts)
    _validate_schedule(publish_date, due_date, lock_date)
    _ensure_subject_owner(db, staff_id, subject_id)
    _ensure_lessons_owned(db, staff_id, subject_id, selected_lesson_ids)
    _ensure_class_targets(db, staff_id, subject_id, selected_class_ids)

    saved_paths: list[str] = []
    try:
        cw = Classwork(
            title=title.strip(),
            description=description,
            instructions=instructions,
            classwork_type=classwork_type,
            classwork_category=classwork_category,
            total_points=total_points,
            subject_id=subject_id,
            is_published=is_published,
            created_by_staff_id=staff_id,
        )
        db.add(cw); db.flush()

        for lesson_id in selected_lesson_ids:
            db.add(ClassworkLesson(classwork_id=cw.classwork_id, lesson_id=lesson_id))

        for cid in selected_class_ids:
            db.add(ClassworkAssignment(
                classwork_id=cw.classwork_id,
                class_id=cid,
                assigned_by_staff_id=staff_id,
                publish_date=publish_date,
                due_date=due_date,
                lock_date=lock_date,
                max_attempts=max_attempts,
                is_published=is_published,
            ))

        for upload in files or []:
            info = _normalize_uploaded_path(await save_file(upload, "classworks"))
            saved_paths.append(info["file_path"])
            db.add(ClassworkAttachment(classwork_id=cw.classwork_id, **info))

        db.commit()
        db.refresh(cw)
        return _build_cw(cw, db)
    except Exception:
        db.rollback()
        _cleanup_saved_files(saved_paths)
        raise


@router.get("/my-classworks", response_model=List[ClassworkResponse])
def get_my_classworks(staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    cws = (
        db.query(Classwork)
        .options(
            joinedload(Classwork.subject),
            joinedload(Classwork.staff),
            selectinload(Classwork.attachments),
            selectinload(Classwork.assignments).joinedload(ClassworkAssignment.class_),
        )
        .filter(
            Classwork.created_by_staff_id == staff_id,
            Classwork.is_archived == False,
        )
        .order_by(Classwork.created_at.desc())
        .all()
    )
    return [_build_cw(c, db) for c in cws]

@router.get("/classwork/{classwork_id}", response_model=ClassworkResponse)
def get_classwork(
    classwork_id: int, 
    class_id: Optional[int] = Query(None, description="Optional class ID to get assignment-specific details"),
    current_user: dict = Depends(require_role("teacher", "admin", "student")), 
    db: Session = Depends(get_db)
):
    cw = (
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
    if not cw: 
        raise HTTPException(status_code=404, detail="Classwork not found")
    _authorize_classwork_access(cw, current_user, db, class_id)
    
    # Get assignment details if class_id is provided
    assignment = None
    due_date = None
    if class_id:
        assignment = db.query(ClassworkAssignment).filter(
            ClassworkAssignment.classwork_id == classwork_id,
            ClassworkAssignment.class_id == class_id
        ).first()
        if assignment:
            due_date = assignment.due_date
    
    # Build response with due_date from assignment
    result = _build_cw(cw, db)
    
    # Add due_date to the response (since ClassworkResponse might not have it)
    # You might need to create a custom response or modify ClassworkResponse schema
    result_dict = result.dict()
    result_dict["due_date"] = due_date
    
    return result_dict


@router.put("/classwork/{classwork_id}", response_model=ClassworkResponse)
def update_classwork(classwork_id: int, body: ClassworkUpdate, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    cw = (
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
    if not cw: raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    values = body.model_dump(exclude_unset=True)
    _validate_classwork_values(total_points=values.get("total_points"))
    lesson_ids = values.pop("lesson_ids", None)
    if lesson_ids is not None:
        lesson_ids = _dedupe_ids(lesson_ids)
        _ensure_lessons_owned(db, staff_id, cw.subject_id, lesson_ids)
    try:
        for f, v in values.items(): setattr(cw, f, v)
        if lesson_ids is not None:
            db.query(ClassworkLesson).filter(ClassworkLesson.classwork_id == classwork_id).delete()
            for lesson_id in lesson_ids:
                db.add(ClassworkLesson(classwork_id=classwork_id, lesson_id=lesson_id))
        db.commit(); db.refresh(cw)
    except Exception:
        db.rollback()
        raise
    return _build_cw(cw, db)


@router.delete("/classwork/{classwork_id}")
def delete_classwork(classwork_id: int, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    cw = db.query(Classwork).filter(Classwork.classwork_id == classwork_id, Classwork.created_by_staff_id == staff_id).first()
    if not cw: raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if _classwork_has_submissions(db, classwork_id):
        raise HTTPException(status_code=409, detail="Classwork has turned-in submissions and cannot be archived")
    # Soft archive keeps linked lessons, submissions, and attachment records intact.
    cw.is_archived = True
    db.commit()
    return {"message": "Classwork archived", "classwork_id": classwork_id, "is_archived": True}


@router.put("/classwork/{classwork_id}/archive")
def archive_classwork(classwork_id: int, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    cw = db.query(Classwork).filter(Classwork.classwork_id == classwork_id, Classwork.created_by_staff_id == staff_id).first()
    if not cw: raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if _classwork_has_submissions(db, classwork_id):
        raise HTTPException(status_code=409, detail="Classwork has turned-in submissions and cannot be archived")
    cw.is_archived = True
    db.commit()
    return {"message": "Classwork archived", "classwork_id": classwork_id, "is_archived": True}


@router.put("/classwork/{classwork_id}/unarchive")
def unarchive_classwork(classwork_id: int, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    cw = db.query(Classwork).filter(Classwork.classwork_id == classwork_id, Classwork.created_by_staff_id == staff_id).first()
    if not cw: raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    cw.is_archived = False
    db.commit()
    return {"message": "Classwork restored", "classwork_id": classwork_id, "is_archived": False}


@router.post("/classwork/{classwork_id}/attachments", response_model=ClassworkAttachmentResponse)
async def upload_cw_attachment(
    classwork_id: int,
    file: UploadFile = File(...),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    cw = db.query(Classwork).filter(Classwork.classwork_id == classwork_id, Classwork.created_by_staff_id == staff_id).first()
    if not cw: raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if cw.is_archived: raise HTTPException(status_code=400, detail="Cannot attach files to archived classwork")
    info = _normalize_uploaded_path(await save_file(file, "classworks"))

    # Normalize file_path to always store relative (e.g. uploads/classworks/abc123.pdf)
    # so downloads work regardless of machine or OS.
    raw_path = info.get("file_path", "")
    normalized = raw_path.replace("\\", "/")
    try:
        uploads_idx = next(i for i, part in enumerate(Path(normalized).parts) if part == "uploads")
        info["file_path"] = str(Path(*Path(normalized).parts[uploads_idx:]))
    except StopIteration:
        pass  # Already relative or unexpected format — keep as-is

    try:
        att = ClassworkAttachment(classwork_id=classwork_id, **info)
        db.add(att); db.commit(); db.refresh(att)
    except Exception:
        db.rollback()
        delete_file(info["file_path"])
        raise
    return _att_resp(att)


@router.delete("/classwork/{classwork_id}/attachments/{attachment_id}")
def delete_cw_attachment(
    classwork_id: int,
    attachment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    cw = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if cw.is_archived:
        raise HTTPException(status_code=400, detail="Cannot remove files from archived classwork")

    attachment = db.query(ClassworkAttachment).filter(
        ClassworkAttachment.classwork_attachment_id == attachment_id,
        ClassworkAttachment.classwork_id == classwork_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    delete_file(attachment.file_path)
    db.delete(attachment)
    db.commit()
    return {"message": "Attachment deleted"}


@router.get("/classwork/{classwork_id}/attachments/{attachment_id}/download")
def download_classwork_attachment(
    classwork_id: int,
    attachment_id: int,
    request: Request,
    token: Optional[str] = Query(None, description="JWT token as fallback for browser-based access"),
    inline: bool = Query(False, description="Display supported files in the browser instead of downloading"),
    db: Session = Depends(get_db),
):
    """
    Download a classwork attachment.
    Auth: Bearer header OR ?token= query param (for direct browser/Linking access).
    Both teachers and students can download classwork attachments.
    """
    payload = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        payload = decode_access_token(auth_header[7:])
    elif request.cookies.get(ACCESS_COOKIE_NAME):
        payload = decode_access_token(request.cookies[ACCESS_COOKIE_NAME])
    elif token:
        payload = decode_access_token(token)

    if not payload:
        raise HTTPException(status_code=401, detail="Not authenticated")

    cw = db.query(Classwork).filter(Classwork.classwork_id == classwork_id).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Classwork not found")
    _authorize_classwork_access(cw, payload, db)

    att = db.query(ClassworkAttachment).filter(
        ClassworkAttachment.classwork_attachment_id == attachment_id,
        ClassworkAttachment.classwork_id == classwork_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    p = _resolve_file_path(att.file_path)
    if not p.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found on server (resolved: {p})",
        )

    return FileResponse(
        path=str(p),
        filename=att.file_name,
        media_type=att.file_type or "application/octet-stream",
        content_disposition_type="inline" if inline else "attachment",
    )


@router.post("/classwork/{classwork_id}/assign")
def assign_classwork(classwork_id: int, body: ClassworkAssignRequest, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    cw = db.query(Classwork).filter(Classwork.classwork_id == classwork_id, Classwork.created_by_staff_id == staff_id).first()
    if not cw: raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if cw.is_archived: raise HTTPException(status_code=400, detail="Cannot assign archived classwork")
    class_ids = _dedupe_ids(body.class_ids)
    _validate_classwork_values(max_attempts=body.max_attempts)
    _validate_schedule(body.publish_date, body.due_date, body.lock_date)
    _ensure_class_targets(db, staff_id, cw.subject_id, class_ids)
    created = []
    try:
        for cid in class_ids:
            if db.query(ClassworkAssignment).filter(ClassworkAssignment.classwork_id == classwork_id, ClassworkAssignment.class_id == cid).first():
                continue
            a = ClassworkAssignment(classwork_id=classwork_id, class_id=cid, assigned_by_staff_id=staff_id,
                                    publish_date=body.publish_date, due_date=body.due_date, lock_date=body.lock_date,
                                    max_attempts=body.max_attempts, is_published=body.is_published)
            db.add(a); created.append(cid)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"message": f"Assigned to {len(created)} class(es)", "class_ids": created}


# ── Student endpoints ──

@router.get("/class/{class_id}/subject/{subject_id}", response_model=List[ClassworkAssignmentResponse])
def get_cw_for_class(class_id: int, subject_id: int, student=Depends(get_student_record), db: Session = Depends(get_db)):
    enr = db.query(StudentClass).filter(StudentClass.student_id == student.student_id, StudentClass.class_id == class_id, StudentClass.enrollment_status == "enrolled").first()
    if not enr: raise HTTPException(status_code=403, detail="Not enrolled in this class")
    rows = db.query(ClassworkAssignment, Classwork, Class).join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id).join(Class, Class.class_id == ClassworkAssignment.class_id).filter(ClassworkAssignment.class_id == class_id, Classwork.subject_id == subject_id, Classwork.is_archived == False, ClassworkAssignment.is_published == True).order_by(ClassworkAssignment.created_at.desc()).all()
    results = []
    
    # ✅ FIX: Use timezone-aware datetime
    from datetime import timezone
    now = datetime.now(timezone.utc)
    
    for ca, cw, cls in rows:
        if not _assignment_is_available(ca, now):
            continue
        sub = db.query(StudentSubmission).filter(StudentSubmission.classwork_assignment_id == ca.classwork_assignment_id, StudentSubmission.student_id == student.student_id).first()
        staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == cw.created_by_staff_id).first()
        
        # Calculate display status based on submission status and due date
        display_status = None
        if sub:
            display_status = sub.status
        else:
            if ca.due_date:
                # ✅ FIX: Make due_date timezone-aware if it's naive
                if ca.due_date.tzinfo is None:
                    due_date_aware = ca.due_date.replace(tzinfo=timezone.utc)
                else:
                    due_date_aware = ca.due_date
                
                if now >= due_date_aware:
                    display_status = "missing"
                else:
                    display_status = "not_submitted_yet"
            else:
                display_status = "not_submitted_yet"
        
        results.append(ClassworkAssignmentResponse(
            classwork_assignment_id=ca.classwork_assignment_id, classwork_id=cw.classwork_id,
            class_id=ca.class_id, section_name=cls.section_name, title=cw.title,
            description=cw.description, instructions=cw.instructions, classwork_type=cw.classwork_type,
            classwork_category=cw.classwork_category, total_points=float(cw.total_points) if cw.total_points else None,
            due_date=ca.due_date, is_published=ca.is_published,
            is_locked=_assignment_is_locked(ca, now), max_attempts=ca.max_attempts,
            teacher_name=f"{staff.first_name} {staff.last_name}" if staff else None,
            attachments=[_att_resp(a) for a in cw.attachments],
            submission_status=display_status,
        ))
    return results


@router.get("/assignment/{assignment_id}", response_model=ClassworkAssignmentResponse)
def get_cw_assignment(assignment_id: int, current_user: dict = Depends(require_role("teacher", "admin", "student")), db: Session = Depends(get_db)):
    ca = db.query(ClassworkAssignment).filter(ClassworkAssignment.classwork_assignment_id == assignment_id).first()
    if not ca: raise HTTPException(status_code=404, detail="Assignment not found")
    cw = db.query(Classwork).filter(Classwork.classwork_id == ca.classwork_id).first()
    if not cw: raise HTTPException(status_code=404, detail="Classwork not found")
    _authorize_assignment_access(ca, cw, current_user, db)
    cls = db.query(Class).filter(Class.class_id == ca.class_id).first()
    staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == cw.created_by_staff_id).first()
    return ClassworkAssignmentResponse(
        classwork_assignment_id=ca.classwork_assignment_id, classwork_id=cw.classwork_id,
        class_id=ca.class_id, section_name=cast(str, cls.section_name) if cls else None,
        title=cw.title, description=cw.description, instructions=cw.instructions,
        classwork_type=cw.classwork_type, classwork_category=cw.classwork_category,
        total_points=float(cw.total_points) if cw.total_points else None,
        due_date=ca.due_date, is_published=ca.is_published,
        is_locked=_assignment_is_locked(ca), max_attempts=ca.max_attempts,
        teacher_name=f"{staff.first_name} {staff.last_name}" if staff else None,
        attachments=[_att_resp(a) for a in cw.attachments],
    )


# ── Teacher: class list ──

@router.get("/teacher/classes")
def get_teacher_classes(staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    rows = db.query(SubjectLoad, Subject, Class).join(Subject, Subject.subject_id == SubjectLoad.subject_id).join(Class, Class.class_id == SubjectLoad.class_id).filter(SubjectLoad.staff_id == staff_id, SubjectLoad.status == "active").all()
    return [{"subject_load_id": sl.subject_load_id, "subject_id": s.subject_id, "subject_name": s.subject_name, "subject_codename": s.subject_codename, "class_id": c.class_id, "section_name": c.section_name} for sl, s, c in rows]


@router.get("/teacher/class/{class_id}/subject/{subject_id}/assignments", response_model=List[ClassworkAssignmentResponse])
def get_teacher_assignments_for_class_subject(
    class_id: int,
    subject_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    load = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.class_id == class_id,
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.status == "active",
        )
        .first()
    )
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
    for ca, cw, cls in rows:
        staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == cw.created_by_staff_id).first()
        results.append(
            ClassworkAssignmentResponse(
                classwork_assignment_id=ca.classwork_assignment_id,
                classwork_id=cw.classwork_id,
                class_id=ca.class_id,
                section_name=cls.section_name if cls else None,
                title=cw.title,
                description=cw.description,
                instructions=cw.instructions,
                classwork_type=cw.classwork_type,
                classwork_category=cw.classwork_category,
                total_points=float(cw.total_points) if cw.total_points else None,
                due_date=ca.due_date,
                is_published=ca.is_published,
                is_locked=_assignment_is_locked(ca),
                max_attempts=ca.max_attempts,
                teacher_name=f"{staff.first_name} {staff.last_name}" if staff else None,
                attachments=[_att_resp(a) for a in cw.attachments],
                submission_status=None,
            )
        )
    return results


# ── Student: get all assignments ──

@router.get("/my-assignments")
def get_student_assignments(student=Depends(get_student_record), db: Session = Depends(get_db)):
    from sqlalchemy import and_

    enrolled_classes = db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.enrollment_status == "enrolled"
    ).all()

    class_ids = [sc.class_id for sc in enrolled_classes]

    if not class_ids:
        return {"pending": [], "submitted": [], "graded": []}

    assignments = db.query(ClassworkAssignment, Classwork, Subject, AcademicStaff).join(
        Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id
    ).outerjoin(
        Subject, Subject.subject_id == Classwork.subject_id
    ).outerjoin(
        AcademicStaff, AcademicStaff.staff_id == Classwork.created_by_staff_id
    ).filter(
        ClassworkAssignment.class_id.in_(class_ids),
        Classwork.is_archived == False,
        ClassworkAssignment.is_published == True
    ).order_by(ClassworkAssignment.due_date.asc()).all()

    pending = []
    submitted = []
    graded = []

    for ca, cw, subj, staff in assignments:
        if not _assignment_is_available(ca):
            continue
        submission = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == ca.classwork_assignment_id,
            StudentSubmission.student_id == student.student_id
        ).first()

        assignment_item = {
            "classwork_assignment_id": ca.classwork_assignment_id,
            "classwork_id": cw.classwork_id,
            "classwork_title": cw.title,
            "classwork_type": cw.classwork_type,
            "classwork_category": cw.classwork_category,
            "total_points": float(cw.total_points) if cw.total_points else None,
            "subject_name": subj.subject_name,
            "subject_id": subj.subject_id,
            "teacher_name": f"{staff.first_name} {staff.last_name}",
            "publish_date": ca.publish_date.isoformat() if ca.publish_date else None,
            "due_date": ca.due_date.isoformat() if ca.due_date else None,
            "lock_date": ca.lock_date.isoformat() if ca.lock_date else None,
            "is_published": ca.is_published,
            "is_locked": _assignment_is_locked(ca),
            "max_attempts": ca.max_attempts,
            "submission_status": submission.status if submission else None,
            "grade": float(submission.grade) if submission and submission.grade else None,
            "submitted_at": submission.submitted_at.isoformat() if submission and submission.submitted_at else None,
            "attempt_count": submission.attempt_count if submission else 0,
        }

        if submission:
            if submission.status == "graded":
                graded.append(assignment_item)
            elif submission.status in ("submitted", "late"):
                submitted.append(assignment_item)
            else:
                pending.append(assignment_item)
        else:
            pending.append(assignment_item)

    return {
        "pending": pending,
        "submitted": submitted,
        "graded": graded,
    }
