"""Canonical permissions for prediction features used in Stage 3A."""

from __future__ import annotations

from dataclasses import dataclass


GRADE_MODEL_INPUT = "GRADE_MODEL_INPUT"
RISK_ONLY = "RISK_ONLY"
DISPLAY_ONLY = "DISPLAY_ONLY"
PREDICTION_OUTPUT = "PREDICTION_OUTPUT"
TRAINING_TARGET = "TRAINING_TARGET"


@dataclass(frozen=True)
class FeatureDefinition:
    identifier: str
    allowed_use: str
    unit: str
    scale: str
    teacher_visible: bool
    availability_semantics: str


_GRADE_INPUTS = {
    "grade_level",
    "period_sequence",
    "source_period_grade",
    "written_work_percent",
    "performance_task_percent",
    "quarterly_assessment_percent",
    "assessment_completion_rate",
    "grade_trend_vs_previous_period",
    "has_previous_period",
    "cumulative_period_grade_avg",
}
_RISK_FIELDS = {
    "missing_activity_count",
    "late_submission_count",
    "data_coverage_ratio",
    "behavioral_engagement_score",
    "behavioral_score_cold_start",
    "risk_adjusted_attendance_rate",
}
_PROHIBITED = {
    "predicted_period_grade": PREDICTION_OUTPUT,
    "target_next_period_grade": TRAINING_TARGET,
    "next_period_grade": TRAINING_TARGET,
    "final_period_grade": TRAINING_TARGET,
}
_DISPLAY_FIELDS = {
    "student_id", "student_lrn", "lrn", "learner_name", "first_name",
    "middle_name", "last_name", "full_name", "name", "section_name",
    "academic_year_name", "source_file_name", "source_file", "roster_index",
}
_TRAINING_TARGETS = {
    "at_risk", "final_result", "date_unregistration", "final_grade",
    "prototype_monitoring_target_below_90", "actual_failure_target_below_75",
}


def canonicalize_feature_identifier(identifier: str) -> str:
    return identifier.strip().lower()


def feature_definition(identifier: str) -> FeatureDefinition | None:
    canonical = canonicalize_feature_identifier(identifier)
    if canonical.startswith("subject_"):
        return FeatureDefinition(canonical, GRADE_MODEL_INPUT, "INDICATOR", "ZERO_OR_ONE", False, "AVAILABLE")
    if canonical in _GRADE_INPUTS:
        return FeatureDefinition(canonical, GRADE_MODEL_INPUT, "NUMERIC", "MODEL_NATIVE", False, "REQUIRES_VALIDATED_VALUE")
    if canonical in _RISK_FIELDS:
        return FeatureDefinition(canonical, RISK_ONLY, "NUMERIC", "MODEL_NATIVE", True, "OBSERVED_OR_UNAVAILABLE")
    if canonical in _PROHIBITED:
        return FeatureDefinition(canonical, _PROHIBITED[canonical], "NUMERIC", "MODEL_NATIVE", False, "PROHIBITED")
    if canonical in _DISPLAY_FIELDS:
        return FeatureDefinition(canonical, DISPLAY_ONLY, "TEXT", "N/A", False, "NOT_A_MODEL_OBSERVATION")
    if canonical in _TRAINING_TARGETS:
        return FeatureDefinition(canonical, TRAINING_TARGET, "NUMERIC", "MODEL_NATIVE", False, "TRAINING_ONLY")
    return None


def validate_grade_model_feature_schema(feature_columns: list[str]) -> list[str]:
    canonical_columns: list[str] = []
    seen: set[str] = set()
    for raw in feature_columns:
        canonical = canonicalize_feature_identifier(raw)
        definition = feature_definition(canonical)
        if definition is None:
            raise ValueError(f"Unknown model feature is not registered in the feature catalog: {raw}")
        if definition.allowed_use != GRADE_MODEL_INPUT:
            raise ValueError(f"Model feature is not permitted for grade-model input: {raw}")
        if canonical in seen:
            raise ValueError(f"Model feature aliases collide after canonicalization: {raw}")
        seen.add(canonical)
        canonical_columns.append(canonical)
    return canonical_columns
