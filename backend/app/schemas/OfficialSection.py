from pydantic import BaseModel, Field


class OfficialSectionCreate(BaseModel):
    academic_year_id: int
    academic_level_id: int
    section_name: str = Field(min_length=1, max_length=100)
    pathway_id: int | None = None


class OfficialSectionUpdate(BaseModel):
    section_name: str | None = Field(default=None, min_length=1, max_length=100)
    pathway_id: int | None = None
    is_active: bool | None = None


class OfficialSectionRead(BaseModel):
    id: int
    academic_year_id: int
    academic_level_id: int
    section_name: str
    pathway_id: int | None
    pathway_name: str | None = None
    pathway_code: str | None = None
    is_active: bool
    has_class: bool = False


class OfficialSectionList(BaseModel):
    sections: list[OfficialSectionRead]
