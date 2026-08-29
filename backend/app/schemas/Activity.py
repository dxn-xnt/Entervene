# app/schemas/Activity.py
from datetime import datetime
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class ActivityCreateRequest(BaseModel):
    title: str
    classwork_category: str  # WRITTEN_WORK, PERFORMANCE_TASK, QUARTERLY_ASSESSMENT, EXAMS
    exam_subtype: Optional[str] = None  # SUMMATIVE_1, SUMMATIVE_2, TERM_EXAM
    total_points: float = Field(default=100.0, gt=0)
    class_id: int
    subject_id: int
    activity_mode: str = Field(default="MANUAL")  # MANUAL, ONLINE
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    lesson_ids: Optional[List[int]] = None


class StudentActivityScoreItem(BaseModel):
    student_id: UUID
    name: str
    score: Optional[float] = None


class ActivityScoresResponse(BaseModel):
    activity_id: int
    classwork_assignment_id: int
    title: str
    max_score: float
    activity_mode: str
    students: List[StudentActivityScoreItem]


class BulkScoreItem(BaseModel):
    student_id: UUID
    score: Optional[float] = None  # None means "not yet graded"


class BulkScoreUpdateRequest(BaseModel):
    class_id: int
    scores: List[BulkScoreItem]
