# app/schemas/Submission.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SubmissionAttachmentResponse(BaseModel):
    submission_attachment_id: int
    file_name: str
    file_type: Optional[str]
    file_size: int
    uploaded_at: Optional[datetime]


class SubmissionResponse(BaseModel):
    submission_id: int
    student_id: str
    student_name: Optional[str] = None
    classwork_assignment_id: int
    classwork_title: Optional[str] = None
    submitted_at: Optional[datetime]
    status: str
    grade: Optional[float] = None
    feedback: Optional[str] = None
    attempt_count: int
    graded_at: Optional[datetime] = None
    graded_by_staff_id: Optional[str] = None
    attachments: list[SubmissionAttachmentResponse] = []
    total_points: Optional[float] = None
    created_at: Optional[datetime] = None


class GradeRequest(BaseModel):
    grade: float
    feedback: Optional[str] = None
