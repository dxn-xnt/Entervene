from datetime import date, datetime

from pydantic import BaseModel


class SubjectOfferingSubject(BaseModel):
    subject_id: int
    subject_name: str
    subject_codename: str | None
    subject_group: str | None


class SubjectOfferingAcademicYear(BaseModel):
    academic_year_id: int
    year_label: str
    is_active: bool


class SubjectOfferingAcademicLevel(BaseModel):
    academic_level_id: int
    level_name: str
    grade_level: int


class SubjectOfferingAcademicPeriod(BaseModel):
    academic_period_id: int
    period_name: str
    period_type: str
    period_sequence: int
    academic_year_id: int


class SubjectOfferingCreate(BaseModel):
    subject_id: int
    academic_year_id: int
    academic_level_id: int
    academic_period_id: int
    pathway: str
    status: str = "active"


class SubjectOfferingUpdate(BaseModel):
    subject_id: int | None = None
    academic_year_id: int | None = None
    academic_level_id: int | None = None
    academic_period_id: int | None = None
    pathway: str | None = None
    status: str | None = None


class SubjectOfferingCopyAcademicYearRequest(BaseModel):
    source_academic_year_id: int
    target_academic_year_id: int
    overwrite_existing: bool = False


class SubjectOfferingCopySkippedItem(BaseModel):
    subject_id: int | None = None
    source_subject_offering_id: int | None = None
    reason: str


class SubjectOfferingCopyAcademicYearResponse(BaseModel):
    source_academic_year_id: int
    target_academic_year_id: int
    created_count: int
    updated_count: int
    skipped_count: int
    skipped: list[SubjectOfferingCopySkippedItem]


class SubjectOfferingListItem(BaseModel):
    subject_offering_id: int
    subject: SubjectOfferingSubject
    academic_year: SubjectOfferingAcademicYear
    academic_level: SubjectOfferingAcademicLevel
    academic_period: SubjectOfferingAcademicPeriod
    pathway: str
    status: str
    created_at: datetime | None
    updated_at: datetime | None


class SubjectOfferingResponse(SubjectOfferingListItem):
    pass


class SubjectOfferingListSummary(BaseModel):
    total_offerings: int
    active_offerings: int
    archived_offerings: int


class SubjectOfferingListResponse(BaseModel):
    summary: SubjectOfferingListSummary
    subject_offerings: list[SubjectOfferingListItem]


class SubjectOfferingFormSubject(BaseModel):
    subject_id: int
    subject_name: str
    subject_codename: str | None
    subject_group: str | None
    academic_level_id: int


class SubjectOfferingFormAcademicYear(SubjectOfferingAcademicYear):
    start_date: date
    end_date: date


class SubjectOfferingFormOptions(BaseModel):
    academic_years: list[SubjectOfferingFormAcademicYear]
    academic_levels: list[SubjectOfferingAcademicLevel]
    academic_periods: list[SubjectOfferingAcademicPeriod]
    pathways: list[str]
    statuses: list[str]
    default_status: str
    active_subjects: list[SubjectOfferingFormSubject]


class SubjectOfferingImportError(BaseModel):
    row: int | None
    message: str


class SubjectOfferingImportResponse(BaseModel):
    total_rows: int
    created_count: int
    skipped_count: int
    error_count: int
    errors: list[SubjectOfferingImportError]
