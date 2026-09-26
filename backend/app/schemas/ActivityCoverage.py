from datetime import datetime

from pydantic import BaseModel, Field


class ActivityCoverageUpdate(BaseModel):
    lesson_ids: list[int] = Field(default_factory=list)
    competency_ids: list[int] = Field(default_factory=list)


class ActivityCoverageLink(BaseModel):
    coverage_id: int
    lesson_id: int | None
    competency_id: int | None
    valid_from: datetime
    linked_by_staff_id: str | None
    valid_until: datetime | None
    removed_by_staff_id: str | None


class ActivityCoverageResponse(BaseModel):
    classwork_id: int
    class_id: int
    academic_period_id: int
    links: list[ActivityCoverageLink]
