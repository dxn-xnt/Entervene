# app/api/v1/routes/Submissions.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List, Optional, cast
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID
import logging
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.db.Session import get_db
from app.core.Dependencies import require_role, get_staff_id, get_student_record
from app.core.Security import decode_access_token
from app.core.FileUpload import save_file, delete_file
from app.api.v1.routes.Auth import ACCESS_COOKIE_NAME
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.submissions.SubmissionAttachment import SubmissionAttachment
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.Classwork import Classwork
from app.models.academic.StudentCLass import StudentClass
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.Submission import (
    SubmissionResponse, SubmissionAttachmentResponse, GradeRequest,
)
from app.services.classwork.ClassworkShared import (
    assignment_is_available as _assignment_is_available,
    assignment_is_locked as _assignment_is_locked,
    aware_utc as _aware_utc,
    cleanup_saved_files as _cleanup_saved_files,
)

router = APIRouter()
logger = logging.getLogger("app.submissions")


def _user_id(current_user: dict):
    value = current_user.get("sub")
    try:
        return UUID(value) if isinstance(value, str) else value
    except ValueError:
        return value


async def _files_from_form(request: Request, field_names: set[str]) -> list[StarletteUploadFile]:
    try:
        form = await request.form()
    except Exception:
        return []
    uploads: list[StarletteUploadFile] = []
    for key, value in form.multi_items():
        if key in field_names and isinstance(value, StarletteUploadFile) and value.filename:
            uploads.append(value)
    return uploads


def _student_name(student: Student) -> str:
    parts = [
        cast(Optional[str], student.first_name),
        cast(Optional[str], student.middle_name),
        cast(Optional[str], student.last_name),
        cast(Optional[str], student.suffix),
    ]
    return " ".join([p for p in parts if p])


def _is_turned_in(status: Optional[str]) -> bool:
    return status in ("submitted", "late", "graded")


def _teacher_owns_assignment(assignment_id: int, staff_id: str, db: Session) -> ClassworkAssignment:
    ca = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Assignment not found")
    cw = db.query(Classwork).filter(Classwork.classwork_id == ca.classwork_id).first()
    if not cw or cw.created_by_staff_id != staff_id:
        raise HTTPException(status_code=403, detail="You do not own this assignment")
    return ca


def _authorize_submission_access(sub: StudentSubmission, current_user: dict, db: Session) -> None:
    role = current_user.get("role")
    user_id = _user_id(current_user)
    if role == "student":
        student = db.query(Student).filter(Student.user_id == user_id).first()
        if student and str(sub.student_id) == str(student.student_id):
            return
    if role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff:
            _teacher_owns_assignment(sub.classwork_assignment_id, cast(str, staff.staff_id), db)
            return
    raise HTTPException(status_code=403, detail="Access denied")


def _att_resp(a):
    return SubmissionAttachmentResponse(
        submission_attachment_id=a.submission_attachment_id,
        file_name=a.file_name, file_type=a.file_type,
        file_size=a.file_size, uploaded_at=a.uploaded_at,
    )


def _build_sub(sub, db):
    st = db.query(Student).filter(Student.student_id == sub.student_id).first()
    ca = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == sub.classwork_assignment_id
    ).first()
    cw = db.query(Classwork).filter(Classwork.classwork_id == ca.classwork_id).first() if ca else None
    return SubmissionResponse(
        submission_id=sub.submission_id,
        student_id=str(sub.student_id),
        student_name=f"{st.first_name} {st.last_name}" if st else None,
        classwork_assignment_id=sub.classwork_assignment_id,
        classwork_title=cw.title if cw else None,
        submitted_at=sub.submitted_at, status=sub.status,
        grade=float(sub.grade) if sub.grade is not None else None,
        feedback=sub.feedback, attempt_count=sub.attempt_count,
        graded_at=sub.graded_at, graded_by_staff_id=sub.graded_by_staff_id,
        attachments=[_att_resp(a) for a in sub.attachments],
        total_points=float(cw.total_points) if cw and cw.total_points is not None else None,
        created_at=sub.created_at,
    )


# ══════════════════════════════════════════════════════════════════════════════
# STUDENT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/my-submissions", response_model=List[SubmissionResponse])
def get_my_submissions(student=Depends(get_student_record), db: Session = Depends(get_db)):
    subs = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.student_id == student.student_id)
        .order_by(StudentSubmission.created_at.desc())
        .all()
    )
    return [_build_sub(s, db) for s in subs]


@router.post("/assignment/{assignment_id}/submit", response_model=SubmissionResponse)
async def submit_work(
    assignment_id: int,
    request: Request,
    files: Optional[List[UploadFile]] = File(None),
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    """Create or resubmit work while preserving attempts and rolling back failed uploads."""
    ca = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Assignment not found")
    cw = db.query(Classwork).filter(Classwork.classwork_id == ca.classwork_id).first()
    if not cw or cw.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    enr = db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == ca.class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if not enr:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")
    now = datetime.now(timezone.utc)
    if not _assignment_is_available(ca, now):
        raise HTTPException(status_code=403, detail="This assignment is not available")
    if _assignment_is_locked(ca, now):
        raise HTTPException(status_code=403, detail="This assignment is locked")

    existing = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()

    upload_files: list[StarletteUploadFile] = [
        cast(StarletteUploadFile, f) for f in (files or []) if f and f.filename
    ]
    if not upload_files:
        upload_files = await _files_from_form(request, {"files", "file", "attachments", "attachment"})

    due_date = _aware_utc(ca.due_date)
    is_late = bool(due_date and now > due_date)

    saved_paths: list[str] = []
    if existing:
        if existing.status == "graded":
            raise HTTPException(status_code=403, detail="Cannot modify a graded submission")
        is_draft = existing.status == "pending"
        if is_draft:
            if not upload_files and not existing.attachments:
                raise HTTPException(
                    status_code=400,
                    detail="Attach at least one file using the 'files' form field.",
                )
            if upload_files:
                if existing.attempt_count >= (ca.max_attempts or 1):
                    raise HTTPException(status_code=403, detail="Maximum attempts reached")
                existing.attempt_count += 1
        else:
            if not upload_files:
                raise HTTPException(
                    status_code=400,
                    detail="Use Unsubmit first, then upload changes and submit again.",
                )
            if existing.attempt_count >= (ca.max_attempts or 1):
                raise HTTPException(status_code=403, detail="Maximum attempts reached")
            existing.attempt_count += 1
        existing.submitted_at = now
        existing.status = "late" if is_late else "submitted"
        submission = existing
    else:
        if not upload_files:
            raise HTTPException(
                status_code=400,
                detail="Attach at least one file using the 'files' form field.",
            )
        submission = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=assignment_id,
            submitted_at=now,
            status="late" if is_late else "submitted",
            attempt_count=1,
        )
        db.add(submission)

    try:
        db.flush()
        for f in upload_files:
            info = await save_file(f, "submissions")
            saved_paths.append(info["file_path"])
            att = SubmissionAttachment(submission_id=submission.submission_id, **info)
            db.add(att)
        db.commit()
        db.refresh(submission)
    except Exception:
        db.rollback()
        _cleanup_saved_files(saved_paths)
        raise
    return _build_sub(submission, db)


def _assert_student_can_modify_submission(
    assignment_id: int, student, db: Session
) -> tuple[ClassworkAssignment, StudentSubmission]:
    ca = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Assignment not found")
    cw = db.query(Classwork).filter(Classwork.classwork_id == ca.classwork_id).first()
    if not cw or cw.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    enr = db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == ca.class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if not enr:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")
    now = datetime.now(timezone.utc)
    if not _assignment_is_available(ca, now):
        raise HTTPException(status_code=403, detail="This assignment is not available")
    if _assignment_is_locked(ca, now):
        raise HTTPException(status_code=403, detail="This assignment is locked")
    due_date = _aware_utc(ca.due_date)
    if due_date and now > due_date:
        raise HTTPException(status_code=403, detail="Cannot modify submission after due date")
    sub = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="No submission found")
    return ca, sub


@router.post("/assignment/{assignment_id}/unsubmit", response_model=SubmissionResponse)
def unsubmit_work(
    assignment_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    """Revert a submitted assignment to draft; keeps uploaded files."""
    logger.info(
        "[UnsubmitDebug] request received assignment_id=%s student_id=%s",
        assignment_id,
        getattr(student, "student_id", None),
    )
    _, sub = _assert_student_can_modify_submission(assignment_id, student, db)
    logger.info(
        "[UnsubmitDebug] submission found submission_id=%s status=%s attachment_count=%s",
        sub.submission_id,
        sub.status,
        len(sub.attachments),
    )
    if sub.status == "graded":
        logger.warning("[UnsubmitDebug] rejected: graded submission_id=%s", sub.submission_id)
        raise HTTPException(status_code=403, detail="Cannot unsubmit a graded submission")
    if sub.status == "pending":
        logger.warning("[UnsubmitDebug] rejected: already pending submission_id=%s", sub.submission_id)
        raise HTTPException(status_code=400, detail="Submission is not submitted yet")
    if sub.status not in ("submitted", "late"):
        logger.warning(
            "[UnsubmitDebug] rejected: invalid status submission_id=%s status=%s",
            sub.submission_id,
            sub.status,
        )
        raise HTTPException(status_code=400, detail="Submission cannot be unsubmitted")
    if not sub.attachments:
        logger.warning("[UnsubmitDebug] rejected: no attachments submission_id=%s", sub.submission_id)
        raise HTTPException(status_code=400, detail="No files to keep; upload work first")

    sub.status = "pending"
    sub.submitted_at = None
    db.commit()
    db.refresh(sub)
    logger.info(
        "[UnsubmitDebug] success submission_id=%s status=%s attachment_count=%s",
        sub.submission_id,
        sub.status,
        len(sub.attachments),
    )
    return _build_sub(sub, db)


@router.delete("/assignment/{assignment_id}/attachments/{attachment_id}", response_model=SubmissionResponse)
def delete_submission_attachment(
    assignment_id: int,
    attachment_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    _, sub = _assert_student_can_modify_submission(assignment_id, student, db)
    if sub.status != "pending":
        raise HTTPException(status_code=400, detail="Unsubmit before removing files")

    attachment = db.query(SubmissionAttachment).filter(
        SubmissionAttachment.submission_attachment_id == attachment_id,
        SubmissionAttachment.submission_id == sub.submission_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    delete_file(cast(str, attachment.file_path))
    db.delete(attachment)
    db.commit()
    db.refresh(sub)
    return _build_sub(sub, db)


@router.delete("/assignment/{assignment_id}/submit")
def delete_submission(assignment_id: int, student=Depends(get_student_record), db: Session = Depends(get_db)):
    """Clear submitted files without deleting the attempt history."""
    _, sub = _assert_student_can_modify_submission(assignment_id, student, db)
    for raw_att in sub.attachments:
        att = cast(SubmissionAttachment, raw_att)
        delete_file(cast(str, att.file_path))
        db.delete(att)
    sub.status = "pending"
    sub.submitted_at = None
    db.commit()
    return {"message": "Submission files cleared. You can now resubmit."}


# ══════════════════════════════════════════════════════════════════════════════
# TEACHER ENDPOINTS — specific paths BEFORE wildcard /{submission_id}
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/assignment/{assignment_id}/all", response_model=List[SubmissionResponse])
def get_all_submissions_for_assignment(
    assignment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    _teacher_owns_assignment(assignment_id, staff_id, db)
    subs = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.classwork_assignment_id == assignment_id)
        .order_by(StudentSubmission.submitted_at.desc())
        .all()
    )
    return [_build_sub(s, db) for s in subs]


@router.get("/assignment/{assignment_id}/tracking")
def get_assignment_submission_tracking(
    assignment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    ca = _teacher_owns_assignment(assignment_id, staff_id, db)
    cw = db.query(Classwork).filter(Classwork.classwork_id == ca.classwork_id).first()
    roster_rows = (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(StudentClass.class_id == ca.class_id, StudentClass.enrollment_status == "enrolled")
        .order_by(Student.last_name.asc(), Student.first_name.asc())
        .all()
    )
    submissions = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id
    ).all()
    subs_by_student = {str(s.student_id): s for s in submissions}
    submitted, missing = [], []
    for student in roster_rows:
        sid = str(student.student_id)
        sub = subs_by_student.get(sid)
        base = {"student_id": sid, "student_name": _student_name(student),
                "student_lrn": student.student_lrn, "email": student.email}
        if sub and _is_turned_in(sub.status):
            submitted.append({**base, "status": sub.status,
                "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
                "submission_id": sub.submission_id, "attempt_count": sub.attempt_count,
                "grade": float(sub.grade) if sub.grade is not None else None,
                "attachment_count": len(sub.attachments)})
        else:
            draft_status = sub.status if sub else "not_submitted"
            missing.append({**base, "status": draft_status, "submitted_at": None,
                "submission_id": sub.submission_id if sub else None, "attempt_count": sub.attempt_count if sub else 0,
                "grade": float(sub.grade) if sub and sub.grade is not None else None,
                "attachment_count": len(sub.attachments) if sub else 0})
    return {
        "classwork_assignment_id": ca.classwork_assignment_id, "classwork_id": ca.classwork_id,
        "classwork_title": cw.title if cw else None, "class_id": ca.class_id,
        "due_date": ca.due_date.isoformat() if ca.due_date else None,
        "total_students": len(roster_rows), "submitted_count": len(submitted),
        "missing_count": len(missing), "submitted": submitted, "missing": missing,
    }


def debug_tracking(
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """
    Diagnostic endpoint — call this in your browser to see exactly what's in the DB.
    GET /api/v1/submissions/classwork/{classwork_id}/debug
    Remove once the tracking is confirmed working.
    """
    cw = db.query(Classwork).filter(Classwork.classwork_id == classwork_id).first()
    assignments = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_id == classwork_id
    ).all()
    assignment_ids = [a.classwork_assignment_id for a in assignments]
    class_ids = [a.class_id for a in assignments]

    all_subs = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id.in_(assignment_ids)
    ).all() if assignment_ids else []

    enrollments_any = db.query(StudentClass).filter(
        StudentClass.class_id.in_(class_ids)
    ).all() if class_ids else []

    enrollments_active = db.query(StudentClass).filter(
        StudentClass.class_id.in_(class_ids),
        StudentClass.enrollment_status == "enrolled",
    ).all() if class_ids else []

    return {
        "classwork": {"classwork_id": classwork_id, "title": cw.title if cw else None},
        "assignments": [{"classwork_assignment_id": a.classwork_assignment_id, "class_id": a.class_id} for a in assignments],
        "submissions_in_db": [
            {"submission_id": s.submission_id, "student_id": str(s.student_id),
             "assignment_id": s.classwork_assignment_id, "status": s.status}
            for s in all_subs
        ],
        "enrollments_total": len(enrollments_any),
        "enrollments_with_status_enrolled": len(enrollments_active),
        "all_enrollment_statuses": list({e.enrollment_status for e in enrollments_any}),
        "class_ids": class_ids,
    }


@router.get("/classwork/{classwork_id}/tracking")
def get_tracking_by_classwork(
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """
    Teacher view: tracking by classwork_id.

    Key fix vs previous version:
    - Removed hard enrollment_status == 'enrolled' filter from roster query.
      Some setups store it differently. We now grab ALL StudentClass rows for
      the relevant class_ids, then separately show anyone who submitted even if
      not in the enrollment table (handles edge cases gracefully).
    """
    cw = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")

    assignments = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_id == classwork_id
    ).all()

    if not assignments:
        return {
            "classwork_id": classwork_id, "classwork_title": cw.title,
            "total_students": 0, "submitted_count": 0, "missing_count": 0,
            "submitted": [], "missing": [],
        }

    assignment_ids = [a.classwork_assignment_id for a in assignments]
    class_ids = list({a.class_id for a in assignments})

    # Get all submissions regardless of roster — this is our ground truth
    all_subs = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id.in_(assignment_ids)
    ).all()
    subs_by_student = {str(s.student_id): s for s in all_subs}

    # Build roster from StudentClass — try "enrolled" first, fall back to all
    enrolled_rows = db.query(StudentClass).filter(
        StudentClass.class_id.in_(class_ids),
        StudentClass.enrollment_status == "enrolled",
    ).all()

    if not enrolled_rows:
        # Fallback: try without status filter
        enrolled_rows = db.query(StudentClass).filter(
            StudentClass.class_id.in_(class_ids)
        ).all()

    roster_student_ids = list({str(r.student_id) for r in enrolled_rows})

    # Merge: anyone in roster OR anyone who submitted (covers edge cases)
    submitted_student_ids = list(subs_by_student.keys())
    all_student_ids = list(set(roster_student_ids) | set(submitted_student_ids))

    if not all_student_ids:
        return {
            "classwork_id": classwork_id, "classwork_title": cw.title,
            "total_students": 0, "submitted_count": 0, "missing_count": 0,
            "submitted": [], "missing": [],
        }

    students = (
        db.query(Student)
        .filter(Student.student_id.in_(all_student_ids))
        .order_by(Student.last_name.asc(), Student.first_name.asc())
        .all()
    )
    seen: dict[str, Student] = {str(st.student_id): st for st in students}

    submitted, missing = [], []
    for sid, st in seen.items():
        sub = subs_by_student.get(sid)
        base = {
            "student_id": sid,
            "student_name": _student_name(st),
            "student_lrn": st.student_lrn,
            "email": st.email,
        }
        if sub and _is_turned_in(sub.status):
            submitted.append({
                **base,
                "status": sub.status,
                "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
                "submission_id": sub.submission_id,
                "attempt_count": sub.attempt_count,
                "grade": float(sub.grade) if sub.grade is not None else None,
                "attachment_count": len(sub.attachments),
            })
        else:
            missing.append({
                **base,
                "status": sub.status if sub else "not_submitted",
                "submitted_at": None,
                "submission_id": sub.submission_id if sub else None,
                "attempt_count": sub.attempt_count if sub else 0,
                "grade": float(sub.grade) if sub and sub.grade is not None else None,
                "attachment_count": len(sub.attachments) if sub else 0,
            })

    return {
        "classwork_id": classwork_id,
        "classwork_title": cw.title,
        "total_students": len(seen),
        "submitted_count": len(submitted),
        "missing_count": len(missing),
        "submitted": submitted,
        "missing": missing,
    }


# ── Wildcard routes MUST stay at the bottom ──────────────────────────────────

@router.get("/{submission_id}/detail", response_model=SubmissionResponse)
def get_submission_detail_teacher(
    submission_id: int,
    current_user: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    sub = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    _teacher_owns_assignment(sub.classwork_assignment_id, staff_id, db)
    return _build_sub(sub, db)


@router.get("/{submission_id}/attachments/{attachment_id}/download")
def download_submission_attachment(
    submission_id: int,
    attachment_id: int,
    request: Request,
    token: Optional[str] = Query(None, description="JWT token as fallback for browser-based access"),
    db: Session = Depends(get_db),
):
    """
    Download a submission attachment.
    Auth: Bearer header OR ?token= query param (for direct browser/Linking access).
    Both teachers and students who own the submission can download.
    """
    # Resolve user from Bearer header or ?token= query param
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

    sub = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    _authorize_submission_access(sub, payload, db)

    att = db.query(SubmissionAttachment).filter(
        SubmissionAttachment.submission_attachment_id == attachment_id,
        SubmissionAttachment.submission_id == submission_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    p = Path(cast(str, att.file_path))
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found on server")
    return FileResponse(
        path=str(p),
        filename=cast(str, att.file_name),
        media_type=cast(Optional[str], att.file_type) or "application/octet-stream",
    )


@router.put("/{submission_id}/grade", response_model=SubmissionResponse)
def grade_submission(
    submission_id: int,
    body: GradeRequest,
    current_user: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    sub = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    ca = _teacher_owns_assignment(sub.classwork_assignment_id, staff_id, db)
    cw = db.query(Classwork).filter(Classwork.classwork_id == ca.classwork_id).first() if ca else None
    if body.grade < 0:
        raise HTTPException(status_code=400, detail="Grade cannot be negative")
    if cw and cw.total_points is not None and body.grade > float(cw.total_points):
        raise HTTPException(
            status_code=400,
            detail=f"Grade cannot be greater than {float(cw.total_points)}",
        )
    sub.grade = Decimal(str(body.grade))
    sub.feedback = body.feedback
    sub.status = "graded"
    sub.graded_at = datetime.now(timezone.utc)
    sub.graded_by_staff_id = staff_id
    db.commit()
    db.refresh(sub)
    return _build_sub(sub, db)


@router.get("/{submission_id}", response_model=SubmissionResponse)
def get_submission(
    submission_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    sub = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    _authorize_submission_access(sub, current_user, db)
    return _build_sub(sub, db)
