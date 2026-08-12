from __future__ import annotations

from pydantic import BaseModel


class PathwayScopeRead(BaseModel):
    id: int | None = None
    academic_year_id: int
    academic_level_id: int
    grade_level: int
    level_name: str
    requires_pathway: bool

    class Config:
        from_attributes = True


class PathwayScopeItemUpdate(BaseModel):
    academic_level_id: int
    requires_pathway: bool


class PathwayScopeBatchPayload(BaseModel):
    academic_year_id: int
    scopes: list[PathwayScopeItemUpdate]


class PathwayScopeListResponse(BaseModel):
    academic_year_id: int
    scopes: list[PathwayScopeRead]
