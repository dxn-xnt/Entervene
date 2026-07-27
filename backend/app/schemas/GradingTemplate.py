from datetime import datetime
from pydantic import BaseModel, Field

from app.schemas.Subject import SubjectAcademicLevel


class GradingTemplateSubject(BaseModel):
    subject_id: int
    subject_name: str
    subject_codename: str | None


class GradingTemplateSubjectOption(GradingTemplateSubject):
    academic_level_id: int


class GradingTemplateComponentBase(BaseModel):
    component_name: str = Field(..., min_length=1, max_length=100)
    weight: float = Field(..., gt=0)
    display_order: int | None = Field(None, ge=1)


class GradingTemplateComponentCreate(GradingTemplateComponentBase):
    pass


class GradingTemplateComponentResponse(BaseModel):
    component_id: int
    component_name: str
    weight: float
    display_order: int
    created_at: datetime | None
    updated_at: datetime | None


class GradingTemplateBase(BaseModel):
    template_name: str = Field(..., min_length=1, max_length=150)
    description: str | None = None
    academic_level_id: int | None = None
    subject_id: int | None = None


class GradingTemplateCreate(GradingTemplateBase):
    status: str = "active"
    components: list[GradingTemplateComponentCreate]


class GradingTemplateUpdate(BaseModel):
    template_name: str | None = Field(None, min_length=1, max_length=150)
    description: str | None = None
    academic_level_id: int | None = None
    subject_id: int | None = None
    status: str | None = None
    components: list[GradingTemplateComponentCreate] | None = None


class GradingTemplateListItem(BaseModel):
    grading_template_id: int
    template_name: str
    description: str | None
    academic_level: SubjectAcademicLevel | None
    subject: GradingTemplateSubject | None
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
    academic_levels: list[SubjectAcademicLevel]
    subjects: list[GradingTemplateSubjectOption]
    statuses: list[str]
    default_status: str
    default_components: list[GradingTemplateComponentCreate]
