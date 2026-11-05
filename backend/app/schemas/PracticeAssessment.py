"""Pydantic schemas for Practice Assessment configuration, questions, attempts, and diagnostic reviews."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


PracticeStatus = Literal["DRAFT", "PUBLISHED", "ARCHIVED"]
PracticePolicy = Literal["REQUIRE_PASS", "REQUIRE_ATTEMPT", "OPTIONAL"]
PracticeQuestionType = Literal["MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION"]
AttemptStatus = Literal["STARTED", "SUBMITTED", "ABANDONED"]


# ---------------------------------------------------------------------------
# Question Options & Questions (Authoring / Teacher Management)
# ---------------------------------------------------------------------------

class PracticeOptionIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    option_text: str = Field(..., min_length=1)
    is_correct: bool = False
    option_order: int = Field(..., gt=0)


class PracticeOptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    option_id: int
    option_text: str
    is_correct: bool
    option_order: int


class PracticeQuestionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    question_text: str = Field(..., min_length=1)
    question_type: PracticeQuestionType = "MULTIPLE_CHOICE"
    points: Decimal = Field(default=Decimal("1.00"), gt=Decimal("0.00"))
    explanation: str | None = None
    display_order: int = Field(default=1, gt=0)
    is_ai_generated: bool = False
    options: list[PracticeOptionIn] = Field(default_factory=list)


class PracticeQuestionUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    question_text: str | None = Field(default=None, min_length=1)
    question_type: PracticeQuestionType | None = None
    points: Decimal | None = Field(default=None, gt=Decimal("0.00"))
    explanation: str | None = None
    display_order: int | None = Field(default=None, gt=0)
    options: list[PracticeOptionIn] | None = None


class PracticeQuestionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    practice_question_id: int
    version: int
    question_text: str
    question_type: str
    points: Decimal
    explanation: str | None
    display_order: int
    is_ai_generated: bool
    options: list[PracticeOptionRead] = Field(default_factory=list)


class PracticeQuestionsReorderRequest(BaseModel):
    ordered_question_ids: list[int] = Field(..., min_length=1)


class PracticeQuestionBatchSave(BaseModel):
    questions: list[PracticeQuestionCreate] = Field(..., min_length=1)
    replace_existing: bool = False


# ---------------------------------------------------------------------------
# Assessment Configuration (Teacher Management)
# ---------------------------------------------------------------------------

class PracticeAssessmentCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(default="Practice Assessment", min_length=1, max_length=255)
    passing_percentage: Decimal = Field(default=Decimal("75.00"), ge=Decimal("0.00"), le=Decimal("100.00"))
    gatekeeper_policy: PracticePolicy = "REQUIRE_PASS"
    shuffle_options: bool = True


class PracticeAssessmentUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    passing_percentage: Decimal | None = Field(default=None, ge=Decimal("0.00"), le=Decimal("100.00"))
    gatekeeper_policy: PracticePolicy | None = None
    shuffle_options: bool | None = None


class PracticeAssessmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    practice_assessment_id: int
    intervention_id: int
    title: str
    status: str
    gatekeeper_policy: str
    passing_percentage: Decimal
    version: int
    shuffle_options: bool
    created_by_staff_id: str
    created_at: datetime
    updated_at: datetime
    total_questions: int = 0
    total_points: Decimal = Decimal("0.00")
    questions: list[PracticeQuestionRead] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Student Attempt Execution (Active Taking - No Leaked Keys)
# ---------------------------------------------------------------------------

class PracticeAttemptActiveOption(BaseModel):
    option_id: int
    option_text: str
    option_order: int


class PracticeAttemptActiveQuestion(BaseModel):
    practice_question_id: int
    display_order: int
    question_text: str
    question_type: str
    points: Decimal
    options: list[PracticeAttemptActiveOption] = Field(default_factory=list)


class PracticeAttemptStartResponse(BaseModel):
    attempt_id: int
    attempt_number: int
    status: str
    passing_percentage: Decimal
    total_questions: int
    questions: list[PracticeAttemptActiveQuestion]


class PracticeAttemptAnswerSubmission(BaseModel):
    practice_question_id: int
    selected_option_id: int | None = None
    student_answer_text: str | None = None


class PracticeAttemptSubmitRequest(BaseModel):
    answers: list[PracticeAttemptAnswerSubmission] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Student Diagnostic Feedback (Post-Submission Review - With Keys)
# ---------------------------------------------------------------------------

class PracticeFeedbackOption(BaseModel):
    option_id: int
    option_text: str
    is_correct: bool


class PracticeAttemptFeedbackItem(BaseModel):
    practice_question_id: int | None
    question_text: str
    question_type: str
    points_possible: Decimal
    points_awarded: Decimal
    is_correct: bool
    student_answer: str | None
    selected_option_id: int | None
    correct_answer: str
    explanation: str | None
    options: list[PracticeFeedbackOption] = Field(default_factory=list)


class PracticeAttemptFeedbackResponse(BaseModel):
    attempt_id: int
    attempt_number: int
    status: str
    total_score: Decimal
    max_score: Decimal
    score_percentage: Decimal
    passing_percentage: Decimal
    is_passed: bool
    result_status: Literal["PASSED", "BELOW_PASSING"]
    eligible_for_remediation: bool
    started_at: datetime
    completed_at: datetime | None
    items: list[PracticeAttemptFeedbackItem] = Field(default_factory=list)


class PracticeAttemptSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    attempt_id: int
    attempt_number: int
    status: str
    total_score: Decimal
    max_score: Decimal
    score_percentage: Decimal
    passing_threshold_snapshot: Decimal
    is_passed: bool
    started_at: datetime
    completed_at: datetime | None


# ---------------------------------------------------------------------------
# Progression Evaluation & AI / Import Helpers
# ---------------------------------------------------------------------------

class PracticeProgressionEvaluation(BaseModel):
    intervention_id: int
    student_id: UUID
    practice_exists: bool
    assessment_status: str | None = None
    gatekeeper_policy: str
    passing_percentage: Decimal | None = None
    attempts_count: int = 0
    practice_completed: bool = False
    practice_passed: bool = False
    eligible_for_remediation: bool = True
    best_score_percentage: Decimal | None = None
    reason: str


class AIGeneratePracticeQuestionsRequest(BaseModel):
    target_count: int = Field(default=5, ge=1, le=15)
    reading_classwork_ids: list[int] | None = None
    additional_guidance: str | None = Field(default=None, max_length=500)


class PracticeQuestionsImportPreviewResponse(BaseModel):
    source_filename: str
    total_parsed: int
    questions: list[PracticeQuestionCreate]
    warnings: list[str] = Field(default_factory=list)

