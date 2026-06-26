from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional, cast
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.core.FileUpload import delete_file, save_file
from app.core.Security import decode_access_token
from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.submissions.SubmissionAttachment import SubmissionAttachment
from app.schemas.Submission import GradeRequest, SubmissionAttachmentResponse, SubmissionResponse
from app.services.classwork.ClassworkShared import (
    assignment_is_available,
    assignment_is_locked,
    aware_utc,
    classwork_uses_attempt_limit,
    cleanup_saved_files,
)


def user_id(current_user: dict):
    value = current_user.get("sub")
    try:
        return UUID(value) if isinstance(value, str) else value
    except ValueError:
        return value


async def files_from_form(request: Request, field_names: set[str]) -> list[StarletteUploadFile]:
    try:
        form = await request.form()
    except Exception:
        return []
    uploads: list[StarletteUploadFile] = []
    for key, value in form.multi_items():
        if key in field_names and isinstance(value, StarletteUploadFile) and value.filename:
            uploads.append(value)
    return uploads


def student_name(student: Student) -> str:
    parts = [
        cast(Optional[str], student.first_name),
        cast(Optional[str], student.middle_name),
        cast(Optional[str], student.last_name),
        cast(Optional[str], student.suffix),
    ]
    return " ".join([p for p in parts if p])


def is_turned_in(status: Optional[str]) -> bool:
    return status in ("submitted", "late", "graded")


def teacher_owns_assignment(assignment_id: int, staff_id: str, db: Session) -> ClassworkAssignment:
    assignment = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first()
    if not classwork or classwork.created_by_staff_id != staff_id:
        raise HTTPException(status_code=403, detail="You do not own this assignment")
    return assignment


def authorize_submission_access(submission: StudentSubmission, current_user: dict, db: Session) -> None:
    role = current_user.get("role")
    current_user_id = user_id(current_user)
    if role == "student":
        student = db.query(Student).filter(Student.user_id == current_user_id).first()
        if student and str(submission.student_id) == str(student.student_id):
            return
    if role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == current_user_id).first()
        if staff:
            teacher_owns_assignment(submission.classwork_assignment_id, cast(str, staff.staff_id), db)
            return
    raise HTTPException(status_code=403, detail="Access denied")


def build_attachment_response(attachment) -> SubmissionAttachmentResponse:
    return SubmissionAttachmentResponse(
        submission_attachment_id=attachment.submission_attachment_id,
        file_name=attachment.file_name,
        file_type=attachment.file_type,
        file_size=attachment.file_size,
        uploaded_at=attachment.uploaded_at,
    )


def build_submission_response(submission, db: Session) -> SubmissionResponse:
    student = db.query(Student).filter(Student.student_id == submission.student_id).first()
    assignment = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == submission.classwork_assignment_id
    ).first()
    classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first() if assignment else None
    return SubmissionResponse(
        submission_id=submission.submission_id,
        student_id=str(submission.student_id),
        student_name=f"{student.first_name} {student.last_name}" if student else None,
        classwork_assignment_id=submission.classwork_assignment_id,
        classwork_title=classwork.title if classwork else None,
        submitted_at=submission.submitted_at,
        status=submission.status,
        grade=float(submission.grade) if submission.grade is not None else None,
        feedback=submission.feedback,
        attempt_count=submission.attempt_count,
        graded_at=submission.graded_at,
        graded_by_staff_id=submission.graded_by_staff_id,
        attachments=[build_attachment_response(attachment) for attachment in submission.attachments],
        total_points=float(classwork.total_points) if classwork and classwork.total_points is not None else None,
        created_at=submission.created_at,
    )


def student_submissions(student: Student, db: Session) -> list[SubmissionResponse]:
    submissions = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.student_id == student.student_id)
        .order_by(StudentSubmission.created_at.desc())
        .all()
    )
    return [build_submission_response(submission, db) for submission in submissions]


def assert_student_can_modify_submission(
    assignment_id: int,
    student: Student,
    db: Session,
) -> tuple[ClassworkAssignment, StudentSubmission]:
    assignment = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first()
    if not classwork or classwork.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    enrollment = db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == assignment.class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")
    now = datetime.now(timezone.utc)
    if not assignment_is_available(assignment, now):
        raise HTTPException(status_code=403, detail="This assignment is not available")
    if assignment_is_locked(assignment, now):
        raise HTTPException(status_code=403, detail="This assignment is locked")
    due_date = aware_utc(assignment.due_date)
    if due_date and now > due_date:
        raise HTTPException(status_code=403, detail="Cannot modify submission after due date")
    submission = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()
    if not submission:
        raise HTTPException(status_code=404, detail="No submission found")
    return assignment, submission


async def submit_student_work(
    assignment_id: int,
    request: Request,
    files,
    student: Student,
    db: Session,
    save_file_func=save_file,
) -> SubmissionResponse:
    """Create or resubmit work while preserving attempts and rolling back failed uploads."""
    assignment = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_assignment_id == assignment_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first()
    if not classwork or classwork.is_archived:
        raise HTTPException(status_code=404, detail="Classwork not found")
    enrollment = db.query(StudentClass).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == assignment.class_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")
    now = datetime.now(timezone.utc)
    if not assignment_is_available(assignment, now):
        raise HTTPException(status_code=403, detail="This assignment is not available")
    if assignment_is_locked(assignment, now):
        raise HTTPException(status_code=403, detail="This assignment is locked")

    existing = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()

    upload_files: list[StarletteUploadFile] = [
        cast(StarletteUploadFile, file) for file in (files or []) if file and file.filename
    ]
    if not upload_files:
        upload_files = await files_from_form(request, {"files", "file", "attachments", "attachment"})

    due_date = aware_utc(assignment.due_date)
    is_late = bool(due_date and now > due_date)
    enforce_attempt_limit = classwork_uses_attempt_limit(classwork)

    saved_paths: list[str] = []
    if existing:
        if existing.status == "graded":
            raise HTTPException(status_code=403, detail="Cannot modify a graded submission")
        is_draft = existing.status == "pending"
        if is_draft:
            if not upload_files and not existing.attachments:
                raise HTTPException(status_code=400, detail="Attach at least one file using the 'files' form field.")
            if upload_files:
                if enforce_attempt_limit and existing.attempt_count >= (assignment.max_attempts or 1):
                    raise HTTPException(status_code=403, detail="Maximum attempts reached")
                existing.attempt_count += 1
        else:
            if not upload_files:
                raise HTTPException(status_code=400, detail="Use Unsubmit first, then upload changes and submit again.")
            if enforce_attempt_limit and existing.attempt_count >= (assignment.max_attempts or 1):
                raise HTTPException(status_code=403, detail="Maximum attempts reached")
            existing.attempt_count += 1
        existing.submitted_at = now
        existing.status = "late" if is_late else "submitted"
        submission = existing
    else:
        if not upload_files:
            raise HTTPException(status_code=400, detail="Attach at least one file using the 'files' form field.")
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
        for upload in upload_files:
            info = await save_file_func(upload, "submissions")
            saved_paths.append(info["file_path"])
            db.add(SubmissionAttachment(submission_id=submission.submission_id, **info))
        db.commit()
        db.refresh(submission)
    except Exception:
        db.rollback()
        cleanup_saved_files(saved_paths)
        raise
    return build_submission_response(submission, db)


def unsubmit_student_work(assignment_id: int, student: Student, db: Session) -> SubmissionResponse:
    _, submission = assert_student_can_modify_submission(assignment_id, student, db)
    if submission.status == "graded":
        raise HTTPException(status_code=403, detail="Cannot unsubmit a graded submission")
    if submission.status == "pending":
        raise HTTPException(status_code=400, detail="Submission is not submitted yet")
    if submission.status not in ("submitted", "late"):
        raise HTTPException(status_code=400, detail="Submission cannot be unsubmitted")
    if not submission.attachments:
        raise HTTPException(status_code=400, detail="No files to keep; upload work first")

    submission.status = "pending"
    submission.submitted_at = None
    db.commit()
    db.refresh(submission)
    return build_submission_response(submission, db)


def remove_submission_attachment(
    assignment_id: int,
    attachment_id: int,
    student: Student,
    db: Session,
    delete_file_func=delete_file,
) -> SubmissionResponse:
    _, submission = assert_student_can_modify_submission(assignment_id, student, db)
    if submission.status != "pending":
        raise HTTPException(status_code=400, detail="Unsubmit before removing files")

    attachment = db.query(SubmissionAttachment).filter(
        SubmissionAttachment.submission_attachment_id == attachment_id,
        SubmissionAttachment.submission_id == submission.submission_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    delete_file_func(cast(str, attachment.file_path))
    db.delete(attachment)
    db.commit()
    db.refresh(submission)
    return build_submission_response(submission, db)


def clear_submission_files(
    assignment_id: int,
    student: Student,
    db: Session,
    delete_file_func=delete_file,
) -> dict[str, str]:
    _, submission = assert_student_can_modify_submission(assignment_id, student, db)
    for raw_attachment in submission.attachments:
        attachment = cast(SubmissionAttachment, raw_attachment)
        delete_file_func(cast(str, attachment.file_path))
        db.delete(attachment)
    submission.status = "pending"
    submission.submitted_at = None
    db.commit()
    return {"message": "Submission files cleared. You can now resubmit."}


def assignment_submissions(assignment_id: int, staff_id: str, db: Session) -> list[SubmissionResponse]:
    teacher_owns_assignment(assignment_id, staff_id, db)
    submissions = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.classwork_assignment_id == assignment_id)
        .order_by(StudentSubmission.submitted_at.desc())
        .all()
    )
    return [build_submission_response(submission, db) for submission in submissions]


def assignment_tracking(assignment_id: int, staff_id: str, db: Session) -> dict:
    assignment = teacher_owns_assignment(assignment_id, staff_id, db)
    classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first()
    roster_rows = (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(StudentClass.class_id == assignment.class_id, StudentClass.enrollment_status == "enrolled")
        .order_by(Student.last_name.asc(), Student.first_name.asc())
        .all()
    )
    submissions = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == assignment_id
    ).all()
    subs_by_student = {str(submission.student_id): submission for submission in submissions}
    submitted, missing = [], []
    for student in roster_rows:
        sid = str(student.student_id)
        submission = subs_by_student.get(sid)
        base = {
            "student_id": sid,
            "student_name": student_name(student),
            "student_lrn": student.student_lrn,
            "email": student.email,
        }
        if submission and is_turned_in(submission.status):
            submitted.append({
                **base,
                "status": submission.status,
                "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
                "submission_id": submission.submission_id,
                "attempt_count": submission.attempt_count,
                "grade": float(submission.grade) if submission.grade is not None else None,
                "attachment_count": len(submission.attachments),
            })
        else:
            missing.append({
                **base,
                "status": submission.status if submission else "not_submitted",
                "submitted_at": None,
                "submission_id": submission.submission_id if submission else None,
                "attempt_count": submission.attempt_count if submission else 0,
                "grade": float(submission.grade) if submission and submission.grade is not None else None,
                "attachment_count": len(submission.attachments) if submission else 0,
            })
    return {
        "classwork_assignment_id": assignment.classwork_assignment_id,
        "classwork_id": assignment.classwork_id,
        "classwork_title": classwork.title if classwork else None,
        "class_id": assignment.class_id,
        "due_date": assignment.due_date.isoformat() if assignment.due_date else None,
        "total_students": len(roster_rows),
        "submitted_count": len(submitted),
        "missing_count": len(missing),
        "submitted": submitted,
        "missing": missing,
    }


def classwork_tracking(classwork_id: int, staff_id: str, db: Session) -> dict:
    classwork = db.query(Classwork).filter(
        Classwork.classwork_id == classwork_id,
        Classwork.created_by_staff_id == staff_id,
    ).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")

    assignments = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.classwork_id == classwork_id
    ).all()
    if not assignments:
        return {
            "classwork_id": classwork_id,
            "classwork_title": classwork.title,
            "total_students": 0,
            "submitted_count": 0,
            "missing_count": 0,
            "submitted": [],
            "missing": [],
        }

    assignment_ids = [assignment.classwork_assignment_id for assignment in assignments]
    class_ids = list({assignment.class_id for assignment in assignments})
    all_submissions = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id.in_(assignment_ids)
    ).all()
    subs_by_student = {str(submission.student_id): submission for submission in all_submissions}

    enrolled_rows = db.query(StudentClass).filter(
        StudentClass.class_id.in_(class_ids),
        StudentClass.enrollment_status == "enrolled",
    ).all()
    if not enrolled_rows:
        enrolled_rows = db.query(StudentClass).filter(StudentClass.class_id.in_(class_ids)).all()

    roster_student_ids = list({str(row.student_id) for row in enrolled_rows})
    all_student_ids = list(set(roster_student_ids) | set(subs_by_student.keys()))
    if not all_student_ids:
        return {
            "classwork_id": classwork_id,
            "classwork_title": classwork.title,
            "total_students": 0,
            "submitted_count": 0,
            "missing_count": 0,
            "submitted": [],
            "missing": [],
        }

    students = (
        db.query(Student)
        .filter(Student.student_id.in_(all_student_ids))
        .order_by(Student.last_name.asc(), Student.first_name.asc())
        .all()
    )

    submitted, missing = [], []
    for student in students:
        sid = str(student.student_id)
        submission = subs_by_student.get(sid)
        base = {
            "student_id": sid,
            "student_name": student_name(student),
            "student_lrn": student.student_lrn,
            "email": student.email,
        }
        if submission and is_turned_in(submission.status):
            submitted.append({
                **base,
                "status": submission.status,
                "submitted_at": submission.submitted_at.isoformat() if submission.submitted_at else None,
                "submission_id": submission.submission_id,
                "attempt_count": submission.attempt_count,
                "grade": float(submission.grade) if submission.grade is not None else None,
                "attachment_count": len(submission.attachments),
            })
        else:
            missing.append({
                **base,
                "status": submission.status if submission else "not_submitted",
                "submitted_at": None,
                "submission_id": submission.submission_id if submission else None,
                "attempt_count": submission.attempt_count if submission else 0,
                "grade": float(submission.grade) if submission and submission.grade is not None else None,
                "attachment_count": len(submission.attachments) if submission else 0,
            })

    return {
        "classwork_id": classwork_id,
        "classwork_title": classwork.title,
        "total_students": len(students),
        "submitted_count": len(submitted),
        "missing_count": len(missing),
        "submitted": submitted,
        "missing": missing,
    }


def teacher_submission_detail(submission_id: int, staff_id: str, db: Session) -> SubmissionResponse:
    submission = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    teacher_owns_assignment(submission.classwork_assignment_id, staff_id, db)
    return build_submission_response(submission, db)


def download_submission_file(
    submission_id: int,
    attachment_id: int,
    payload: dict,
    db: Session,
) -> FileResponse:
    submission = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    authorize_submission_access(submission, payload, db)

    attachment = db.query(SubmissionAttachment).filter(
        SubmissionAttachment.submission_attachment_id == attachment_id,
        SubmissionAttachment.submission_id == submission_id,
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    path = Path(cast(str, attachment.file_path))
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on server")
    return FileResponse(
        path=str(path),
        filename=cast(str, attachment.file_name),
        media_type=cast(Optional[str], attachment.file_type) or "application/octet-stream",
    )


def grade_student_submission(
    submission_id: int,
    body: GradeRequest,
    staff_id: str,
    db: Session,
) -> SubmissionResponse:
    submission = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    assignment = teacher_owns_assignment(submission.classwork_assignment_id, staff_id, db)
    classwork = db.query(Classwork).filter(Classwork.classwork_id == assignment.classwork_id).first() if assignment else None
    if body.grade < 0:
        raise HTTPException(status_code=400, detail="Grade cannot be negative")
    if classwork and classwork.total_points is not None and body.grade > float(classwork.total_points):
        raise HTTPException(status_code=400, detail=f"Grade cannot be greater than {float(classwork.total_points)}")
    submission.grade = Decimal(str(body.grade))
    submission.feedback = body.feedback
    submission.status = "graded"
    submission.graded_at = datetime.now(timezone.utc)
    submission.graded_by_staff_id = staff_id
    db.commit()
    db.refresh(submission)
    return build_submission_response(submission, db)


def get_submission_for_user(submission_id: int, current_user: dict, db: Session) -> SubmissionResponse:
    submission = db.query(StudentSubmission).filter(StudentSubmission.submission_id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    authorize_submission_access(submission, current_user, db)
    return build_submission_response(submission, db)


def auth_payload_from_request(request: Request, access_cookie_name: str, token: Optional[str]) -> dict:
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
