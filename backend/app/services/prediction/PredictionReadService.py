from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.ai.TeacherRiskReview import TeacherRiskReview
from app.services.prediction.PredictionExplanationService import (
    build_prediction_causes,
    build_recommended_actions,
)


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _model_version(version: AIModelVersion | None) -> dict[str, Any] | None:
    if version is None:
        return None
    return {
        "model_version_id": version.model_version_id,
        "model_name": version.model_name,
        "model_type": version.model_type,
        "algorithm": version.algorithm,
        "is_active": bool(version.is_active),
    }


def _feature(row: AIPredictionFeature) -> dict[str, Any]:
    return {
        "feature_id": row.feature_id,
        "feature_name": row.feature_name,
        "feature_value": _to_float(row.feature_value),
        "feature_contribution": _to_float(row.feature_contribution),
        "direction": row.direction,
        "feature_rank": row.feature_rank,
        "explanation_method": row.explanation_method,
    }


def _outcome(row: PredictionOutcome | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "outcome_id": row.outcome_id,
        "actual_period_grade": _to_float(row.actual_period_grade),
        "prediction_error": _to_float(row.prediction_error),
        "absolute_error": _to_float(row.absolute_error),
        "actual_passed": row.actual_passed,
        "actual_risk_label": row.actual_risk_label,
        "outcome_status": row.outcome_status,
        "evaluated_at": row.evaluated_at,
    }


def _review(row: TeacherRiskReview) -> dict[str, Any]:
    return {
        "review_id": row.review_id,
        "prediction_id": row.prediction_id,
        "staff_id": row.reviewed_by_staff_id,
        "decision": row.review_decision,
        "teacher_notes": row.teacher_notes,
        "reviewed_at": row.reviewed_at,
    }


def _load_prediction(db: Session, prediction_id: int) -> AIPrediction:
    prediction = db.get(AIPrediction, prediction_id)
    if prediction is None:
        raise LookupError("Prediction not found.")
    return prediction


def _features(db: Session, prediction_id: int) -> list[AIPredictionFeature]:
    return (
        db.query(AIPredictionFeature)
        .filter(AIPredictionFeature.prediction_id == prediction_id)
        .order_by(AIPredictionFeature.feature_rank.asc(), AIPredictionFeature.feature_id.asc())
        .all()
    )


def _latest_outcome(db: Session, prediction_id: int) -> PredictionOutcome | None:
    return (
        db.query(PredictionOutcome)
        .filter(PredictionOutcome.prediction_id == prediction_id)
        .order_by(PredictionOutcome.evaluated_at.desc().nullslast(), PredictionOutcome.outcome_id.desc())
        .first()
    )


def _reviews(db: Session, prediction_id: int, staff_id: str | None = None) -> list[TeacherRiskReview]:
    query = db.query(TeacherRiskReview).filter(TeacherRiskReview.prediction_id == prediction_id)
    if staff_id is not None:
        query = query.filter(TeacherRiskReview.reviewed_by_staff_id == staff_id)
    return query.order_by(TeacherRiskReview.reviewed_at.desc(), TeacherRiskReview.review_id.desc()).all()


def get_teacher_reviews_for_prediction(
    db: Session,
    prediction_id: int,
    staff_id: str | None = None,
    current_user_only: bool = False,
) -> dict[str, Any]:
    _load_prediction(db, prediction_id)
    review_rows = _reviews(db, prediction_id, staff_id if current_user_only else None)
    current_user_review = None
    if staff_id is not None:
        current_user_review = next((_review(row) for row in _reviews(db, prediction_id, staff_id)), None)
    return {
        "prediction_id": prediction_id,
        "teacher_reviews": [_review(row) for row in review_rows],
        "current_user_review": current_user_review,
    }


def get_prediction_detail(
    db: Session,
    prediction_id: int,
    staff_id: str | None = None,
) -> dict[str, Any]:
    prediction = _load_prediction(db, prediction_id)
    feature_rows = _features(db, prediction_id)
    causes = build_prediction_causes(prediction, feature_rows)
    review_rows = _reviews(db, prediction_id)
    current_user_review = None
    if staff_id is not None:
        current_user_review = next((_review(row) for row in _reviews(db, prediction_id, staff_id)), None)
    return {
        "prediction_id": prediction.prediction_id,
        "student_id": prediction.student_id,
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
        "predicted_period_grade": _to_float(prediction.predicted_period_grade),
        "risk_score": _to_float(prediction.risk_score),
        "risk_level": prediction.risk_level,
        "data_status": prediction.data_status,
        "generated_at": prediction.generated_at,
        "model_version": _model_version(prediction.model_version),
        "features": [_feature(row) for row in feature_rows],
        "causes": causes,
        "recommended_actions": build_recommended_actions(prediction, causes),
        "outcome": _outcome(_latest_outcome(db, prediction_id)),
        "teacher_reviews": [_review(row) for row in review_rows],
        "current_user_review": current_user_review,
    }
