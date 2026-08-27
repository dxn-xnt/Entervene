# app/schemas/AITOS.py
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, Field


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
    label: str
    code: Optional[str] = None
    type_counts: dict[str, int] = Field(default_factory=dict)
    bloom_targets: dict[str, int] = Field(default_factory=dict)


class AITOSGenerateRequest(BaseModel):
    subject_id: int
    subject_name: str
    rows: List[TOSRowRequest] = Field(default_factory=list)


class AITOSGenerateResponse(BaseModel):
    questions: List[TOSQuestionIn] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
