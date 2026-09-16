from __future__ import annotations

from collections import Counter
from math import sqrt
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionOutcome import PredictionOutcome


EVALUATED = "EVALUATED"


def _rounded(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 4)


def _metrics(rows: list[tuple[PredictionOutcome, AIPrediction, AIModelVersion | None]]) -> dict[str, Any]:
    evaluated_errors = [
        float(outcome.prediction_error)
        for outcome, _, _ in rows
        if outcome.prediction_error is not None
    ]
    absolute_errors = [
        float(outcome.absolute_error)
        for outcome, _, _ in rows
        if outcome.absolute_error is not None
    ]

    if not evaluated_errors or not absolute_errors:
        return {
            "total_evaluated_predictions": len(rows),
            "mae": None,
            "rmse": None,
            "mean_prediction_error": None,
            "min_absolute_error": None,
            "max_absolute_error": None,
        }

    return {
        "total_evaluated_predictions": len(rows),
        "mae": _rounded(sum(absolute_errors) / len(absolute_errors)),
        "rmse": _rounded(sqrt(sum(error**2 for error in evaluated_errors) / len(evaluated_errors))),
        "mean_prediction_error": _rounded(sum(evaluated_errors) / len(evaluated_errors)),
        "min_absolute_error": _rounded(min(absolute_errors)),
        "max_absolute_error": _rounded(max(absolute_errors)),
    }


def _counts(values: list[str | None]) -> dict[str, int]:
    return dict(sorted(Counter(value for value in values if value).items()))


def _base_rows(
    db: Session,
    model_version_id: int | None,
    class_id: int | None,
    subject_id: int | None,
    academic_period_id: int | None,
) -> list[tuple[PredictionOutcome, AIPrediction, AIModelVersion | None]]:
    query = (
        db.query(PredictionOutcome, AIPrediction, AIModelVersion)
        .join(AIPrediction, AIPrediction.prediction_id == PredictionOutcome.prediction_id)
        .outerjoin(AIModelVersion, AIModelVersion.model_version_id == AIPrediction.model_version_id)
        .filter(PredictionOutcome.outcome_status == EVALUATED)
    )
    if model_version_id is not None:
        query = query.filter(AIPrediction.model_version_id == model_version_id)
    if class_id is not None:
        query = query.filter(AIPrediction.class_id == class_id)
    if subject_id is not None:
        query = query.filter(AIPrediction.subject_id == subject_id)
    if academic_period_id is not None:
        query = query.filter(AIPrediction.target_period_id == academic_period_id)
    return query.all()


def _by_model_version(rows: list[tuple[PredictionOutcome, AIPrediction, AIModelVersion | None]]) -> list[dict[str, Any]]:
    grouped: dict[int | None, list[tuple[PredictionOutcome, AIPrediction, AIModelVersion | None]]] = {}
    for row in rows:
        _, prediction, _ = row
        grouped.setdefault(prediction.model_version_id, []).append(row)

    items: list[dict[str, Any]] = []
    for model_version_id, group in sorted(grouped.items(), key=lambda item: (-1 if item[0] is None else item[0])):
        model_version = next((version for _, _, version in group if version is not None), None)
        metrics = _metrics(group)
        items.append(
            {
                "model_version_id": model_version_id,
                "model_name": model_version.model_name if model_version else None,
                "total_evaluated_predictions": metrics["total_evaluated_predictions"],
                "mae": metrics["mae"],
                "rmse": metrics["rmse"],
                "mean_prediction_error": metrics["mean_prediction_error"],
            }
        )
    return items


def get_model_performance_summary(
    db: Session,
    model_version_id: int | None = None,
    class_id: int | None = None,
    subject_id: int | None = None,
    academic_period_id: int | None = None,
) -> dict[str, Any]:
    rows = _base_rows(db, model_version_id, class_id, subject_id, academic_period_id)
    metrics = _metrics(rows)
    return {
        **metrics,
        "actual_risk_label_counts": _counts([outcome.actual_risk_label for outcome, _, _ in rows]),
        "predicted_risk_level_counts": _counts([prediction.risk_level for _, prediction, _ in rows]),
        "by_model_version": _by_model_version(rows),
    }
