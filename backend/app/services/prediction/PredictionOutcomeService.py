from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.services.grading.PassingThresholdReader import require_subject_passing_threshold
from app.services.grading.PassingThresholdResolver import PassingThresholdContext, PassingThresholdResolution
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionOutcome import PredictionOutcome


EVALUATED = "EVALUATED"
ACTUAL_LOW_RISK = "LOW_RISK"
ACTUAL_HIGH_RISK = "HIGH_RISK"


def _to_decimal(value: Any, field_name: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{field_name} must be numeric.") from exc


def _to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _actual_risk_label(actual_period_grade: Decimal, passing_grade: Decimal) -> str:
    return ACTUAL_LOW_RISK if actual_period_grade >= passing_grade else ACTUAL_HIGH_RISK


def _outcome_result(outcome: PredictionOutcome, predicted_period_grade: Decimal) -> dict[str, Any]:
    return {
        "outcome_id": outcome.outcome_id,
        "prediction_id": outcome.prediction_id,
        "actual_period_grade": _to_float(outcome.actual_period_grade),
        "predicted_period_grade": float(predicted_period_grade),
        "prediction_error": _to_float(outcome.prediction_error),
        "absolute_error": _to_float(outcome.absolute_error),
        "actual_passed": outcome.actual_passed,
        "actual_risk_label": outcome.actual_risk_label,
        "outcome_status": outcome.outcome_status,
        "evaluated_at": outcome.evaluated_at,
    }


def _existing_outcome(db: Session, prediction_id: int) -> PredictionOutcome | None:
    return (
        db.query(PredictionOutcome)
        .filter(PredictionOutcome.prediction_id == prediction_id)
        .order_by(PredictionOutcome.outcome_id.asc())
        .first()
    )


def evaluate_prediction_outcome(
    db: Session,
    prediction_id: int,
    actual_period_grade: float | Decimal,
    commit: bool = True,
) -> dict[str, Any]:
    prediction = db.get(AIPrediction, prediction_id)
    if prediction is None:
        raise LookupError("Prediction not found.")
    if prediction.predicted_period_grade is None:
        raise ValueError("Prediction does not have a predicted_period_grade to evaluate.")

    period = db.get(AcademicPeriod, prediction.target_period_id)
    resolution = require_subject_passing_threshold(
        db, academic_year_id=period.academic_year_id if period else None,
        subject_id=prediction.subject_id)
    return _evaluate_with_policy(
        db, prediction, actual_period_grade, resolution,
        existing_outcome=_existing_outcome(db, prediction_id), commit=commit)


def _evaluate_with_policy(
    db: Session, prediction: AIPrediction, actual_period_grade: float | Decimal,
    resolution: PassingThresholdResolution, *,
    existing_outcome: PredictionOutcome | None, commit: bool,
) -> dict[str, Any]:
    """Reuse one resolved policy across matching predictions; no per-row policy SQL."""
    if prediction.predicted_period_grade is None:
        raise ValueError("Prediction does not have a predicted_period_grade to evaluate.")
    actual_grade = _to_decimal(actual_period_grade, "actual_period_grade")
    threshold = resolution.threshold
    predicted_grade = _to_decimal(prediction.predicted_period_grade, "predicted_period_grade")
    prediction_error = actual_grade - predicted_grade
    absolute_error = abs(prediction_error)
    actual_passed = actual_grade >= threshold
    risk_label = _actual_risk_label(actual_grade, threshold)
    prediction_id = prediction.prediction_id

    outcome = existing_outcome
    if outcome is None:
        outcome = PredictionOutcome(prediction_id=prediction_id)
        db.add(outcome)

    outcome.actual_period_grade = actual_grade
    outcome.actual_risk_status = risk_label
    outcome.prediction_error = prediction_error
    outcome.absolute_error = absolute_error
    outcome.actual_passed = actual_passed
    outcome.actual_risk_label = risk_label
    outcome.outcome_status = EVALUATED
    outcome.evaluated_at = datetime.now(timezone.utc)

    db.flush()
    if commit:
        db.commit()
        db.refresh(outcome)

    return _outcome_result(outcome, predicted_grade)


def _is_period_grade_finalized(period_grade: StudentPeriodGrade) -> bool:
    if hasattr(period_grade, "is_finalized"):
        return bool(getattr(period_grade, "is_finalized"))
    return period_grade.final_period_grade is not None


def _matching_predictions_for_period_grade(
    db: Session,
    period_grade: StudentPeriodGrade,
) -> list[AIPrediction]:
    return (
        db.query(AIPrediction)
        .filter(
            AIPrediction.student_id == period_grade.student_id,
            AIPrediction.class_id == period_grade.class_id,
            AIPrediction.subject_id == period_grade.subject_id,
            AIPrediction.target_period_id == period_grade.academic_period_id,
        )
        .order_by(AIPrediction.prediction_id.asc())
        .all()
    )


def evaluate_outcomes_for_finalized_period_grade(
    db: Session,
    student_period_grade_id: int,
    commit: bool = True,
    *,
    policy_context: PassingThresholdContext | None = None,
) -> dict[str, Any]:
    period_grade = db.get(StudentPeriodGrade, student_period_grade_id)
    if period_grade is None:
        raise LookupError("Student period grade not found.")
    if period_grade.final_period_grade is None:
        return {
            "student_period_grade_id": student_period_grade_id,
            "evaluated_count": 0,
            "skipped_count": 1,
            "reason": "Student period grade does not have final_period_grade.",
            "outcomes": [],
        }
    if not _is_period_grade_finalized(period_grade):
        return {
            "student_period_grade_id": student_period_grade_id,
            "evaluated_count": 0,
            "skipped_count": 1,
            "reason": "Student period grade is not finalized.",
            "outcomes": [],
        }

    period = db.get(AcademicPeriod, period_grade.academic_period_id)
    resolution = require_subject_passing_threshold(
        db, academic_year_id=period.academic_year_id if period else None,
        subject_id=period_grade.subject_id, context=policy_context)

    predictions = _matching_predictions_for_period_grade(db, period_grade)
    if not predictions:
        return {
            "student_period_grade_id": student_period_grade_id,
            "evaluated_count": 0,
            "skipped_count": 1,
            "reason": "No matching predictions found.",
            "outcomes": [],
        }

    # One lookup for the batch, retaining the original first-outcome ordering.
    existing = db.query(PredictionOutcome).filter(
        PredictionOutcome.prediction_id.in_([p.prediction_id for p in predictions])
    ).order_by(PredictionOutcome.outcome_id.asc()).all()
    existing_by_prediction = {}
    for outcome in existing:
        existing_by_prediction.setdefault(outcome.prediction_id, outcome)

    outcomes: list[dict[str, Any]] = []
    skipped_count = 0
    for prediction in predictions:
        try:
            outcomes.append(
                _evaluate_with_policy(
                    db, prediction, period_grade.final_period_grade, resolution,
                    existing_outcome=existing_by_prediction.get(prediction.prediction_id), commit=False,
                )
            )
        except ValueError:
            skipped_count += 1

    if commit:
        db.commit()

    return {
        "student_period_grade_id": student_period_grade_id,
        "evaluated_count": len(outcomes),
        "skipped_count": skipped_count,
        "reason": None if outcomes else "No evaluable matching predictions found.",
        "outcomes": outcomes,
    }
