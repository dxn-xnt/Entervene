from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class GradingTemplateComponentCreate(BaseModel):
    component_name: str = Field(..., min_length=1, max_length=100)
    weight: float = Field(..., gt=0, le=100)
    display_order: int | None = Field(None, ge=1)


class GradingTemplateComponentResponse(GradingTemplateComponentCreate):
    component_id: int
    display_order: int
    created_at: datetime | None
    updated_at: datetime | None


class GradingTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template_name: str = Field(..., min_length=1, max_length=150)
    description: str | None = None
    passing_threshold: float = Field(..., ge=0, le=100)
    status: str = "active"
    subject_ids: list[int] = Field(default_factory=list)
    components: list[GradingTemplateComponentCreate]


class GradingTemplateUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template_name: str | None = Field(None, min_length=1, max_length=150)
    description: str | None = None
    passing_threshold: float | None = Field(None, ge=0, le=100)
    status: str | None = None
    subject_ids: list[int] | None = None
    replacement_template_id: int | None = None
    components: list[GradingTemplateComponentCreate] | None = None
    updated_at: datetime


class GradingTemplateSubject(BaseModel):
    subject_id: int
    subject_name: str
    subject_codename: str | None
    academic_level_id: int | None = None
    grade_level: int | None = None


class GradingTemplateListItem(BaseModel):
    grading_template_id: int
    template_name: str
    description: str | None
    passing_threshold: float
    assigned_subjects: list[GradingTemplateSubject]
    assigned_subject_count: int
    is_locked: bool
    lock_reason: str | None
    status: str
    total_weight: float
    component_count: int
    components: list[GradingTemplateComponentResponse]
    created_at: datetime | None
    updated_at: datetime | None


class GradingTemplateResponse(GradingTemplateListItem):
    pass


class GradingTemplateListSummary(BaseModel):
    total_templates: int
    active_templates: int
    archived_templates: int


class GradingTemplateListResponse(BaseModel):
    summary: GradingTemplateListSummary
    grading_templates: list[GradingTemplateListItem]


class GradingTemplateFormOptions(BaseModel):
    default_components: list[GradingTemplateComponentCreate]
