from pydantic import BaseModel
from datetime import datetime


class StudentSupportActivity(BaseModel):
    assignment_id: int
    title: str
    classwork_type: str
    submission_status: str | None
    grade: float | None
    total_points: float | None


class StudentPersistentIntervention(BaseModel):
    intervention_id: int
    status: str
    subject_id: int
    subject_name: str
    class_id: int
    class_name: str
    teacher_name: str | None
    activities: list[StudentSupportActivity]
    reviewer_id: int | None
    resolved_at: datetime | None = None
    resolution_message: str | None = None


class StudentPersistentInterventionList(BaseModel):
    items: list[StudentPersistentIntervention]
