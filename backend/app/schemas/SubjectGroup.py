from pydantic import BaseModel, Field


class SubjectGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    passing_threshold: float = Field(83.0, ge=0, le=100)
    display_order: int = Field(0, ge=0)


class SubjectGroupUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    passing_threshold: float | None = Field(None, ge=0, le=100)
    is_active: bool | None = None
    display_order: int | None = Field(None, ge=0)


class SubjectGroupRead(BaseModel):
    subject_group_id: int
    name: str
    passing_threshold: float
    is_active: bool
    display_order: int
    subject_count: int = 0


class SubjectGroupListResponse(BaseModel):
    groups: list[SubjectGroupRead]
