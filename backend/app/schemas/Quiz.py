from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class QuizOptionIn(BaseModel):
    option_text: str
    is_correct: bool = False
    option_order: int


class QuizQuestionIn(BaseModel):
    question_text: str
    question_type: str
    points: float
    display_order: int
    difficulty_level: Optional[str] = None
    explanation: Optional[str] = None
    lesson_id: Optional[int] = None
    options: list[QuizOptionIn] = Field(default_factory=list)


class QuizSettingIn(BaseModel):
    is_shuffle_questions: bool = False
    enable_per_question_scoring: bool = True
    enable_per_question_time_limits: bool = False
    max_attempts: Optional[int] = None
    show_correct_answers: bool = False


class QuizBuilderUpsert(BaseModel):
    duration_minutes: Optional[int] = None
    accessible_at: Optional[datetime] = None
    status: str = "DRAFT"
    settings: QuizSettingIn = Field(default_factory=QuizSettingIn)
    questions: list[QuizQuestionIn] = Field(default_factory=list)


class QuizOptionOut(BaseModel):
    option_id: int
    option_text: str
    is_correct: bool
    option_order: int


class QuizQuestionOut(BaseModel):
    quiz_question_id: int
    question_id: int
    question_text: str
    question_type: str
    points: float
    display_order: int
    difficulty_level: Optional[str] = None
    explanation: Optional[str] = None
    lesson_id: Optional[int] = None
    options: list[QuizOptionOut] = Field(default_factory=list)


class QuizSettingOut(BaseModel):
    quiz_setting_id: int
    is_shuffle_questions: bool
    enable_per_question_scoring: bool
    enable_per_question_time_limits: bool
    max_attempts: Optional[int] = None
    show_correct_answers: bool


class QuizBuilderResponse(BaseModel):
    quiz_id: int
    classwork_id: int
    title: str
    total_points: Optional[float] = None
    total_items: int
    duration_minutes: Optional[int] = None
    accessible_at: Optional[datetime] = None
    status: str
    settings: Optional[QuizSettingOut] = None
    questions: list[QuizQuestionOut] = Field(default_factory=list)
    is_publish_ready: bool
    readiness_errors: list[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None


class QuizReadinessResponse(BaseModel):
    classwork_id: int
    quiz_id: Optional[int] = None
    is_publish_ready: bool
    readiness_errors: list[str] = Field(default_factory=list)
