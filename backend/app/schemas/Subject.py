from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class SubjectAcademicLevel(BaseModel):
    academic_level_id: int
    level_name: str
    grade_level: int


class SubjectTemplateInline(BaseModel):
    grading_template_id: int
    template_name: str
    passing_threshold: float
    components: list[dict]


class SubjectBase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject_name: str = Field(..., min_length=1, max_length=150)
    subject_codename: str | None = Field(None, max_length=50)
    grading_template_id: int
    is_core: bool = False
    is_math_or_science: bool = False
    description: str | None = None
    academic_level_id: int


class SubjectCreate(SubjectBase):
    status: str = "active"


class SubjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subject_name: str | None = Field(None, min_length=1, max_length=150)
    subject_codename: str | None = Field(None, max_length=50)
    grading_template_id: int | None = None
    is_core: bool | None = None
    is_math_or_science: bool | None = None
    description: str | None = None
    status: str | None = None
    academic_level_id: int | None = None


class SubjectListItem(BaseModel):
    subject_id: int
    subject_name: str
    subject_codename: str | None
    grading_template_id: int
    grading_template: SubjectTemplateInline
    is_core: bool = False
    is_math_or_science: bool = False
    description: str | None
    status: str
    academic_level: SubjectAcademicLevel
    created_at: datetime | None
    updated_at: datetime | None


class SubjectResponse(SubjectListItem):
    pass


class SubjectListSummary(BaseModel):
    total_subjects: int
    active_subjects: int
    archived_subjects: int


class SubjectListResponse(BaseModel):
    summary: SubjectListSummary
    subjects: list[SubjectListItem]


class SubjectFormOptions(BaseModel):
    academic_levels: list[SubjectAcademicLevel]
    statuses: list[str]
    default_status: str
    grading_templates: list[str]
    grading_template_details: list[SubjectTemplateInline]


class SubjectImportError(BaseModel):
    row: int | None
    message: str


class SubjectImportResponse(BaseModel):
    total_rows: int
    created_count: int
    skipped_count: int
    error_count: int
    errors: list[SubjectImportError]
    warnings: list[str] = []
