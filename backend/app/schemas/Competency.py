# app/schemas/Competency.py
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel
from app.schemas.Lesson import LessonResponse


class CompetencyBase(BaseModel):
    statement: str
    competency_code: Optional[str] = None
    description: Optional[str] = None
    order_index: Optional[int] = 1
    target_hours: Optional[int] = 0


class CompetencyCreate(CompetencyBase):
    subject_id: int
    academic_period_id: Optional[int] = None


class CompetencyUpdate(BaseModel):
    statement: Optional[str] = None
    competency_code: Optional[str] = None
    description: Optional[str] = None
    order_index: Optional[int] = None
    target_hours: Optional[int] = None
    academic_period_id: Optional[int] = None
    is_archived: Optional[bool] = None


class CompetencyResponse(CompetencyBase):
    competency_id: int
    subject_id: int
    subject_name: Optional[str] = None
    academic_period_id: Optional[int] = None
    period_name: Optional[str] = None
    is_archived: bool = False
    created_by_staff_id: Optional[str] = None
    teacher_name: Optional[str] = None
    lesson_count: Optional[int] = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CompetencyTreeNode(CompetencyResponse):
    lessons: List[LessonResponse] = []


class SubjectHierarchyTreeResponse(BaseModel):
    subject_id: int
    subject_name: str
    competencies: List[CompetencyTreeNode] = []
    unassigned_lessons: List[LessonResponse] = []
    total_competencies: int = 0
    total_lessons: int = 0
