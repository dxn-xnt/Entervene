# app/api/v1/routes/Submissions.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from typing import List
from pathlib import Path
from datetime import datetime, timezone

from app.db.Session import get_db
from app.core.Dependencies import require_role, get_staff_id, get_student_record
from app.core.FileUpload import save_file, delete_file
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

router = APIRouter()


def _att_resp(a):
    return SubmissionAttachmentResponse(
        submission_attachment_id=a.submission_attachment_id,
        file_name=a.file_name, file_type=a.file_type,
        file_size=a.file_size, uploaded_at=a.uploaded_at,
    )


def _build_sub(sub, db):
    st = db.query(Student).filter(Student.student_id == sub.student_id).first()
    ca = db.query(ClassworkAssignment).filter(ClassworkAssignment.classwork_assignment_id == sub.classwork_assignment_id).first()
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
        created_at=sub.created_at,
    )


# ── Student endpoints ──

@router.post("/assignment/{assignment_id}/submit", response_model=SubmissionResponse)
async def submit_work(
    assignment_id: int,
    files: List[UploadFile] = File(...),
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    """Student submits files for a classwork assignment."""
    ca = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not ca:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Verify enrollment
    enr = db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == ca.class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if not enr:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")

    # Check if locked
    if ca.is_locked:
        raise HTTPException(status_code=403, detail="This assignment is locked")

    # Check existing submission
    existing = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()

    now = datetime.now(timezone.utc)
    is_late = ca.due_date and now > ca.due_date

    if existing:
        if existing.attempt_count >= (ca.max_attempts or 1):
            raise HTTPException(status_code=403, detail="Maximum attempts reached")
        existing.attempt_count += 1
        existing.submitted_at = now
        existing.status = "late" if is_late else "submitted"
        submission = existing
    else:
        submission = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=assignment_id,
            submitted_at=now,
            status="late" if is_late else "submitted",
            attempt_count=1,
        )
        db.add(submission)

    db.flush()

    # Save uploaded files
    for f in files:
        info = await save_file(f, "submissions")
        att = SubmissionAttachment(submission_id=submission.submission_id, **info)
        db.add(att)

    db.commit()
    db.refresh(submission)
    return _build_sub(submission, db)


@router.get("/my-submissions", response_model=List[SubmissionResponse])
def get_my_submissions(
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    """List all submissions for the current student."""
    subs = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.student_id == student.student_id)
        .order_by(StudentSubmission.created_at.desc())
        .all()
    )
    return [_build_sub(s, db) for s in subs]


@router.get("/{submission_id}", response_model=SubmissionResponse)
def get_submission(
    submission_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    """Get submission detail."""
    sub = db.query(StudentSubmission).filter(
        StudentSubmission.submission_id == submission_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    return _build_sub(sub, db)


# ── Teacher endpoints ──

@router.get("/assignment/{assignment_id}/all", response_model=List[SubmissionResponse])
def get_all_submissions_for_assignment(
    assignment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """List all student submissions for a given assignment."""
    subs = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.classwork_assignment_id == assignment_id)
        .order_by(StudentSubmission.submitted_at.desc())
        .all()
    )
    return [_build_sub(s, db) for s in subs]


@router.get("/{submission_id}/detail", response_model=SubmissionResponse)
def get_submission_detail_teacher(
    submission_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Teacher views a submission detail."""
    sub = db.query(StudentSubmission).filter(
        StudentSubmission.submission_id == submission_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    return _build_sub(sub, db)


@router.get("/{submission_id}/attachments/{attachment_id}/download")
def download_submission_attachment(
    submission_id: int,
    attachment_id: int,
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    """Download a student's submitted file."""
    att = db.query(SubmissionAttachment).filter(
        SubmissionAttachment.submission_attachment_id == attachment_id,
        SubmissionAttachment.submission_id == submission_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    p = Path(att.file_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found on server")
    return FileResponse(path=str(p), filename=att.file_name, media_type=att.file_type or "application/octet-stream")


@router.put("/{submission_id}/grade", response_model=SubmissionResponse)
def grade_submission(
    submission_id: int,
    body: GradeRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Grade a student's submission."""
    sub = db.query(StudentSubmission).filter(
        StudentSubmission.submission_id == submission_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    sub.grade = body.grade
    sub.feedback = body.feedback
    sub.status = "graded"
    sub.graded_at = datetime.now(timezone.utc)
    sub.graded_by_staff_id = staff_id
    db.commit()
    db.refresh(sub)
    return _build_sub(sub, db)
