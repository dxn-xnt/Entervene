from __future__ import annotations

from typing import Any

from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _feature_map(features: list[AIPredictionFeature]) -> dict[str, float]:
    mapped: dict[str, float] = {}
    for feature in features:
        value = _to_float(feature.feature_value)
        if value is not None:
            mapped[feature.feature_name.lower()] = value
    return mapped


def _percent(value: float) -> str:
    if 0 <= value <= 1:
        value = value * 100
    return f"{round(value, 1)}%"


def _add_cause(
    causes: list[dict[str, Any]],
    code: str,
    label: str,
    value: str,
    severity: str,
    explanation: str,
) -> None:
    if not any(cause["code"] == code for cause in causes):
        causes.append({
            "code": code,
            "label": label,
            "value": value,
            "severity": severity,
            "explanation": explanation,
        })


def _feature_value(features: dict[str, float], names: tuple[str, ...]) -> tuple[str, float] | None:
    for name in names:
        if name in features:
            return name, features[name]
    return None


def build_prediction_causes(
    prediction: AIPrediction,
    features: list[AIPredictionFeature],
) -> list[dict[str, Any]]:
    feature_values = _feature_map(features)
    causes: list[dict[str, Any]] = []

    if prediction.risk_level == "INSUFFICIENT_DATA" or prediction.data_status == "INSUFFICIENT_DATA":
        _add_cause(
            causes,
            "INSUFFICIENT_DATA",
            "Insufficient data",
            prediction.data_status or prediction.risk_level,
            "HIGH",
            "More assessment or submission data is needed before making a confident risk decision.",
        )

    completion = _feature_value(feature_values, ("completion_rate", "submission_rate"))
    if completion and completion[1] < 0.75:
        _add_cause(
            causes,
            "LOW_COMPLETION_RATE",
            "Low completion rate",
            _percent(completion[1]),
            "HIGH" if completion[1] < 0.60 else "MODERATE",
            "The student completed fewer classworks than expected.",
        )

    missing = _feature_value(feature_values, ("missing_count", "missing_classworks"))
    if missing and missing[1] > 0:
        _add_cause(
            causes,
            "MISSING_WORK",
            "Missing classwork",
            str(int(missing[1])),
            "HIGH" if missing[1] >= 3 else "MODERATE",
            "The student has missing classworks that may affect mastery.",
        )

    averages = (
        ("assessment_average", "LOW_ASSESSMENT_AVERAGE", "Low assessment average"),
        ("quiz_average", "LOW_QUIZ_AVERAGE", "Low quiz average"),
        ("recent_average", "LOW_RECENT_AVERAGE", "Low recent average"),
    )
    for feature_name, code, label in averages:
        value = feature_values.get(feature_name)
        if value is not None and value < 75:
            _add_cause(
                causes,
                code,
                label,
                _percent(value) if value <= 1 else str(round(value, 1)),
                "HIGH",
                "Recent performance is below the expected passing threshold.",
            )

    trend = _feature_value(feature_values, ("trend", "grade_trend"))
    if trend and trend[1] < 0:
        _add_cause(
            causes,
            "DECLINING_TREND",
            "Declining grade trend",
            str(round(trend[1], 2)),
            "HIGH" if trend[1] <= -5 else "MODERATE",
            "The student's recent grade trend is moving downward.",
        )

    coverage = feature_values.get("data_coverage")
    if coverage is not None and coverage < 0.50:
        _add_cause(
            causes,
            "LOW_DATA_COVERAGE",
            "Limited data coverage",
            _percent(coverage),
            "HIGH",
            "The prediction has limited academic evidence available.",
        )

    risk_score = _to_float(prediction.risk_score)
    if risk_score is not None and risk_score >= 75:
        _add_cause(
            causes,
            "HIGH_RISK_SCORE",
            "High risk score",
            str(round(risk_score, 1)),
            "HIGH",
            "The model assigned a high overall risk score.",
        )

    predicted_grade = _to_float(prediction.predicted_period_grade)
    if predicted_grade is not None and predicted_grade < 75:
        _add_cause(
            causes,
            "PREDICTED_BELOW_PASSING",
            "Predicted grade below passing",
            str(round(predicted_grade, 2)),
            "HIGH",
            "The predicted period grade is below the passing threshold.",
        )

    return causes


def build_recommended_actions(
    prediction: AIPrediction,
    causes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    risk_level = prediction.risk_level
    cause_codes = {cause["code"] for cause in causes}

    if risk_level == "INSUFFICIENT_DATA":
        return [
            {
                "action_code": "COLLECT_MORE_DATA",
                "action_type": "TEACHER_ACTION",
                "title": "Collect more assessment and submission data",
                "description": "Add or encode more student evidence before relying on this prediction.",
                "priority": "HIGH",
                "source": "SYSTEM_DERIVED",
            }
        ]
    if risk_level == "HIGH_RISK":
        return [
            {
                "action_code": "ASSIGN_REMEDIAL_ACTIVITY",
                "action_type": "TEACHER_ACTION",
                "title": "Assign a remedial activity",
                "description": "Give a short activity focused on the weak area and review the student's result.",
                "priority": "HIGH",
                "source": "SYSTEM_DERIVED",
            },
            {
                "action_code": "REVIEW_MISSING_CLASSWORKS",
                "action_type": "TEACHER_ACTION",
                "title": "Review missing classworks",
                "description": "Check missing or late classworks and decide which tasks should be completed first.",
                "priority": "HIGH" if "MISSING_WORK" in cause_codes else "MODERATE",
                "source": "SYSTEM_DERIVED",
            },
            {
                "action_code": "SCHEDULE_TEACHER_FOLLOW_UP",
                "action_type": "TEACHER_ACTION",
                "title": "Schedule teacher follow-up",
                "description": "Meet with the student to clarify blockers and agree on the next learning steps.",
                "priority": "HIGH",
                "source": "SYSTEM_DERIVED",
            },
        ]
    if risk_level == "MODERATE_RISK":
        return [
            {
                "action_code": "GIVE_TARGETED_PRACTICE",
                "action_type": "TEACHER_ACTION",
                "title": "Give targeted practice",
                "description": "Assign practice focused on the skill or topic connected to the student's weak evidence.",
                "priority": "MODERATE",
                "source": "SYSTEM_DERIVED",
            },
            {
                "action_code": "MONITOR_NEXT_SUBMISSIONS",
                "action_type": "TEACHER_ACTION",
                "title": "Monitor next submissions",
                "description": "Watch the student's next activities to confirm whether risk is increasing or improving.",
                "priority": "MODERATE",
                "source": "SYSTEM_DERIVED",
            },
        ]
    if risk_level == "NEEDS_MONITORING":
        return [
            {
                "action_code": "MONITOR_COMPLETION_AND_QUIZ_TREND",
                "action_type": "TEACHER_ACTION",
                "title": "Monitor completion and quiz trend",
                "description": "Keep checking completion and quiz performance before escalating intervention.",
                "priority": "LOW",
                "source": "SYSTEM_DERIVED",
            },
            {
                "action_code": "SEND_PENDING_WORK_REMINDER",
                "action_type": "TEACHER_ACTION",
                "title": "Send reminder for pending work",
                "description": "Remind the student about pending or upcoming work.",
                "priority": "LOW",
                "source": "SYSTEM_DERIVED",
            },
        ]
    if risk_level == "LOW_RISK":
        return [
            {
                "action_code": "CONTINUE_NORMAL_MONITORING",
                "action_type": "TEACHER_ACTION",
                "title": "Continue normal monitoring",
                "description": "Continue regular classroom monitoring without additional intervention.",
                "priority": "LOW",
                "source": "SYSTEM_DERIVED",
            }
        ]
    return [
        {
            "action_code": "COLLECT_MORE_DATA",
            "action_type": "TEACHER_ACTION",
            "title": "Collect more assessment and submission data",
            "description": "Add or encode more student evidence before relying on this prediction.",
            "priority": "HIGH",
            "source": "SYSTEM_DERIVED",
        }
    ]
