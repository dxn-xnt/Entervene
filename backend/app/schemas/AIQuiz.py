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
    lesson_ids: list[int] = Field(default_factory=list, max_length=20)
    # Source mode B — hand-picked reading classworks (mutually exclusive with lesson_ids)
    reading_classwork_ids: list[int] = Field(default_factory=list, max_length=20)
    # Optional extra scope/instructions for the AI
    additional_coverage: Optional[str] = Field(default=None, max_length=2000)
    test_parts: list[AIQuizTestPart] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def bound_generation(self):
        if self.lesson_ids and self.reading_classwork_ids:
            raise ValueError("Select lessons or readings, not both")
        if sum(part.count for part in self.test_parts) > 20:
            raise ValueError("Generate at most 20 questions at a time")
        for part in self.test_parts:
            if set(part.difficulty_breakdown) - {"EASY", "MEDIUM", "HARD"} or sum(part.difficulty_breakdown.values()) != part.count:
                raise ValueError("Difficulty counts must match the requested question count")
        return self


class AIQuizGenerateResponse(BaseModel):
    questions: list[QuizQuestionIn] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
