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


class QuizImportPreviewResponse(BaseModel):
    title: Optional[str] = None
    instructions: Optional[str] = None
    questions: list[QuizQuestionIn] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


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


class QuizAttemptOptionOut(BaseModel):
    option_id: int
    option_text: str
    option_order: int
    is_correct: Optional[bool] = None


class QuizAttemptQuestionOut(BaseModel):
    quiz_question_id: int
    question_text: str
    question_type: str
    points: float
    display_order: int
    options: list[QuizAttemptOptionOut] = Field(default_factory=list)
    answer_text: Optional[str] = None
    selected_option_id: Optional[int] = None
    points_awarded: Optional[float] = None
    is_correct: Optional[bool] = None


class QuizAttemptResponse(BaseModel):
    quiz_id: int
    classwork_assignment_id: int
    classwork_id: int
    title: str
    instructions: Optional[str] = None
    total_points: Optional[float] = None
    duration_minutes: Optional[int] = None
    max_attempts: int
    attempt_count: int
    status: str
    started_at: Optional[datetime] = None
    server_time: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    grade: Optional[float] = None
    can_submit: bool
    questions: list[QuizAttemptQuestionOut] = Field(default_factory=list)


class QuizAnswerIn(BaseModel):
    quiz_question_id: int
    selected_option_id: Optional[int] = None
    answer_text: Optional[str] = None


class QuizSubmitRequest(BaseModel):
    answers: list[QuizAnswerIn] = Field(default_factory=list)


class QuizOptionDistributionOut(BaseModel):
    option_id: int
    option_text: str
    is_correct: bool
    selected_count: int


class QuizQuestionAnalysisOut(BaseModel):
    quiz_question_id: int
    question_text: str
    question_type: str
    points: float
    answered_count: int
    correct_count: int
    accuracy_percent: Optional[float] = None
    needs_grading_count: int = 0
    option_distribution: list[QuizOptionDistributionOut] = Field(default_factory=list)


class QuizStudentScoreOut(BaseModel):
    student_id: str
    student_name: str
    status: str
    attempt_count: int
    grade: Optional[float] = None
    score_percent: Optional[float] = None
    submitted_at: Optional[datetime] = None
    needs_grading: bool = False


class QuizAnalysisResponse(BaseModel):
    quiz_id: int
    classwork_id: int
    title: str
    total_points: Optional[float] = None
    total_students: int
    submitted_count: int
    missing_count: int
    graded_count: int
    needs_grading_count: int
    average_score: Optional[float] = None
    class_accuracy_percent: Optional[float] = None
    questions: list[QuizQuestionAnalysisOut] = Field(default_factory=list)
    students: list[QuizStudentScoreOut] = Field(default_factory=list)
