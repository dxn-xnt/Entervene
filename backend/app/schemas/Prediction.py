from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME
from app.services.prediction.TeacherAssignmentResolver import TeacherStatusLabel


class PredictionIntegrityMetadata(BaseModel):
    revision: int | None = None
    model_purpose: str | None = None
    prediction_purpose: str | None = None
    validation_status: str | None = None
    purpose_label: str | None = None
    revision_origin: str | None = None


class PredictionFeatureInput(BaseModel):
    features: dict[str, Any] = Field(default_factory=dict)


class PredictionPreviewRequest(PredictionFeatureInput):
    model_config = ConfigDict(protected_namespaces=())
    model_name: str = DEFAULT_MODEL_NAME


class PredictionPersistRequest(PredictionFeatureInput):
    model_config = ConfigDict(protected_namespaces=())
    student_id: UUID
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int
    model_name: str = DEFAULT_MODEL_NAME
    replace_existing: bool = False
    generation_request_id: str | None = Field(default=None, max_length=100)


class PredictionPreviewResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    model_version_id: int
    model_name: str
    model_type: str
    algorithm: str
    predicted_period_grade: float | None
    risk_level: str | None
    risk_score: float | None
    data_status: str | None
    risk_assessment_status: str | None = None
    reasons: list[str] = Field(default_factory=list)
    recommended_action: str | None = None
    triggered_rules: list[str] = Field(default_factory=list)
    feature_columns_used: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PredictionPersistResponse(PredictionIntegrityMetadata):
    model_config = ConfigDict(protected_namespaces=())
    prediction_id: int
    model_version_id: int | None = None
    student_id: UUID
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int
    predicted_period_grade: float | None
    risk_level: str | None
    risk_score: float | None
    data_status: str | None
    risk_assessment_status: str | None = None
    reasons: list[str] = Field(default_factory=list)
    recommended_action: str | None = None
    triggered_rules: list[str] = Field(default_factory=list)
    feature_rows_created: int
    duplicate: bool = False


class PredictionSummaryResponse(PredictionIntegrityMetadata):
    model_config = ConfigDict(protected_namespaces=())
    prediction_id: int
    student_id: UUID
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int
    model_version_id: int | None = None
    predicted_period_grade: float | None
    risk_level: str | None
    risk_score: float | None
    data_status: str | None
    risk_assessment_status: str | None = None
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
    model_config = ConfigDict(protected_namespaces=())
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
    value: str | None = None
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
    # passing_grade is intentionally removed — resolved server-side from
    # SubjectGroup.passing_threshold via AIPrediction.subject_id.


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


class PredictionDetailResponse(PredictionIntegrityMetadata):
    model_config = ConfigDict(protected_namespaces=())
    prediction_id: int
    student_id: UUID
    student_name: str | None = None
    student_lrn: str | None = None
    grade_level: int | None = None
    level_name: str | None = None
    class_id: int
    class_name: str | None = None
    subject_id: int
    subject_name: str | None = None
    subject_codename: str | None = None
    teacher_name: str | None = None
    teacher_staff_id: str | None = None
    teacher_status_label: TeacherStatusLabel = TeacherStatusLabel.UNASSIGNED
    is_substitute: bool = False
    substitution_id: int | None = None
    substitute_start_date: date | None = None
    substitute_end_date: date | None = None
    original_teacher_name: str | None = None
    source_period_id: int
    target_period_id: int
    predicted_period_grade: float | None = None
    risk_score: float | None = None
    risk_level: str | None
    data_status: str | None
    risk_assessment_status: str | None = None
    generated_at: datetime | None = None
    model_version: PredictionModelVersionRead | None = None
    features: list[PredictionFeatureResponse] = Field(default_factory=list)
    prediction_status: str = "LEGACY"
    model_execution: str = "UNKNOWN"
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    interpretations: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    causes: list[PredictionCauseRead] = Field(default_factory=list)
    recommended_actions: list[PredictionRecommendedActionRead] = Field(default_factory=list)
    outcome: PredictionOutcomeRead | None = None
    teacher_reviews: list[TeacherRiskReviewResponse] = Field(default_factory=list)
    current_user_review: TeacherRiskReviewResponse | None = None


class ModelPerformanceByVersionItem(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
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
    model_config = ConfigDict(extra="allow")
    expected_assessment_count: int = 0
    recorded_assessment_count: int = 0
    submitted_assessment_count: int = 0
    missing_assessment_count: int = 0
    late_submission_count: int | None = 0
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
    model_config = ConfigDict(protected_namespaces=())
    model_name: str = DEFAULT_MODEL_NAME
    allow_early_estimate: bool = True


class PredictionFromRecordsPersistRequest(PredictionFromRecordsPreviewRequest):
    target_period_id: int
    replace_existing: bool = False
    generation_request_id: str | None = Field(default=None, max_length=100)


class PredictionFromRecordsResponse(PredictionIntegrityMetadata):
    generation_status: str | None = None
    evidence_snapshot: dict[str, Any] | None = None
    evidence_cutoff_at: datetime | None = None
    generated_at: datetime | None = None
    model_config = ConfigDict(protected_namespaces=())
    ready: bool
    readiness_level: str
    prediction_mode: str
    predicted_period_grade: float | None = None
    risk_level: str | None
    risk_score: float | None = None
    data_status: str | None
    risk_assessment_status: str | None = None
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


class PredictionRefreshRequest(BaseModel):
    generation_request_id: str | None = Field(default=None, max_length=100)


class PredictionStatusLatestRead(PredictionIntegrityMetadata):
    prediction_id: int
    revision: int
    is_latest: bool = True
    model_version_id: int | None = None
    source_period_id: int
    target_period_id: int
    generated_at: datetime | None = None
    evidence_cutoff_at: datetime | None = None
    predicted_period_grade: float | None = None
    risk_level: str | None = None
    risk_score: float | None = None
    data_status: str | None = None
    risk_assessment_status: str | None = None
    generation_reason: str | None = None


class PredictionReadinessStatus(BaseModel):
    ready: bool
    readiness_level: str
    reasons: list[str] = Field(default_factory=list)
    coverage_ratio: float | None = None
    completion_rate: float | None = None
    coverage_state: str | None = None
    completion_state: str | None = None
    source_grade_provenance: str | None = None
    graded_count: int | None = None
    expected_count: int | None = None


class PredictionEligibilityStatus(BaseModel):
    eligible: bool
    status: str
    reason: str | None = None
    relationship: dict[str, Any] | None = None


class PredictionFreshnessStatus(BaseModel):
    status: str
    comparable: bool
    reason: str | None = None
    saved_fingerprint: str | None = None
    current_fingerprint: str | None = None


class PredictionRosterStatusItem(BaseModel):
    student_id: UUID
    student_name: str
    student_lrn: str
    class_id: int
    subject_id: int
    source_period_id: int
    target_period_id: int | None = None
    source_period_label: str | None = None
    target_period_label: str | None = None
    status: str
    message: str
    evidence_readiness: PredictionReadinessStatus
    forecast_eligibility: PredictionEligibilityStatus
    forecast_freshness: PredictionFreshnessStatus
    latest_prediction: PredictionStatusLatestRead | None = None


class PredictionRosterStatusResponse(BaseModel):
    class_id: int
    class_name: str
    subject_id: int
    subject_name: str
    source_period_id: int
    target_period_id: int | None = None
    source_period_label: str | None = None
    target_period_label: str | None = None
    items: list[PredictionRosterStatusItem] = Field(default_factory=list)
    total: int
    status_counts: dict[str, int] = Field(default_factory=dict)


class PredictionHistoryItem(PredictionStatusLatestRead):
    source_period_label: str | None = None
    target_period_label: str | None = None
    forecast_freshness: PredictionFreshnessStatus


class PredictionHistoryResponse(BaseModel):
    scope: dict[str, Any]
    items: list[PredictionHistoryItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Single-Prediction Status Schemas (Discriminated by model_purpose)
# ---------------------------------------------------------------------------

class CurrentEvidenceReadinessRead(BaseModel):
    level: str
    ready: bool
    reasons: list[str] = Field(default_factory=list)


class CurrentProjectionFreshnessRead(BaseModel):
    status: str
    saved_fingerprint: str | None = None
    current_fingerprint: str | None = None
    reasons: list[str] = Field(default_factory=list)


class CurrentModelCurrencyRead(BaseModel):
    status: str
    persisted_model_version_id: int | None = None
    active_model_version_id: int | None = None
    persisted_model_name: str | None = None
    active_model_name: str | None = None


class CurrentRefreshEligibilityRead(BaseModel):
    status: str
    eligible: bool
    reasons: list[str] = Field(default_factory=list)


class CurrentPeriodPredictionStatusRead(BaseModel):
    evidence_readiness: CurrentEvidenceReadinessRead
    projection_freshness: CurrentProjectionFreshnessRead
    model_currency: CurrentModelCurrencyRead
    refresh_eligibility: CurrentRefreshEligibilityRead
    requested_prediction: dict[str, Any] | None = None
    latest_prediction: dict[str, Any] | None = None
    domain_warnings: list[dict[str, Any]] = Field(default_factory=list)


class NextPeriodPredictionStatusRead(BaseModel):
    status: str
    message: str
    evidence_readiness: PredictionReadinessStatus
    forecast_eligibility: PredictionEligibilityStatus
    forecast_freshness: PredictionFreshnessStatus
    requested_prediction: PredictionStatusLatestRead | None = None
    latest_prediction: PredictionStatusLatestRead | None = None


class CurrentPredictionStatusEnvelope(BaseModel):
    prediction_id: int
    model_purpose: Literal["CURRENT_PERIOD_FINAL_GRADE_PROJECTION"]
    status: CurrentPeriodPredictionStatusRead


class NextPredictionStatusEnvelope(BaseModel):
    prediction_id: int
    model_purpose: Literal["NEXT_PERIOD_BASELINE_FORECAST"]
    status: NextPeriodPredictionStatusRead


PredictionStatusEnvelopeResponse = Annotated[
    Union[CurrentPredictionStatusEnvelope, NextPredictionStatusEnvelope],
    Field(discriminator="model_purpose"),
]



# ---------------------------------------------------------------------------
# Dashboard schemas
# ---------------------------------------------------------------------------


class DashboardPredictionItem(PredictionIntegrityMetadata):
    prediction_id: int
    student_id: UUID
    student_name: str
    student_lrn: str
    class_name: str
    grade_level: int | None = None
    subject_name: str
    subject_codename: str | None = None
    term_label: str
    term_number: int
    teacher_name: str | None = None
    teacher_staff_id: str | None = None
    teacher_status_label: TeacherStatusLabel = TeacherStatusLabel.UNASSIGNED
    predicted_period_grade: float | None = None
    risk_level: str | None
    risk_score: float | None = None
    data_status: str | None
    risk_assessment_status: str | None = None
    generated_at: datetime | None = None


class RiskSummary(BaseModel):
    HIGH_RISK: int = 0
    MODERATE_RISK: int = 0
    NEEDS_MONITORING: int = 0
    LOW_RISK: int = 0
    INSUFFICIENT_DATA: int = 0
    total: int = 0


class DashboardAtRiskResponse(BaseModel):
    items: list[DashboardPredictionItem] = Field(default_factory=list)
    risk_summary: RiskSummary
    total: int
    limit: int
    offset: int


class DashboardGradeOption(BaseModel):
    grade_level: int
    level_name: str


class DashboardClassOption(BaseModel):
    class_id: int
    section_name: str
    grade_level: int | None = None


class DashboardSubjectOption(BaseModel):
    subject_id: int
    subject_name: str
    subject_codename: str | None = None
    period_index: int | None = None


class DashboardTermOption(BaseModel):
    term_number: int
    term_label: str
    academic_period_id: int

class DashboardFilterOptionsResponse(BaseModel):
    grades: list[DashboardGradeOption] = Field(default_factory=list)
    classes: list[DashboardClassOption] = Field(default_factory=list)
    subjects: list[DashboardSubjectOption] = Field(default_factory=list)
    terms: list[DashboardTermOption] = Field(default_factory=list)


class DashboardSectionSummaryItem(BaseModel):
    class_id: int
    section_name: str
    grade_level: int
    total_students: int
    at_risk_count: int
    high_risk_count: int
    moderate_risk_count: int


class DashboardGradeGroupSummary(BaseModel):
    grade_level: int
    level_name: str
    total_students: int
    at_risk_count: int
    sections: list[DashboardSectionSummaryItem] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Task 6C: Dual-Purpose Roster Schemas
# ---------------------------------------------------------------------------

LegacyPredictionRosterResponse = PredictionRosterStatusResponse


class PeriodOutcomeRead(BaseModel):
    status: str  # "FINALIZED" | "IN_PROGRESS"
    actual_grade: float | None = None


class RosterTeacherRead(BaseModel):
    staff_id: str
    teacher_name: str | None = None
    full_name: str | None = None
    email: str | None = None


class RosterClassContext(BaseModel):
    class_id: int
    class_name: str
    subject_id: int
    subject_name: str
    academic_period_id: int
    period_label: str
    academic_year_id: int
    next_period_status: str | None = None  # "AVAILABLE" | "NO_NEXT_PERIOD"
    teacher: RosterTeacherRead | None = None


class StudentSummaryRead(BaseModel):
    student_id: UUID
    student_name: str
    student_lrn: str


class BaselineForecastSummaryRead(BaseModel):
    purpose: Literal["NEXT_PERIOD_BASELINE_FORECAST"] = "NEXT_PERIOD_BASELINE_FORECAST"
    status: str
    message: str | None = None
    source_period_id: int | None = None
    target_period_id: int | None = None
    source_period_label: str | None = None
    target_period_label: str | None = None
    predicted_grade: float | None = None
    risk_level: str | None = None
    risk_score: float | None = None
    data_status: str | None = None
    risk_assessment_status: str | None = None
    evidence_readiness: PredictionReadinessStatus | None = None
    forecast_eligibility: PredictionEligibilityStatus | None = None
    forecast_freshness: PredictionFreshnessStatus | None = None
    latest_prediction_id: int | None = None
    model_version: dict[str, Any] | None = None
    revision: int | None = None
    generated_at: datetime | None = None


class CurrentProjectionSummaryRead(BaseModel):
    purpose: Literal["CURRENT_PERIOD_FINAL_GRADE_PROJECTION"] = "CURRENT_PERIOD_FINAL_GRADE_PROJECTION"
    source_period_id: int | None = None
    target_period_id: int | None = None
    source_period_label: str | None = None
    target_period_label: str | None = None
    predicted_grade: float | None = None
    risk_level: str | None = None
    risk_score: float | None = None
    data_status: str | None = None
    risk_assessment_status: str | None = None
    evidence_readiness: CurrentEvidenceReadinessRead | None = None
    projection_freshness: CurrentProjectionFreshnessRead | None = None
    model_currency: CurrentModelCurrencyRead | None = None
    refresh_eligibility: CurrentRefreshEligibilityRead | None = None
    domain_warnings: list[dict[str, Any]] = Field(default_factory=list)
    latest_prediction_id: int | None = None
    model_version: dict[str, Any] | None = None
    revision: int | None = None
    generated_at: datetime | None = None


class DualPurposeRosterStudentItem(BaseModel):
    student: StudentSummaryRead
    period_outcome: PeriodOutcomeRead
    baseline_forecast: BaselineForecastSummaryRead
    current_projection: CurrentProjectionSummaryRead
    primary_display: Literal["CURRENT_PROJECTION", "BASELINE_FORECAST", "NONE"]


class DualPurposeRosterResponse(BaseModel):
    class_context: RosterClassContext
    students: list[DualPurposeRosterStudentItem] = Field(default_factory=list)
    total: int

    @model_validator(mode="before")
    @classmethod
    def _remap_roster_to_students(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "students" not in data and "roster" in data:
                data = dict(data)
                data["students"] = data.pop("roster")
            elif "roster" in data and "students" in data:
                data = dict(data)
                data.pop("roster", None)
        return data
