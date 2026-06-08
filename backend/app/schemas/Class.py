from uuid import UUID

from pydantic import BaseModel


class AcademicYearOption(BaseModel):
    academic_year_id: int
    year_label: str


class AcademicLevelOption(BaseModel):
    academic_level_id: int
    level_name: str
    grade_level: int


class AdviserOption(BaseModel):
    staff_id: str
    first_name: str
    middle_name: str | None
    last_name: str
    suffix: str | None


class ClassFormOptionsResponse(BaseModel):
    academic_year: AcademicYearOption
    academic_levels: list[AcademicLevelOption]
    eligible_advisers: list[AdviserOption]


class ClassListItem(BaseModel):
    class_id: int
    section_name: str
    class_status: str
    academic_year: AcademicYearOption
    academic_level: AcademicLevelOption
    adviser: AdviserOption | None
    student_count: int
    subject_count: int


class ClassListSummary(BaseModel):
    total_classes: int
    active_classes: int
    archived_classes: int
    students_assigned: int


class ClassListResponse(BaseModel):
    summary: ClassListSummary
    classes: list[ClassListItem]


class UnassignedStudentItem(BaseModel):
    student_id: UUID
    student_lrn: str
    first_name: str
    middle_name: str | None
    last_name: str
    gender: str | None
    academic_level_id: int


class UnassignedStudentsResponse(BaseModel):
    academic_level: AcademicLevelOption
    academic_year: AcademicYearOption
    students: list[UnassignedStudentItem]


class ImportPreviewAdviser(AdviserOption):
    pass


class ImportPreviewStudent(UnassignedStudentItem):
    pass


class ImportPreviewSection(BaseModel):
    section_name: str
    adviser: ImportPreviewAdviser
    students: list[ImportPreviewStudent]


class ImportPreviewSummary(BaseModel):
    section_count: int
    student_count: int


class ValidateClassImportResponse(BaseModel):
    academic_level: AcademicLevelOption
    academic_year: AcademicYearOption
    sections: list[ImportPreviewSection]
    summary: ImportPreviewSummary


class BatchCreateSectionRequest(BaseModel):
    section_name: str
    adviser_staff_id: str
    student_ids: list[UUID]


class BatchCreateClassesRequest(BaseModel):
    academic_level_id: int
    sections: list[BatchCreateSectionRequest]


class CreatedClassItem(BaseModel):
    class_id: int
    section_name: str
    adviser_staff_id: str
    student_count: int


class BatchCreateSummary(BaseModel):
    class_count: int
    student_assignment_count: int


class BatchCreateClassesResponse(BaseModel):
    message: str
    academic_level_id: int
    academic_year_id: int
    summary: BatchCreateSummary
    classes: list[CreatedClassItem]
