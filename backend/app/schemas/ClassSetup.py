from enum import Enum
from pydantic import BaseModel, Field


class AcademicYearSetupMode(str, Enum):
    SECTIONS_ONLY = "sections_only"
    RETAIN_CLASSES_AND_ADVISERS = "retain_classes_and_advisers"
    RETAIN_CLASSES_WITHOUT_ADVISERS = "retain_classes_without_advisers"


class AcademicYearSetupRequest(BaseModel):
    source_academic_year_id: int
    target_academic_year_id: int
    mode: AcademicYearSetupMode = AcademicYearSetupMode.SECTIONS_ONLY
    academic_level_ids: list[int] | None = None


class AcademicYearSetupSectionItem(BaseModel):
    id: int
    academic_year_id: int
    academic_level_id: int
    section_name: str
    pathway_id: int | None = None
    is_active: bool = True
    is_created: bool


class AcademicYearSetupClassItem(BaseModel):
    class_id: int
    academic_year_id: int
    academic_level_id: int
    section_name: str
    adviser_staff_id: str | None = None
    pathway_id: int | None = None
    is_created: bool


class AcademicYearSetupResponse(BaseModel):
    source_academic_year_id: int
    target_academic_year_id: int
    mode: str
    sections_created: int
    sections_reused: int
    classes_created: int
    classes_reused: int
    sections: list[AcademicYearSetupSectionItem] = []
    classes: list[AcademicYearSetupClassItem] = []

