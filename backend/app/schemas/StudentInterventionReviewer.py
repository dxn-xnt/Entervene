from datetime import datetime

from pydantic import BaseModel


class StudentReviewerSummary(BaseModel):
    material_id: int
    subject_name: str
    title: str
    sent_at: datetime
    academic_period_id: int | None = None


class StudentReviewerDetail(StudentReviewerSummary):
    introduction: str
    body: str


class StudentReviewerList(BaseModel):
    items: list[StudentReviewerSummary]
    total: int
