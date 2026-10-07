from datetime import datetime
from math import isfinite

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.Classwork import ActivityRubricLevelInput, validate_activity_rubric


class RubricTemplateInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    levels: list[ActivityRubricLevelInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_template(self):
        self.name = self.name.strip()
        self.description = self.description.strip()
        if not self.name:
            raise ValueError("Template name is required")
        self.levels = validate_activity_rubric(self.levels)
        if any(not isfinite(level.points) or level.points > 999999.99 for level in self.levels):
            raise ValueError("Scores must be finite and at most 999999.99 points")
        if max(level.points for level in self.levels) <= 0:
            raise ValueError("Maximum score must be greater than zero")
        return self


class RubricTemplateResponse(RubricTemplateInput):
    model_config = ConfigDict(from_attributes=True)

    rubric_template_id: int
    owner_staff_id: str | None
    is_system: bool
    created_at: datetime
    updated_at: datetime
