from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


ProjectionAssignmentId = Annotated[int, Field(strict=True, gt=0)]


class SubjectGradeProjectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_assignment_ids: list[ProjectionAssignmentId] = Field(default_factory=list, max_length=50)
    score_adjustment_cap: Decimal | None = Field(default=None, ge=0, lt=100)


class ProjectionUnavailableReason(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    assignment_id: int | None = None


class PassingThresholdPolicyRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    academic_year_id: int
    subject_id: int | None = None
    grading_template_id: int | None = None
    source: str
    policy_version: str | None = None
    revision: int | None = None
    captured_at: datetime | None = None


class EligibleTargetGainRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignment_id: int
    title: str
    component: Literal["WRITTEN_WORK", "PERFORMANCE_TASK"]
    original_score: float
    current_effective_score: float
    max_points: float
    cap_percentage: float
    maximum_hypothetical_effective_score: float
    possible_score_gain: float


class TargetProjectionRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignment_id: int
    title: str | None = None
    component: Literal["WRITTEN_WORK", "PERFORMANCE_TASK"] | None = None
    original_score: float | None = None
    current_effective_score: float | None = None
    max_points: float | None = None
    cap_percentage: float | None = None
    maximum_hypothetical_effective_score: float | None = None
    possible_score_gain: float | None = None
    applied: bool
    projected_initial_grade: float | None = None
    projected_subject_grade: float | None = None
    step_subject_grade_improvement: float | None = None
    possible_grade_improvement: float | None = None
    reaches_passing_threshold: bool | None = None
    unavailable_reasons: list[ProjectionUnavailableReason] = Field(default_factory=list)


class AIMidtermTargetEstimateRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignment_id: int
    maximum_hypothetical_effective_score: float
    hypothetical_predicted_term_grade: float
    step_estimated_difference: float
    estimated_difference_from_baseline: float


class AIMidtermWhatIfRead(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())

    status: Literal["AVAILABLE", "UNAVAILABLE"]
    estimate_kind: Literal["AI_MIDTERM_WHAT_IF_ESTIMATE"]
    is_official_grade: Literal[False]
    is_guaranteed: Literal[False]
    model_version_id: int | None = None
    model_name: str | None = None
    prediction_purpose: Literal["CURRENT_TERM_FINAL_GRADE_PROJECTION"]
    evidence_basis: Literal["LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES"]
    baseline_predicted_term_grade: float | None = None
    readiness: dict = Field(default_factory=dict)
    target_estimates: list[AIMidtermTargetEstimateRead] = Field(default_factory=list)
    unavailable_reasons: list[ProjectionUnavailableReason] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class SubjectGradeProjectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["AVAILABLE", "UNAVAILABLE", "FINALIZED"]
    grade_representation: Literal["TRANSMUTED_TERM_GRADE", "FINAL_PERIOD_GRADE"]
    current_initial_grade: float | None = None
    current_subject_grade: float | None = None
    passing_threshold: float | None = None
    passing_threshold_policy: PassingThresholdPolicyRead | None = None
    current_reaches_passing_threshold: bool | None = None
    target_projections: list[TargetProjectionRead] = Field(default_factory=list)
    eligible_target_gains: list[EligibleTargetGainRead] = Field(default_factory=list)
    additional_eligible_targets_have_positive_improvement: bool
    recommended_target_assignment_id: int | None = None
    assumptions: list[str] = Field(default_factory=list)
    unavailable_reasons: list[ProjectionUnavailableReason] = Field(default_factory=list)
    ai_midterm_what_if: AIMidtermWhatIfRead
