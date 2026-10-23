from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class TemplateThresholdEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    academic_year_id: int = Field(gt=0)
    threshold: str = Field(strict=True)
    expected_updated_at: datetime
    reason: str = Field(strict=True)


class YearGeneralAverageSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    threshold: str = Field(strict=True)
    expected_version: int = Field(ge=0)
    reason: str = Field(strict=True)
    action: str
    confirmed: bool
    source_year_id: int | None = None
