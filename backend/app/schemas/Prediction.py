from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.services.ModelScoringService import DEFAULT_MODEL_NAME


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
