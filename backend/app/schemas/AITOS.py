# app/schemas/AITOS.py
from datetime import datetime
from typing import Any, List, Literal, Optional
from pydantic import BaseModel, Field, model_validator


class TOSOption(BaseModel):
    option_id: Optional[int] = None
    option_text: str
    is_correct: bool = False
    option_order: int = 1


class TOSQuestionIn(BaseModel):
    competency_id: Optional[int] = None
    competency_label: str
    question_text: str
    question_type: str
    difficulty_band: str
    cognitive_level: str
    display_order: int = 1
    points: float = 1.0
    explanation: Optional[str] = None
    options: List[TOSOption] = Field(default_factory=list)


class TOSQuestionOut(TOSQuestionIn):
    tos_question_id: int
    tos_exam_id: int

    model_config = {"from_attributes": True}


class TOSExamUpsert(BaseModel):
    title: str
    quarter: str = "Term 1"
    status: str = "DRAFT"
    test_parts: List[dict[str, Any]] = Field(default_factory=list)
    competencies: List[dict[str, Any]] = Field(default_factory=list)
    difficulty_ratio: dict[str, Any] = Field(default_factory=dict)
    questions: List[TOSQuestionIn] = Field(default_factory=list)


class TOSExamSummary(BaseModel):
    tos_exam_id: int
    subject_id: int
    subject_name: Optional[str] = None
    title: str
    quarter: str
    status: str
    total_items: int = 0
    question_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TOSExamDetailResponse(BaseModel):
    tos_exam_id: int
    subject_id: int
    created_by_staff_id: Optional[str] = None
    title: str
    quarter: str
    status: str
    test_parts: List[dict[str, Any]] = Field(default_factory=list)
    competencies: List[dict[str, Any]] = Field(default_factory=list)
    difficulty_ratio: dict[str, Any] = Field(default_factory=dict)
    questions: List[TOSQuestionOut] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# AI generation schemas
class TOSRowRequest(BaseModel):
    competency_id: Optional[int] = None
    label: str = Field(max_length=1000)
    code: Optional[str] = Field(default=None, max_length=100)
    type_counts: dict[str, int] = Field(default_factory=dict)
    bloom_targets: dict[str, int] = Field(default_factory=dict)

    @model_validator(mode="after")
    def bound_counts(self):
        allowed = {"MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION", "MATCHING", "ESSAY"}
        if set(self.type_counts) - allowed or not 1 <= sum(self.type_counts.values()) <= 20:
            raise ValueError("Each row must request 1 to 20 questions of supported types")
        if any(n < 0 or n > 20 for n in [*self.type_counts.values(), *self.bloom_targets.values()]):
            raise ValueError("Counts must be between 0 and 20")
        if set(self.bloom_targets) - {"REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"}:
            raise ValueError("Unsupported Bloom category")
        return self


class AITOSGenerateRequest(BaseModel):
    subject_id: int
    subject_name: str = Field(max_length=200)
    language: str = Field(default="English", max_length=40)
    rows: List[TOSRowRequest] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def bound_total(self):
        if sum(sum(row.type_counts.values()) for row in self.rows) > 50:
            raise ValueError("Generate at most 50 TOS questions per request")
        return self


class AITOSGenerateResponse(BaseModel):
    questions: List[TOSQuestionIn] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


# AI field assistance schemas
AITOSFieldType = Literal["suggest_competencies", "suggest_title", "suggest_test_parts"]


class AITOSSuggestedCompetency(BaseModel):
    code: Optional[str] = None
    label: str
    days: int = Field(default=3, ge=1, le=60)


class AITOSSuggestedTestPart(BaseModel):
    type: str
    count: int = Field(default=0, ge=0, le=100)


class AITOSAssistRequest(BaseModel):
    field: AITOSFieldType
    subject_id: Optional[int] = None
    subject_name: str = Field(default="", max_length=200)
    term: str = Field(default="Term 1", max_length=50)
    language: str = Field(default="English", max_length=40)
    total_items: Optional[int] = Field(default=30, ge=5, le=100)
    context_text: Optional[str] = Field(default=None, max_length=1000)


class AITOSAssistResponse(BaseModel):
    field: AITOSFieldType
    title: Optional[str] = None
    competencies: List[AITOSSuggestedCompetency] = Field(default_factory=list)
    test_parts: List[AITOSSuggestedTestPart] = Field(default_factory=list)
    raw_text: Optional[str] = None
