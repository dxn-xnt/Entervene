from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai.RiskThreshold import RiskThreshold


INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
LOW_RISK = "LOW_RISK"
NEEDS_MONITORING = "NEEDS_MONITORING"
MODERATE_RISK = "MODERATE_RISK"
HIGH_RISK = "HIGH_RISK"

SUFFICIENT = "SUFFICIENT"
COLD_START = "COLD_START"

RISK_PRIORITY = {
    LOW_RISK: 1,
    NEEDS_MONITORING: 2,
    MODERATE_RISK: 3,
    HIGH_RISK: 4,
    INSUFFICIENT_DATA: 5,
}
RISK_BASE_SCORES = {
    INSUFFICIENT_DATA: 0,
    LOW_RISK: 10,
    NEEDS_MONITORING: 35,
    MODERATE_RISK: 60,
    HIGH_RISK: 85,
}
RECOMMENDED_ACTIONS = {
    INSUFFICIENT_DATA: "Collect more graded evidence before generating a model-assisted risk decision.",
    HIGH_RISK: "Prioritize teacher review and prepare targeted intervention.",
    MODERATE_RISK: "Provide targeted follow-up and monitor the next activities closely.",
    NEEDS_MONITORING: "Continue monitoring and review recent learning activities.",
    LOW_RISK: "Continue normal monitoring.",
}


@dataclass(frozen=True)
class RiskEngineInput:
    predicted_period_grade: float | None
    source_period_grade: float | None = None
    grade_trend_vs_previous_period: float | None = None
    assessment_completion_rate: float | None = None
    missing_activity_count: int | None = None
    late_submission_count: int | None = None
    data_coverage_ratio: float | None = None
    has_previous_period: bool | None = None


@dataclass(frozen=True)
class RiskEngineResult:
    risk_level: str
    risk_score: float
    data_status: str
    reasons: list[str]
    recommended_action: str
    triggered_rules: list[str]


@dataclass(frozen=True)
class ActiveRiskThreshold:
    threshold_name: str
    condition_type: str
    condition_value: float
    risk_level: str


def clamp_score(value: float) -> float:
    return max(0.0, min(100.0, value))


def _value_or_zero(value: int | float | None) -> int | float:
    return 0 if value is None else value


def load_active_thresholds(db: Session | None) -> list[ActiveRiskThreshold]:
    if db is None:
        return []
    rows = (
        db.query(RiskThreshold)
        .filter(RiskThreshold.is_active == True)
        .order_by(RiskThreshold.threshold_id)
        .all()
    )
    return [
        ActiveRiskThreshold(
            threshold_name=row.threshold_name,
            condition_type=row.condition_type,
            condition_value=float(row.condition_value or Decimal("0")),
            risk_level=row.risk_level,
        )
        for row in rows
    ]


def _add_trigger(
    triggers: list[tuple[str, str, str]],
    risk_level: str,
    rule_name: str,
    reason: str,
) -> None:
    triggers.append((risk_level, rule_name, reason))


def evaluate_default_rules(risk_input: RiskEngineInput) -> list[tuple[str, str, str]]:
    triggers: list[tuple[str, str, str]] = []
    predicted = risk_input.predicted_period_grade
    source = risk_input.source_period_grade
    trend = risk_input.grade_trend_vs_previous_period
    completion = risk_input.assessment_completion_rate
    coverage = risk_input.data_coverage_ratio
    missing_count = _value_or_zero(risk_input.missing_activity_count)
    late_count = _value_or_zero(risk_input.late_submission_count)

    if predicted is None:
        _add_trigger(triggers, INSUFFICIENT_DATA, "missing_predicted_period_grade", "Predicted next-period grade is missing.")
    if completion is None:
        _add_trigger(triggers, INSUFFICIENT_DATA, "missing_assessment_completion_rate", "Assessment completion rate is missing.")
    if coverage is None:
        _add_trigger(triggers, INSUFFICIENT_DATA, "missing_data_coverage_ratio", "Data coverage ratio is missing.")
    if coverage is not None and coverage < 0.50:
        _add_trigger(triggers, INSUFFICIENT_DATA, "data_coverage_below_50", "Data coverage is below 50%.")
    if completion is not None and completion < 0.50:
        _add_trigger(triggers, INSUFFICIENT_DATA, "assessment_completion_below_50", "Assessment completion rate is below 50%.")

    if predicted is not None and predicted < 75:
        _add_trigger(triggers, HIGH_RISK, "predicted_grade_below_75", "Predicted next-period grade is below 75.")
    if source is not None and source < 75:
        _add_trigger(triggers, HIGH_RISK, "source_grade_below_75", "Current period grade is below 75.")
    if predicted is not None and trend is not None and predicted < 80 and trend <= -5:
        _add_trigger(triggers, HIGH_RISK, "predicted_below_80_with_decline", "Predicted grade is below 80 with an observed decline of 5 points or more.")
    if predicted is not None and completion is not None and completion < 0.70 and predicted < 82:
        _add_trigger(triggers, HIGH_RISK, "low_completion_with_predicted_below_82", "Assessment completion rate is below 70% while predicted grade is below 82.")
    if predicted is not None and missing_count >= 3 and predicted < 85:
        _add_trigger(triggers, HIGH_RISK, "three_missing_activities_with_predicted_below_85", "Missing activity count is 3 or more while predicted grade is below 85.")

    if predicted is not None and 75 <= predicted < 82:
        _add_trigger(triggers, MODERATE_RISK, "predicted_grade_75_to_81", "Predicted next-period grade is below 82.")
    if trend is not None and trend <= -7:
        _add_trigger(triggers, MODERATE_RISK, "trend_declined_7_or_more", "Grade trend declined by 7 points or more.")
    if completion is not None and completion < 0.75:
        _add_trigger(triggers, MODERATE_RISK, "assessment_completion_below_75", "Assessment completion rate is below 75%.")
    if missing_count >= 2:
        _add_trigger(triggers, MODERATE_RISK, "two_or_more_missing_activities", "Missing activity count is 2 or more.")
    if late_count >= 3:
        _add_trigger(triggers, MODERATE_RISK, "three_or_more_late_submissions", "Late submission count is 3 or more.")

    if predicted is not None and 82 <= predicted < 88:
        _add_trigger(triggers, NEEDS_MONITORING, "predicted_grade_82_to_87", "Predicted next-period grade is between 82 and 88, which may require monitoring.")
    if trend is not None and trend <= -3:
        _add_trigger(triggers, NEEDS_MONITORING, "trend_declined_3_or_more", "Grade trend shows an observed decline of 3 points or more.")
    if completion is not None and completion < 0.90:
        _add_trigger(triggers, NEEDS_MONITORING, "assessment_completion_below_90", "Assessment completion rate is below 90%.")
    if missing_count == 1:
        _add_trigger(triggers, NEEDS_MONITORING, "one_missing_activity", "Missing activity count is 1.")
    if late_count >= 1:
        _add_trigger(triggers, NEEDS_MONITORING, "one_or_more_late_submissions", "Late submission count is 1 or more.")
    if risk_input.has_previous_period is False:
        _add_trigger(triggers, NEEDS_MONITORING, "no_previous_period", "No previous period record is available, so continued monitoring is recommended.")

    severe_decline = trend is not None and trend <= -7
    if (
        predicted is not None
        and completion is not None
        and coverage is not None
        and predicted >= 88
        and completion >= 0.90
        and coverage >= 0.75
        and not severe_decline
        and missing_count == 0
    ):
        _add_trigger(triggers, LOW_RISK, "low_risk_grade_completion_and_coverage", "Predicted grade, completion rate, and data coverage are currently strong.")

    return triggers


def choose_risk_level(triggers: list[tuple[str, str, str]]) -> str:
    if not triggers:
        return NEEDS_MONITORING
    return max((trigger[0] for trigger in triggers), key=lambda level: RISK_PRIORITY[level])


def compute_risk_score(risk_level: str, risk_input: RiskEngineInput, trigger_count: int) -> float:
    score = float(RISK_BASE_SCORES[risk_level])
    if risk_level == INSUFFICIENT_DATA:
        return score

    predicted = risk_input.predicted_period_grade
    trend = risk_input.grade_trend_vs_previous_period
    completion = risk_input.assessment_completion_rate
    missing_count = _value_or_zero(risk_input.missing_activity_count)
    late_count = _value_or_zero(risk_input.late_submission_count)

    if predicted is not None and predicted < 88:
        score += min(20.0, max(0.0, 88 - predicted) * 1.5)
    if trend is not None and trend < 0:
        score += min(10.0, abs(trend))
    if completion is not None and completion < 0.90:
        score += min(10.0, (0.90 - completion) * 25)
    score += min(8.0, float(missing_count) * 2.5)
    score += min(5.0, float(late_count) * 1.5)
    score += min(5.0, max(0, trigger_count - 1) * 1.5)

    if risk_level == LOW_RISK:
        score = min(score, 24.0)
    elif risk_level == NEEDS_MONITORING:
        score = max(25.0, min(score, 49.0))
    elif risk_level == MODERATE_RISK:
        score = max(50.0, min(score, 74.0))
    elif risk_level == HIGH_RISK:
        score = max(75.0, min(score, 100.0))
    return clamp_score(round(score, 2))


def evaluate_risk(risk_input: RiskEngineInput, db: Session | None = None) -> RiskEngineResult:
    # Thresholds are loaded for future override/configuration use. Default rules
    # remain authoritative in this task and work when no DB rows exist.
    load_active_thresholds(db)
    triggers = evaluate_default_rules(risk_input)
    risk_level = choose_risk_level(triggers)
    risk_score = compute_risk_score(risk_level, risk_input, len(triggers))
    data_status = INSUFFICIENT_DATA if risk_level == INSUFFICIENT_DATA else SUFFICIENT

    return RiskEngineResult(
        risk_level=risk_level,
        risk_score=risk_score,
        data_status=data_status,
        reasons=[trigger[2] for trigger in triggers],
        recommended_action=RECOMMENDED_ACTIONS[risk_level],
        triggered_rules=[trigger[1] for trigger in triggers],
    )
