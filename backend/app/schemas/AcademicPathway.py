from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


class DepedClusterRead(BaseModel):
    id: int
    code: str
    name: str
    category: str
    sort_order: int

    class Config:
        from_attributes = True


class AcademicPathwayBase(BaseModel):
    code: str = Field(..., max_length=50)
    name: str = Field(..., max_length=150)
    is_enabled: bool = True
    sort_order: int = 0
    deped_cluster_id: int | None = None


class PathwayCreate(AcademicPathwayBase):
    pass


class PathwayUpdate(BaseModel):
    code: str | None = Field(None, max_length=50)
    name: str | None = Field(None, max_length=150)
    is_enabled: bool | None = None
    sort_order: int | None = None
    deped_cluster_id: int | None = None


class AcademicPathwayRead(AcademicPathwayBase):
    id: int
    deped_cluster: DepedClusterRead | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class PathwayListResponse(BaseModel):
    pathways: list[AcademicPathwayRead]
