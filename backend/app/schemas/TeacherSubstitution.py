from __future__ import annotations
import uuid
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field
from app.schemas.SubjectLoad import ConflictItem


class TeacherSubstitutionCreate(BaseModel):
    subject_load_id: int
    substitute_staff_id: str
    start_date: date
    end_date: date | None = None
    reason: str | None = None


class TeacherSubstitutionBulkCreate(BaseModel):
    subject_load_ids: list[int]
    substitute_staff_id: str
    start_date: date
    end_date: date | None = None
    reason: str | None = None


class TeacherSubstitutionUpdateEndDate(BaseModel):
    end_date: date | None = None


class TeacherSubstitutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    substitution_id: int
    batch_id: uuid.UUID | None = None
    subject_load_id: int
    original_staff_id: str
    original_staff_name: str
    substitute_staff_id: str
    substitute_staff_name: str
    subject_id: int
    subject_name: str
    subject_codename: str | None = None
    class_id: int
    section_name: str
    academic_period_id: int
    period_name: str
    start_date: date
    end_date: date | None
    status: str  # 'active' | 'completed' | 'cancelled'
    is_currently_active: bool
    reason: str | None = None
    conflicts: list[ConflictItem] = Field(default_factory=list)
    created_by_admin_id: str | None = None
    ended_by_admin_id: str | None = None
    ended_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TeacherSubstitutionBulkResponse(BaseModel):
    batch_id: uuid.UUID
    created_count: int
    substitutions: list[TeacherSubstitutionResponse]


class TeacherLoadSummaryItem(BaseModel):
    subject_load_id: int
    subject_id: int
    subject_name: str
    subject_codename: str | None = None
    class_id: int
    section_name: str
    academic_period_id: int
    period_name: str
    is_active_period: bool = False
    start_time: str | None = None
    end_time: str | None = None
    days_of_week: list[str] = Field(default_factory=list)
    has_active_substitution: bool = False
    active_substitute_name: str | None = None

