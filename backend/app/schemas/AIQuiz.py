from typing import Optional
from pydantic import BaseModel, Field, model_validator

from app.schemas.Quiz import QuizQuestionIn


class AIQuizTestPart(BaseModel):
    type: str = "MULTIPLE_CHOICE"  # MULTIPLE_CHOICE | TRUE_FALSE | SHORT_ANSWER | ESSAY
    count: int = Field(default=5, ge=1, le=50)
    points_per_item: float = Field(default=1.0, ge=0.5, le=100.0)
    difficulty_breakdown: dict[str, int] = Field(default_factory=dict)
    """
    Optional per-part difficulty breakdown.
    Keys: EASY, MEDIUM, HARD — values: item counts that must sum to `count`.
    Empty/omitted → all items default to EASY.
    Example: {"EASY": 7, "MEDIUM": 5, "HARD": 3} for a 15-item part.
    """

    @model_validator(mode="after")
    def normalize_difficulty_breakdown(self) -> "AIQuizTestPart":
        # Strip zero / negative values
        cleaned = {k.upper(): v for k, v in self.difficulty_breakdown.items() if v > 0}
        # If nothing supplied, default to all-Easy
        if not cleaned:
            cleaned = {"EASY": self.count}
        self.difficulty_breakdown = cleaned
        return self


class AIQuizGenerateRequest(BaseModel):
    subject_id: int
    # Source mode A — full lessons (all readings attached to these lessons)
    lesson_ids: list[int] = Field(default_factory=list)
    # Source mode B — hand-picked reading classworks (mutually exclusive with lesson_ids)
    reading_classwork_ids: list[int] = Field(default_factory=list)
    # Optional extra scope/instructions for the AI
    additional_coverage: Optional[str] = None
    test_parts: list[AIQuizTestPart] = Field(default_factory=list)


class AIQuizGenerateResponse(BaseModel):
    questions: list[QuizQuestionIn] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
