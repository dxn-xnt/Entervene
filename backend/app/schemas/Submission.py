# app/schemas/Submission.py
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Literal, Optional
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
    feedback_fingerprint: str = Field(min_length=64, max_length=64)
    attempt_count: int
    graded_at: Optional[datetime] = None
    graded_by_staff_id: Optional[str] = None
    reading_focused_seconds: Optional[int] = None
    attachments: list[SubmissionAttachmentResponse] = []
    total_points: Optional[float] = None
    created_at: Optional[datetime] = None


class GradeRequest(BaseModel):
    grade: float
    feedback: Optional[str] = None
    expected_feedback_fingerprint: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class FeedbackSuggestionResponse(BaseModel):
    submission_id: int
    feedback: str
    detail_level: Literal["GENERAL", "DETAILED"]
    answer_release_authorized: bool
    attempt_count: int
    evidence_item_count: int
    included_item_count: int
    evidence_fingerprint: str = Field(min_length=64, max_length=64)
    feedback_fingerprint: str = Field(min_length=64, max_length=64)
    generated_at: datetime


class FeedbackEligibilityResponse(BaseModel):
    submission_id: int
    eligible: bool
    answer_release_authorized: bool
    code: Optional[str] = None
    message: Optional[str] = None


class FeedbackPublicationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    feedback: str = Field(min_length=1, max_length=1200)
    expected_evidence_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_feedback_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("feedback")
    @classmethod
    def plain_text_only(cls, value: str) -> str:
        if "```" in value or re.search(r"<\s*/?\s*[a-z][^>]*>", value, re.IGNORECASE):
            raise ValueError("Feedback must be plain text")
        return value


class FeedbackPublicationResponse(BaseModel):
    submission_id: int
    feedback: str
    evidence_fingerprint: str = Field(min_length=64, max_length=64)
    feedback_fingerprint: str = Field(min_length=64, max_length=64)


class ReadingFocusPayload(BaseModel):
    focused_seconds: int = Field(gt=0, le=300, strict=True)
