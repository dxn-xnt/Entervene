# app/api/v1/routes/Submissions.py
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.v1.routes.Auth import ACCESS_COOKIE_NAME
from app.core.Dependencies import get_db, get_staff_id, get_student_record, require_role
from app.core.FileUpload import delete_file, save_file
from app.schemas.Submission import GradeRequest, SubmissionResponse
from app.services.submission.SubmissionService import (
    assignment_submissions,
    assignment_tracking,
    auth_payload_from_request,
    classwork_tracking,
    clear_submission_files,
    download_submission_file,
    get_submission_for_user,
    grade_student_submission,
    remove_submission_attachment,
    student_submissions,
    submit_student_work,
    teacher_submission_detail,
    unsubmit_student_work,
)

router = APIRouter()


@router.get("/my-submissions", response_model=List[SubmissionResponse])
def get_my_submissions(student=Depends(get_student_record), db: Session = Depends(get_db)):
    return student_submissions(student, db)


@router.post("/assignment/{assignment_id}/submit", response_model=SubmissionResponse)
async def submit_work(
    assignment_id: int,
    request: Request,
    files: Optional[List[UploadFile]] = File(None),
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return await submit_student_work(assignment_id, request, files, student, db, save_file)


@router.post("/assignment/{assignment_id}/unsubmit", response_model=SubmissionResponse)
def unsubmit_work(
    assignment_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return unsubmit_student_work(assignment_id, student, db)


@router.delete("/assignment/{assignment_id}/attachments/{attachment_id}", response_model=SubmissionResponse)
def delete_submission_attachment(
    assignment_id: int,
    attachment_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return remove_submission_attachment(assignment_id, attachment_id, student, db, delete_file)


@router.delete("/assignment/{assignment_id}/submit")
def delete_submission(
    assignment_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return clear_submission_files(assignment_id, student, db, delete_file)


@router.get("/assignment/{assignment_id}/all", response_model=List[SubmissionResponse])
def get_all_submissions_for_assignment(
    assignment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return assignment_submissions(assignment_id, staff_id, db)


@router.get("/assignment/{assignment_id}/tracking")
def get_assignment_submission_tracking(
    assignment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return assignment_tracking(assignment_id, staff_id, db)


@router.get("/classwork/{classwork_id}/tracking")
def get_tracking_by_classwork(
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return classwork_tracking(classwork_id, staff_id, db)


# Wildcard routes must stay at the bottom.
@router.get("/{submission_id}/detail", response_model=SubmissionResponse)
def get_submission_detail_teacher(
    submission_id: int,
    current_user: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_submission_detail(submission_id, staff_id, db)


@router.get("/{submission_id}/attachments/{attachment_id}/download")
def download_submission_attachment(
    submission_id: int,
    attachment_id: int,
    request: Request,
    token: Optional[str] = Query(None, description="JWT token as fallback for browser-based access"),
    db: Session = Depends(get_db),
):
    payload = auth_payload_from_request(request, ACCESS_COOKIE_NAME, token)
    return download_submission_file(submission_id, attachment_id, payload, db)


@router.put("/{submission_id}/grade", response_model=SubmissionResponse)
def grade_submission(
    submission_id: int,
    body: GradeRequest,
    current_user: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return grade_student_submission(submission_id, body, staff_id, db)


@router.get("/{submission_id}", response_model=SubmissionResponse)
def get_submission(
    submission_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return get_submission_for_user(submission_id, current_user, db)
