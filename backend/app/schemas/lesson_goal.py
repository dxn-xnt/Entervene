from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict


class LessonGoalItemInput(BaseModel):
    item_type: str  # "LESSON" or "CLASSWORK"
    lesson_id: Optional[int] = None
    classwork_id: Optional[int] = None
    order_index: int = 1


class LessonGoalSetRequest(BaseModel):
    academic_period_id: int
    items: List[LessonGoalItemInput]


class LessonGoalItemDetailLesson(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lesson_id: int
    title: str
    description: Optional[str] = None
    is_published: bool = False
    order_index: int = 1


class LessonGoalItemDetailClasswork(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    classwork_id: int
    classwork_assignment_id: Optional[int] = None
    title: str
    classwork_type: Optional[str] = None
    classwork_category: Optional[str] = None
    exam_subtype: Optional[str] = None
    is_graded: bool = True
    total_points: Optional[float] = None
    due_date: Optional[str] = None
    submission_status: Optional[str] = None


class LessonGoalItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    goal_item_id: int
    item_type: str  # "LESSON" or "CLASSWORK"
    lesson_id: Optional[int] = None
    classwork_id: Optional[int] = None
    order_index: int
    lesson: Optional[LessonGoalItemDetailLesson] = None
    classwork: Optional[LessonGoalItemDetailClasswork] = None


class LessonGoalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    goal_id: Optional[int] = None
    class_id: int
    subject_id: int
    academic_period_id: int
    items: List[LessonGoalItemResponse] = []
