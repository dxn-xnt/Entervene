from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, model_validator


class StudentRequiredReading(BaseModel):
    classwork_id: int
    title: str
    assignment_id: int
    order: int
    completion_status: Literal["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]
    focused_seconds: int
    completed_at: datetime | None
    review_status: Literal["NOT_REVIEWED", "REVIEWED"] = "NOT_REVIEWED"
    reviewed_at: datetime | None = None


class ReviewReadingRequest(BaseModel):
    reading_assignment_id: int | None = None
    assignment_id: int | None = None


class StudentReadingReviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    review_id: int
    intervention_id: int
    reading_assignment_id: int
    assignment_id: int | None = None
    student_id: UUID
    review_status: Literal["NOT_REVIEWED", "REVIEWED"] = "REVIEWED"
    reviewed_at: datetime | None = None
    acknowledged_at: datetime

    @model_validator(mode="after")
    def populate_aliases(self) -> StudentReadingReviewResponse:
        if self.reviewed_at is None:
            self.reviewed_at = self.acknowledged_at
        if self.assignment_id is None:
            self.assignment_id = self.reading_assignment_id
        return self


class StudentRequiredReadingIssue(BaseModel):
    resource_id: int | None
    order: int
    reason: Literal[
        "INVALID_RESOURCE", "MISSING_RESOURCE", "NOT_REQUIRED_READING",
        "INACCESSIBLE", "PLANNING_ONLY", "UNPUBLISHED", "LOCKED",
    ]


class StudentPreparationProgress(BaseModel):
    state: Literal[
        "NOT_APPLICABLE", "NOT_CONFIGURED", "BLOCKED", "NOT_STARTED",
        "IN_PROGRESS", "COMPLETE",
    ]
    is_satisfied: bool
    completed_count: int
    required_count: int
    accessible_count: int
    unavailable_count: int
    summary: str


class StudentSupportActivity(BaseModel):
    assignment_id: int
    title: str
    classwork_type: str
    submission_status: str | None
    grade: float | None
    total_points: float | None
    access_state: Literal["HISTORICAL", "PREPARATION_REQUIRED", "READY"]
    access_enforced: bool = False
    prerequisite_code: str | None = None
    prerequisite_message: str | None = None
    preparation: StudentPreparationProgress | None = None
    readings: list[StudentRequiredReading] = []


class StudentPersistentIntervention(BaseModel):
    intervention_id: int
    status: str
    subject_id: int
    subject_name: str
    class_id: int
    class_name: str
    teacher_name: str | None
    required_readings: list[StudentRequiredReading]
    resource_issues: list[StudentRequiredReadingIssue]
    preparation: StudentPreparationProgress
    activities: list[StudentSupportActivity]
    reviewer_id: int | None
    activated_at: datetime | None = None
    resolved_at: datetime | None = None
    resolution_message: str | None = None


class StudentPersistentInterventionList(BaseModel):
    items: list[StudentPersistentIntervention]
