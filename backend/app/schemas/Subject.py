from datetime import datetime

from pydantic import BaseModel, Field


class SubjectAcademicLevel(BaseModel):
    academic_level_id: int
    level_name: str
    grade_level: int


class SubjectBase(BaseModel):
    subject_name: str = Field(..., min_length=1, max_length=150)
    subject_codename: str | None = Field(None, max_length=50)
    subject_group: str | None = Field(None, max_length=50)
    hours: int | None = Field(None, ge=0)
    default_grading_template: str | None = Field(None, max_length=100)
    description: str | None = None
    academic_level_id: int


class SubjectCreate(SubjectBase):
    status: str = "active"


class SubjectUpdate(BaseModel):
    subject_name: str | None = Field(None, min_length=1, max_length=150)
    subject_codename: str | None = Field(None, max_length=50)
    subject_group: str | None = Field(None, max_length=50)
    hours: int | None = Field(None, ge=0)
    default_grading_template: str | None = Field(None, max_length=100)
    description: str | None = None
    status: str | None = None
    academic_level_id: int | None = None


class SubjectListItem(BaseModel):
    subject_id: int
    subject_name: str
    subject_codename: str | None
    subject_group: str | None
    hours: int | None
    default_grading_template: str | None
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
    subject_groups: list[str]
    statuses: list[str]
    default_status: str
    grading_templates: list[str]


class SubjectImportError(BaseModel):
    row: int | None
    message: str


class SubjectImportResponse(BaseModel):
    total_rows: int
    created_count: int
    skipped_count: int
    error_count: int
    errors: list[SubjectImportError]
