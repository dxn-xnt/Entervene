from typing import Literal, Optional
from pydantic import BaseModel, Field

from app.schemas.Quiz import QuizQuestionIn


class AIQuizTestPart(BaseModel):
    type: Literal["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"] = "MULTIPLE_CHOICE"
    count: int = Field(default=5, ge=1, le=50)
    points_per_item: float = Field(default=1.0, ge=0.5, le=100.0)


class AIQuizGenerateRequest(BaseModel):
    subject_id: int
    lesson_ids: list[int] = Field(default_factory=list)
    test_parts: list[AIQuizTestPart] = Field(default_factory=list)
    difficulty: Literal["EASY", "MEDIUM", "HARD"] = "MEDIUM"


class AIQuizGenerateResponse(BaseModel):
    questions: list[QuizQuestionIn] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
