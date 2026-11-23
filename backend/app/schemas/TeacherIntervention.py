from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class TeacherInterventionSummary(BaseModel):
    intervention_id: int
    student_id: UUID
    student_name: str
    student_lrn: str
    grade_level: int | None = None
    level_name: str | None = None
    class_id: int
    class_name: str
    subject_id: int
    subject_name: str
    academic_period_id: int
    academic_period_name: str
    status: str
    source_prediction_id: int
    source_prediction_revision: int
    triggering_predicted_grade: float
    triggering_intervention_level: str
    current_prediction_revision: int
    current_predicted_grade: float | None = None
    current_intervention_level: str | None = None
    candidate_activation_eligible: bool | None = None
    candidate_activation_reason: str | None = None
    resolution_recommended: bool = False
    resolution_recommendation_reason: str | None = None
    resolution_recommendation_detail: str | None = None
    resolution_attribution_code: str | None = None
    can_confirm_resolution: bool = False
    resolution_continued_at: datetime | None = None
    resolution_continued_by_staff_id: str | None = None
    unfinished_remediation_count: int = 0
    has_in_progress_remediation: bool = False
    created_at: datetime
    activated_at: datetime | None = None
    resolved_at: datetime | None = None
    resolution_reason: str | None = None
    diagnosis_summary: dict[str, Any]
    passing_threshold: float | None = None


class TeacherInterventionDetail(TeacherInterventionSummary):
    diagnosis_snapshot: dict[str, Any]
    activated_by_staff_id: str | None = None


class ResolvedReviewer(BaseModel):
    title: str
    introduction: str
    body: str


class ResolvedSupportAttempt(BaseModel):
    submission_id: int
    attempt_count: int
    status: str | None = None
    grade: float | None = None
    submitted_at: str | None = None
    graded_at: str | None = None


class ResolvedSupportActivity(BaseModel):
    assignment_id: int
    title: str
    classwork_type: str
    component: str | None = None
    submission_status: str | None
    grade: float | None
    total_points: float | None
    attempt_count: int = 0
    max_attempts: int | None = None
    is_passed: bool = False
    score_adjustment_cap: float | None = None
    attempt_history: list[ResolvedSupportAttempt] = []
    original_assignment_id: int | None = None
    original_title: str | None = None
    exam_subtype: str | None = None
    original_grade: float | None = None
    effective_grade: float | None = None


class ResolvedPracticeAttempt(BaseModel):
    attempt_id: int
    attempt_number: int
    reading_review_cycle: int = 1
    status: str
    total_score: float
    max_score: float
    score_percentage: float
    passing_threshold_snapshot: float
    is_passed: bool
    started_at: str | None = None
    completed_at: str | None = None


class ResolvedPracticeAssessmentHistory(BaseModel):
    practice_assessment_id: int
    title: str
    status: str
    gatekeeper_policy: str
    passing_percentage: float
    total_questions: int = 0
    total_points: float = 0.0
    attempts_count: int = 0
    submitted_attempts_count: int = 0
    practice_passed: bool = False
    eligible_for_remediation: bool = True
    best_score_percentage: float | None = None
    progression_reason: str | None = None
    attempts: list[ResolvedPracticeAttempt] = []


class ResolutionReviewSummary(BaseModel):
    decision: str | None = None
    resolution_mode: str | None = None
    attribution_code: str | None = None
    attribution_summary: str | None = None
    decided_by_staff_id: str | None = None
    decided_at: str | None = None
    prediction_id: int | None = None
    prediction_revision: int | None = None
    predicted_grade: float | None = None
    previous_predicted_grade: float | None = None
    passing_threshold: float | None = None


class TeacherResolvedInterventionDetail(TeacherInterventionDetail):
    resolution_projection: float | None
    targeted_activities: list[ResolvedSupportActivity]
    practice_assessment: ResolvedPracticeAssessmentHistory | None = None
    resolution_review: ResolutionReviewSummary | None = None
    sent_reviewer: ResolvedReviewer | None


class TeacherInterventionList(BaseModel):
    items: list[TeacherInterventionSummary]
    total: int
