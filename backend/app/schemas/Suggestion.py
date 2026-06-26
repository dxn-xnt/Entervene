from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


SuggestionResourceType = Literal["LESSON", "CLASSWORK"]
SuggestionPriority = Literal["LOW", "NORMAL", "HIGH", "URGENT"]
SuggestionStatus = Literal["DRAFT", "ACTIVE", "COMPLETED", "DISMISSED", "ARCHIVED"]


class ManualSuggestionCreate(BaseModel):
    student_id: UUID
    subject_id: int
    resource_type: SuggestionResourceType
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    priority: SuggestionPriority = "NORMAL"
    lesson_id: Optional[int] = None
    classwork_assignment_id: Optional[int] = None


class SuggestionResourceSummary(BaseModel):
    resource_type: SuggestionResourceType
    title: str
    subject_id: int
    is_available: bool
    unavailable_reason: Optional[str] = None
    lesson_id: Optional[int] = None
    classwork_id: Optional[int] = None
    classwork_assignment_id: Optional[int] = None
    classwork_type: Optional[str] = None
    class_id: Optional[int] = None


class SuggestionClassworkResponse(BaseModel):
    suggestion_classwork_id: int
    classwork_assignment_id: int
    is_completed: bool
    completed_at: Optional[datetime] = None
    score_before: Optional[float] = None
    score_after: Optional[float] = None


class SuggestionResponse(BaseModel):
    student_suggestion_id: int
    suggestion_type: str
    resource_type: SuggestionResourceType
    title: str
    description: Optional[str] = None
    priority: SuggestionPriority
    status: SuggestionStatus
    is_viewed: bool
    viewed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    student_id: UUID
    subject_id: int
    lesson_id: Optional[int] = None
    created_by_staff_id: Optional[str] = None
    resource: SuggestionResourceSummary
    classwork_link: Optional[SuggestionClassworkResponse] = None
    source_metrics: Optional[dict] = None


class RecommendationDraftRequest(BaseModel):
    class_id: int
    subject_id: int
    low_score_threshold: float = Field(default=75, ge=0, le=100)
    limit: int = Field(default=20, ge=1, le=100)


class SuggestionListResponse(BaseModel):
    suggestions: list[SuggestionResponse] = Field(default_factory=list)
