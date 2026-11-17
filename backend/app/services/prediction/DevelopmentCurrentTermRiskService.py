from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction_service


INTERVENTION_NOT_ASSESSED = "INTERVENTION_NOT_ASSESSED"
INTERVENTION_BASIS = "RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE"
MODEL_SCOPE_NOTE = "This is a grade-projection regression model, not a validated failure classifier."
SUPPORTING_CONTEXT_ROLE = "SUPPORTING_CONTEXT_ONLY"

CURRENT_TERM_INTERVENTION_BANDS = (
    {"level": "HIGH_RISK", "label": "High Risk", "minimum": None, "maximum_exclusive": 75.0},
    {"level": "MODERATE_RISK", "label": "Moderate Risk", "minimum": 75.0, "maximum_exclusive": 85.0},
    {"level": "NEEDS_MONITORING", "label": "Needs Monitoring", "minimum": 85.0, "maximum_exclusive": 90.0},
    {"level": "LOW_RISK", "label": "Low Risk", "minimum": 90.0, "maximum_exclusive": None},
)
INTERVENTION_REASON_BY_LEVEL = {
    "HIGH_RISK": "PROJECTED_GRADE_BELOW_75",
    "MODERATE_RISK": "PROJECTED_GRADE_75_TO_BELOW_85",
    "NEEDS_MONITORING": "PROJECTED_GRADE_85_TO_BELOW_90",
    "LOW_RISK": "PROJECTED_GRADE_90_OR_ABOVE",
}


def current_term_intervention_policy() -> list[dict[str, Any]]:
    """Return the grade bands used by the current-term intervention mapper."""
    return [dict(band) for band in CURRENT_TERM_INTERVENTION_BANDS]


def _intervention_level_for_grade(grade: float) -> str:
    for band in CURRENT_TERM_INTERVENTION_BANDS:
        minimum = band["minimum"]
        maximum = band["maximum_exclusive"]
        if (minimum is None or grade >= minimum) and (maximum is None or grade < maximum):
            return str(band["level"])
    raise ValueError("Projected grade is outside the configured intervention bands.")

SUPPORTING_SIGNAL_FIELDS = (
    "behavioral_engagement_score",
    "attendance_rate",
    "on_time_submission_rate",
    "missing_activity_count",
    "assessment_completion_rate",
    "data_coverage_ratio",
    "ww_percent",
    "pt_percent",
    "qa_percent",
)


def assess_development_current_term_intervention(
    prediction_result: Mapping[str, Any],
    *,
    supporting_context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    status = prediction_result["status"]
    raw_grade = prediction_result.get("projected_final_term_grade")
    reason_codes = list(prediction_result.get("readiness_reason_codes") or [])
    context = {
        "role": SUPPORTING_CONTEXT_ROLE,
        "signals": {
            field: supporting_context[field]
            for field in SUPPORTING_SIGNAL_FIELDS
            if supporting_context is not None and field in supporting_context
        },
    }

    result = {
        "prediction_status": status,
        "projected_final_term_grade": None,
        "intervention_level": INTERVENTION_NOT_ASSESSED,
        "intervention_basis": None,
        "triggered_reasons": [],
        "upstream_reason_codes": reason_codes,
        "supporting_context": context,
        "prediction_purpose": prediction_result.get("prediction_purpose"),
        "model_name": prediction_result.get("model_name"),
        "development_status": prediction_result.get("model_development_status"),
        "model_scope_note": MODEL_SCOPE_NOTE,
        "intervention_explanation": None,
    }

    if status != prediction_service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE:
        return result

    if raw_grade is None or isinstance(raw_grade, bool):
        result["upstream_reason_codes"].append("PROJECTED_FINAL_TERM_GRADE_MISSING")
        return result

    try:
        grade = float(raw_grade)
    except (TypeError, ValueError, OverflowError):
        result["upstream_reason_codes"].append("INVALID_PROJECTED_FINAL_TERM_GRADE")
        return result
    if not math.isfinite(grade) or not 0 <= grade <= 100:
        result["upstream_reason_codes"].append("INVALID_PROJECTED_FINAL_TERM_GRADE")
        return result

    level = _intervention_level_for_grade(grade)
    reason = INTERVENTION_REASON_BY_LEVEL[level]

    result.update(
        projected_final_term_grade=grade,
        intervention_level=level,
        intervention_basis=INTERVENTION_BASIS,
        triggered_reasons=[reason],
        intervention_explanation=(
            "The Random Forest projected the student's final term grade. "
            "A separate rule-based layer mapped that projected grade to an intervention priority."
        ),
    )
    return result


def predict_and_assess_development_current_term(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
    target_period_id: int | None = None,
    *,
    cutoff_at: datetime | None = None,
    supporting_context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    prediction = prediction_service.predict_development_current_term(
        db,
        student_id,
        class_id,
        subject_id,
        source_period_id,
        target_period_id,
        cutoff_at=cutoff_at,
    )
    return assess_development_current_term_intervention(
        prediction,
        supporting_context=supporting_context,
    )
