from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class TeacherInterventionSummary(BaseModel):
    intervention_id: int
    student_id: UUID
    student_name: str
    student_lrn: str
    class_id: int
    class_name: str
    subject_id: int
    subject_name: str
    academic_period_id: int
    academic_period_name: str
    status: str
    source_prediction_id: int
    source_prediction_revision: int
    triggering_predicted_grade: float
    triggering_intervention_level: str
    created_at: datetime
    activated_at: datetime | None = None
    diagnosis_summary: dict[str, Any]


class TeacherInterventionDetail(TeacherInterventionSummary):
    diagnosis_snapshot: dict[str, Any]
    activated_by_staff_id: str | None = None
    resolved_at: datetime | None = None
    resolution_reason: str | None = None


class TeacherInterventionList(BaseModel):
    items: list[TeacherInterventionSummary]
    total: int
