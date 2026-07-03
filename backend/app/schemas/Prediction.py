from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME


class PredictionFeatureInput(BaseModel):
    features: dict[str, Any] = Field(default_factory=dict)


class PredictionPreviewRequest(PredictionFeatureInput):
    model_name: str = DEFAULT_MODEL_NAME


class PredictionPersistRequest(PredictionFeatureInput):
    student_id: UUID
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int
    model_name: str = DEFAULT_MODEL_NAME
    replace_existing: bool = False


class PredictionPreviewResponse(BaseModel):
    model_version_id: int
    model_name: str
    model_type: str
    algorithm: str
    predicted_period_grade: float | None
    risk_level: str
    risk_score: float
    data_status: str
    reasons: list[str] = Field(default_factory=list)
    recommended_action: str | None = None
    triggered_rules: list[str] = Field(default_factory=list)
    feature_columns_used: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PredictionPersistResponse(BaseModel):
    prediction_id: int
    model_version_id: int | None = None
    student_id: UUID
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int
    predicted_period_grade: float | None
    risk_level: str
    risk_score: float | None
    data_status: str
    reasons: list[str] = Field(default_factory=list)
    recommended_action: str | None = None
    triggered_rules: list[str] = Field(default_factory=list)
    feature_rows_created: int
    duplicate: bool = False


class PredictionSummaryResponse(BaseModel):
    prediction_id: int
    student_id: UUID
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int
    model_version_id: int | None = None
    predicted_period_grade: float | None
    risk_level: str
    risk_score: float | None
    data_status: str
    generated_at: datetime | None = None


class PredictionListResponse(BaseModel):
    items: list[PredictionSummaryResponse] = Field(default_factory=list)
    total: int
    limit: int
    offset: int


class PredictionFeatureResponse(BaseModel):
    feature_id: int
    feature_name: str
    feature_value: float | None = None
    feature_contribution: float | None = None
    direction: str
    feature_rank: int | None = None
    explanation_method: str


class PredictionFeatureListResponse(BaseModel):
    prediction_id: int
    features: list[PredictionFeatureResponse] = Field(default_factory=list)


class PredictionModelVersionRead(BaseModel):
    model_version_id: int
    model_name: str
    model_type: str
    algorithm: str
    is_active: bool


class PredictionOutcomeRead(BaseModel):
    outcome_id: int
    actual_period_grade: float | None = None
    prediction_error: float | None = None
    absolute_error: float | None = None
    actual_passed: bool | None = None
    actual_risk_label: str | None = None
    outcome_status: str | None = None
    evaluated_at: datetime | None = None


class PredictionCauseRead(BaseModel):
    code: str
    label: str
    value: str
    severity: str
    explanation: str


class PredictionRecommendedActionRead(BaseModel):
    action_code: str
    action_type: str
    title: str
    description: str
    priority: str
    source: str


class PredictionOutcomeEvaluateRequest(BaseModel):
    actual_period_grade: float
    passing_grade: float = 75.0


class PredictionOutcomeResponse(BaseModel):
    outcome_id: int
    prediction_id: int
    actual_period_grade: float
    predicted_period_grade: float
    prediction_error: float
    absolute_error: float
    actual_passed: bool
    actual_risk_label: str
    outcome_status: str
    evaluated_at: datetime


TeacherRiskReviewDecision = Literal[
    "CONFIRMED_RISK",
    "DISMISSED_RISK",
    "NEEDS_MORE_DATA",
    "INTERVENTION_ASSIGNED",
    "ESCALATED",
]


class TeacherRiskReviewRequest(BaseModel):
    decision: TeacherRiskReviewDecision
    teacher_notes: str | None = None


class TeacherRiskReviewResponse(BaseModel):
    review_id: int
    prediction_id: int
    staff_id: str
    decision: str
    teacher_notes: str | None = None
    reviewed_at: datetime


class PredictionTeacherReviewListResponse(BaseModel):
    prediction_id: int
    teacher_reviews: list[TeacherRiskReviewResponse] = Field(default_factory=list)
    current_user_review: TeacherRiskReviewResponse | None = None


class PredictionDetailResponse(BaseModel):
    prediction_id: int
    student_id: UUID
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int
    predicted_period_grade: float | None = None
    risk_score: float | None = None
    risk_level: str
    data_status: str
    generated_at: datetime | None = None
    model_version: PredictionModelVersionRead | None = None
    features: list[PredictionFeatureResponse] = Field(default_factory=list)
    causes: list[PredictionCauseRead] = Field(default_factory=list)
    recommended_actions: list[PredictionRecommendedActionRead] = Field(default_factory=list)
    outcome: PredictionOutcomeRead | None = None
    teacher_reviews: list[TeacherRiskReviewResponse] = Field(default_factory=list)
    current_user_review: TeacherRiskReviewResponse | None = None


class ModelPerformanceByVersionItem(BaseModel):
    model_version_id: int | None = None
    model_name: str | None = None
    total_evaluated_predictions: int
    mae: float | None = None
    rmse: float | None = None
    mean_prediction_error: float | None = None


class ModelPerformanceSummaryResponse(BaseModel):
    total_evaluated_predictions: int
    mae: float | None = None
    rmse: float | None = None
    mean_prediction_error: float | None = None
    min_absolute_error: float | None = None
    max_absolute_error: float | None = None
    actual_risk_label_counts: dict[str, int] = Field(default_factory=dict)
    predicted_risk_level_counts: dict[str, int] = Field(default_factory=dict)
    by_model_version: list[ModelPerformanceByVersionItem] = Field(default_factory=list)


class PredictionBuildFeaturesRequest(BaseModel):
    student_id: UUID
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int | None = None


class PredictionEvidenceSummary(BaseModel):
    expected_assessment_count: int = 0
    recorded_assessment_count: int = 0
    submitted_assessment_count: int = 0
    missing_assessment_count: int = 0
    late_submission_count: int = 0
    components_present: list[str] = Field(default_factory=list)
    components_missing: list[str] = Field(default_factory=list)


class PredictionBuiltFeaturesResponse(BaseModel):
    ready: bool
    readiness_level: str
    prediction_mode: str
    features: dict[str, Any] = Field(default_factory=dict)
    evidence_summary: PredictionEvidenceSummary
    warnings: list[str] = Field(default_factory=list)
    readiness_reasons: list[str] = Field(default_factory=list)


class PredictionFromRecordsPreviewRequest(PredictionBuildFeaturesRequest):
    model_name: str = DEFAULT_MODEL_NAME
    allow_early_estimate: bool = True


class PredictionFromRecordsPersistRequest(PredictionFromRecordsPreviewRequest):
    target_period_id: int
    replace_existing: bool = False


class PredictionFromRecordsResponse(BaseModel):
    ready: bool
    readiness_level: str
    prediction_mode: str
    predicted_period_grade: float | None = None
    risk_level: str
    risk_score: float | None = None
    data_status: str
    reasons: list[str] = Field(default_factory=list)
    recommended_action: str | None = None
    triggered_rules: list[str] = Field(default_factory=list)
    features: dict[str, Any] = Field(default_factory=dict)
    evidence_summary: PredictionEvidenceSummary
    warnings: list[str] = Field(default_factory=list)
    model_version_id: int | None = None
    model_name: str | None = None
    model_type: str | None = None
    algorithm: str | None = None
    feature_columns_used: list[str] = Field(default_factory=list)
    prediction_id: int | None = None
    student_id: UUID | None = None
    class_id: int | None = None
    subject_id: int | None = None
    source_period_id: int | None = None
    target_period_id: int | None = None
    feature_rows_created: int | None = None
    duplicate: bool | None = None
