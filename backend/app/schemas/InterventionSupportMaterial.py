from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.Quiz import QuizOptionIn, QuizSettingIn


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReviewerContent(StrictModel):
    title: str = Field(default="", max_length=255)
    introduction: str = ""
    body: str = ""


class QuestionProvenance(StrictModel):
    source_kind: Literal["QUESTION_SCORE", "SCORED_COMPETENCY", "COVERAGE", "COMPONENT"]
    source_question_id: int | None = None
    lesson_id: int | None = None
    competency_id: int | None = None
    coverage_classwork_id: int | None = None
    component: str | None = None


class RemedialQuestion(StrictModel):
    question_text: str
    question_type: Literal["MULTIPLE_CHOICE", "SHORT_ANSWER"]
    points: float = Field(gt=0)
    display_order: int = Field(gt=0)
    difficulty_level: Literal["EASY", "MEDIUM", "HARD"] | None = None
    explanation: str | None = None
    lesson_id: int | None = None
    options: list[QuizOptionIn] = Field(default_factory=list)
    provenance: QuestionProvenance | None = None


class RemedialContent(StrictModel):
    title: str = Field(default="", max_length=255)
    instructions: str = ""
    duration_minutes: int | None = Field(default=None, gt=0)
    settings: QuizSettingIn = Field(default_factory=QuizSettingIn)
    questions: list[RemedialQuestion] = Field(default_factory=list)


class MaterialCreate(StrictModel):
    kind: Literal["STUDENT_REVIEWER", "REMEDIAL_ASSESSMENT"]


class MaterialUpdate(StrictModel):
    content: ReviewerContent | RemedialContent


class MaterialRead(StrictModel):
    material_id: int
    intervention_id: int
    kind: str
    status: str
    evidence_basis: dict
    generated_content: dict | None
    current_content: dict
    created_by_staff_id: str
    updated_by_staff_id: str
    created_at: datetime
    updated_at: datetime
    sent_at: datetime | None
    sent_by_staff_id: str | None


class MaterialList(StrictModel):
    items: list[MaterialRead]
    total: int
