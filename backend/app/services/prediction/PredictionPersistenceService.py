from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.people.Student import Student
from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME, score_student_prediction


REQUIRED_IDENTIFIER_FIELDS = {
    "student_id",
    "class_id",
    "subject_id",
    "source_period_id",
    "target_period_id",
}
RUNTIME_RISK_EVIDENCE_FIELDS = {
    "missing_activity_count",
    "late_submission_count",
    "data_coverage_ratio",
}
SUMMARY_EVIDENCE_FIELDS = {
    "predicted_period_grade",
    "source_period_grade",
    "assessment_completion_rate",
    "grade_trend_vs_previous_period",
}
IDENTITY_OR_PRIVATE_TERMS = (
    "name",
    "lrn",
    "student_id",
    "source_file",
    "file",
    "roster_index",
)


class DuplicatePredictionError(ValueError):
    pass


def validate_required_identifiers(prediction_request: dict[str, Any]) -> None:
    missing = sorted(field for field in REQUIRED_IDENTIFIER_FIELDS if field not in prediction_request)
    if missing:
        raise ValueError(f"Prediction request is missing required identifiers: {', '.join(missing)}")
    if "features" not in prediction_request or not isinstance(prediction_request["features"], dict):
        raise ValueError("Prediction request must include a features object.")


def parse_student_uuid(value: Any) -> UUID:
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except ValueError as exc:
        raise ValueError("student_id must be a valid UUID.") from exc


def validate_references(db: Session, prediction_request: dict[str, Any]) -> dict[str, Any]:
    student_id = parse_student_uuid(prediction_request["student_id"])
    class_id = int(prediction_request["class_id"])
    subject_id = int(prediction_request["subject_id"])
    source_period_id = int(prediction_request["source_period_id"])
    target_period_id = int(prediction_request["target_period_id"])

    if db.get(Student, student_id) is None:
        raise ValueError("Referenced student was not found.")
    if db.get(Class, class_id) is None:
        raise ValueError("Referenced class was not found.")
    if db.get(Subject, subject_id) is None:
        raise ValueError("Referenced subject was not found.")
    if db.get(AcademicPeriod, source_period_id) is None:
        raise ValueError("Referenced source academic period was not found.")
    if db.get(AcademicPeriod, target_period_id) is None:
        raise ValueError("Referenced target academic period was not found.")

    return {
        "student_id": student_id,
        "class_id": class_id,
        "subject_id": subject_id,
        "source_period_id": source_period_id,
        "target_period_id": target_period_id,
    }


def find_existing_prediction(
    db: Session,
    identifiers: dict[str, Any],
    model_version_id: int,
) -> AIPrediction | None:
    return (
        db.query(AIPrediction)
        .filter(
            AIPrediction.student_id == identifiers["student_id"],
            AIPrediction.class_id == identifiers["class_id"],
            AIPrediction.subject_id == identifiers["subject_id"],
            AIPrediction.source_period_id == identifiers["source_period_id"],
            AIPrediction.target_period_id == identifiers["target_period_id"],
            AIPrediction.model_version_id == model_version_id,
        )
        .one_or_none()
    )


def _is_private_or_identity_feature(feature_name: str) -> bool:
    lower = feature_name.lower()
    return any(term in lower for term in IDENTITY_OR_PRIVATE_TERMS)


def _to_decimal_or_none(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _feature_value_from_inputs(
    feature_name: str,
    features: dict[str, Any],
    scoring_result: dict[str, Any],
) -> Any:
    if feature_name in scoring_result:
        return scoring_result[feature_name]
    if feature_name in features:
        return features[feature_name]
    mappings = {
        "periodical_assessment_percent": "quarterly_assessment_percent",
    }
    source_name = mappings.get(feature_name)
    if source_name and source_name in features:
        return features[source_name]
    return None


def build_prediction_feature_rows(
    prediction: AIPrediction,
    features: dict[str, Any],
    scoring_result: dict[str, Any],
) -> list[AIPredictionFeature]:
    feature_names: list[str] = []
    for feature_name in scoring_result.get("feature_columns_used", []):
        if feature_name not in feature_names:
            feature_names.append(feature_name)
    for feature_name in RUNTIME_RISK_EVIDENCE_FIELDS:
        if feature_name in features and feature_name not in feature_names:
            feature_names.append(feature_name)
    for feature_name in SUMMARY_EVIDENCE_FIELDS:
        if (feature_name in features or feature_name in scoring_result) and feature_name not in feature_names:
            feature_names.append(feature_name)

    rows: list[AIPredictionFeature] = []
    rank = 1
    for feature_name in feature_names:
        if _is_private_or_identity_feature(feature_name):
            continue
        value = _feature_value_from_inputs(feature_name, features, scoring_result)
        explanation_method = "RULE" if feature_name in RUNTIME_RISK_EVIDENCE_FIELDS or feature_name in SUMMARY_EVIDENCE_FIELDS else "OTHER"
        rows.append(
            AIPredictionFeature(
                prediction=prediction,
                feature_name=feature_name,
                feature_value=_to_decimal_or_none(value),
                feature_contribution=None,
                direction="NEUTRAL",
                feature_rank=rank,
                explanation_method=explanation_method,
            )
        )
        rank += 1
    return rows


def _prediction_result(
    prediction: AIPrediction,
    scoring_result: dict[str, Any],
    feature_rows_created: int,
    duplicate: bool = False,
) -> dict[str, Any]:
    return {
        "prediction_id": prediction.prediction_id,
        "model_version_id": prediction.model_version_id,
        "student_id": str(prediction.student_id),
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
        "predicted_period_grade": float(prediction.predicted_period_grade) if prediction.predicted_period_grade is not None else None,
        "risk_level": prediction.risk_level,
        "risk_score": float(prediction.risk_score) if prediction.risk_score is not None else None,
        "data_status": prediction.data_status,
        "reasons": scoring_result.get("reasons", []),
        "recommended_action": scoring_result.get("recommended_action"),
        "triggered_rules": scoring_result.get("triggered_rules", []),
        "feature_rows_created": feature_rows_created,
        "duplicate": duplicate,
    }


def score_and_persist_prediction(
    db: Session,
    prediction_request: dict[str, Any],
    model_name: str = DEFAULT_MODEL_NAME,
    commit: bool = True,
    replace_existing: bool = False,
) -> dict[str, Any]:
    try:
        validate_required_identifiers(prediction_request)
        identifiers = validate_references(db, prediction_request)
        features = prediction_request["features"]
        scoring_result = score_student_prediction(db, features, model_name=model_name)
        model_version_id = int(scoring_result["model_version_id"])
        existing = find_existing_prediction(db, identifiers, model_version_id)

        if existing is not None and not replace_existing:
            return _prediction_result(existing, scoring_result, len(existing.features), duplicate=True)

        prediction = existing or AIPrediction(**identifiers, model_version_id=model_version_id)
        prediction.predicted_period_grade = _to_decimal_or_none(scoring_result.get("predicted_period_grade"))
        prediction.risk_score = _to_decimal_or_none(scoring_result.get("risk_score"))
        prediction.risk_level = scoring_result["risk_level"]
        prediction.data_status = scoring_result["data_status"]
        prediction.model_version_id = model_version_id

        if existing is None:
            db.add(prediction)
            db.flush()
        else:
            db.query(AIPredictionFeature).filter(
                AIPredictionFeature.prediction_id == existing.prediction_id
            ).delete(synchronize_session=False)
            db.flush()

        feature_rows = build_prediction_feature_rows(prediction, features, scoring_result)
        db.add_all(feature_rows)
        db.flush()

        if commit:
            db.commit()
            db.refresh(prediction)
        return _prediction_result(prediction, scoring_result, len(feature_rows), duplicate=False)
    except Exception:
        db.rollback()
        raise
