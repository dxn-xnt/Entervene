from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class SubjectLoadItem(BaseModel):
    subject_load_id: int | None = None
    class_id: int
    subject_id: int
    staff_id: str | None = None
    academic_period_id: int
    start_time: str | None = None
    end_time: str | None = None
    days_of_week: list[str] = Field(default_factory=list)
    status: str = "draft"


class ConflictItem(BaseModel):
    rule: str
    severity: str = "error"  # "error" | "warning"
    message: str
    class_id: int | None = None
    subject_id: int | None = None
    staff_id: str | None = None
    day: str | None = None
    affected_key: str | None = None


class TeacherWorkloadItem(BaseModel):
    staff_id: str
    staff_name: str
    daily_hours: dict[str, float] = Field(default_factory=dict)
    daily_subjects_count: dict[str, int] = Field(default_factory=dict)
    total_weekly_hours: float = 0.0
    has_capacity_warning: bool = False


class ValidationResultResponse(BaseModel):
    is_valid: bool
    conflicts: list[ConflictItem]
    teacher_workloads: list[TeacherWorkloadItem]


class ValidateSubjectLoadRequest(BaseModel):
    academic_period_id: int
    academic_level_id: int | None = None
    loads: list[SubjectLoadItem]


class BatchSaveSubjectLoadRequest(BaseModel):
    academic_period_id: int
    academic_level_id: int
    action: str  # "draft" | "publish"
    loads: list[SubjectLoadItem]


class BatchSaveSubjectLoadResponse(BaseModel):
    message: str
    saved_count: int
    status: str
    is_valid: bool
    conflicts: list[ConflictItem]
