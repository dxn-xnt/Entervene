from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion
from app.services.RiskEngine import RiskEngineInput, evaluate_risk


DEFAULT_MODEL_NAME = "entervene_next_period_grade_rf"
DEFAULT_MODEL_TYPE = "REGRESSOR"
RUNTIME_RISK_FIELDS = {
    "missing_activity_count",
    "late_submission_count",
    "data_coverage_ratio",
}
IDENTITY_OR_LEAKAGE_TERMS = (
    "student_id",
    "student_lrn",
    "lrn",
    "learner_name",
    "first_name",
    "middle_name",
    "last_name",
    "full_name",
    "name",
    "section_name",
    "academic_year_name",
    "source_file_name",
    "source_file",
    "roster_index",
    "target_next_period_grade",
    "next_period_grade",
    "at_risk",
    "final_result",
    "date_unregistration",
    "final_grade",
    "final_period_grade",
    "prototype_monitoring_target_below_90",
    "actual_failure_target_below_75",
)


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[2]


def get_active_model_version(
    db: Session,
    model_name: str = DEFAULT_MODEL_NAME,
    model_type: str = DEFAULT_MODEL_TYPE,
) -> AIModelVersion:
    version = (
        db.query(AIModelVersion)
        .filter(
            AIModelVersion.model_name == model_name,
            AIModelVersion.model_type == model_type,
            AIModelVersion.is_active == True,
        )
        .one_or_none()
    )
    if version is None:
        raise LookupError(f"No active {model_type} model version found for model_name={model_name}.")
    return version


def resolve_artifact_path(artifact_path: str, base_dir: Path | None = None) -> Path:
    path = Path(artifact_path)
    if path.is_absolute():
        resolved = path
    else:
        resolved = (base_dir or backend_dir()) / path
    return resolved.resolve()


def load_model_artifact(artifact_path: str, base_dir: Path | None = None) -> Any:
    resolved = resolve_artifact_path(artifact_path, base_dir=base_dir)
    if not resolved.exists() or not resolved.is_file():
        raise FileNotFoundError(f"Model artifact file not found: {resolved}")
    artifact = joblib.load(resolved)
    if isinstance(artifact, dict) and "model" in artifact:
        return artifact["model"]
    return artifact


def load_feature_schema_from_model_version(model_version: AIModelVersion) -> dict[str, Any]:
    schema = model_version.feature_schema_json
    if not isinstance(schema, dict):
        raise ValueError("Active model version does not contain a valid feature_schema_json object.")
    missing = {
        "feature_columns",
        "target_column",
        "excluded_columns",
        "column_mappings",
        "required_runtime_columns",
    } - set(schema)
    if missing:
        raise ValueError(f"Feature schema is missing required fields: {', '.join(sorted(missing))}")
    return schema


def _is_identity_or_leakage_field(field_name: str) -> bool:
    lower = field_name.lower()
    return any(term in lower for term in IDENTITY_OR_LEAKAGE_TERMS)


def _mapped_input(input_data: dict[str, Any], column_mappings: dict[str, str]) -> dict[str, Any]:
    mapped = dict(input_data)
    for source, target in column_mappings.items():
        if source in mapped and target not in mapped:
            mapped[target] = mapped[source]
    return mapped


def prepare_feature_row(input_data: dict[str, Any], feature_schema: dict[str, Any]) -> tuple[pd.DataFrame, list[str]]:
    feature_columns = list(feature_schema["feature_columns"])
    column_mappings = dict(feature_schema.get("column_mappings") or {})
    mapped = _mapped_input(input_data, column_mappings)
    warnings: list[str] = []
    row: dict[str, Any] = {}
    has_previous = mapped.get("has_previous_period")

    for feature in feature_columns:
        if _is_identity_or_leakage_field(feature):
            raise ValueError(f"Unsafe identity/leakage field is present in feature schema: {feature}")
        if feature in mapped:
            row[feature] = mapped[feature]
        elif feature.startswith("subject_"):
            row[feature] = 0
            warnings.append(f"Missing subject one-hot feature defaulted to 0: {feature}")
        elif feature == "has_previous_period":
            row[feature] = 0
            warnings.append("Missing has_previous_period defaulted to 0.")
        elif feature == "grade_trend_vs_previous_period" and str(has_previous).lower() in {"0", "false", "none"}:
            row[feature] = 0
            warnings.append("Missing grade_trend_vs_previous_period defaulted to 0 because has_previous_period is false.")
        else:
            raise ValueError(f"Missing required model feature: {feature}")

    for field_name in input_data:
        if field_name in RUNTIME_RISK_FIELDS:
            continue
        if _is_identity_or_leakage_field(field_name):
            warnings.append(f"Ignored identity/leakage field for model scoring: {field_name}")

    frame = pd.DataFrame([row], columns=feature_columns)
    non_numeric = []
    for column in feature_columns:
        converted = pd.to_numeric(frame[column], errors="coerce")
        if converted.isna().any():
            non_numeric.append(column)
        frame[column] = converted
    if non_numeric:
        raise ValueError(f"Non-numeric model feature values: {', '.join(sorted(non_numeric))}")
    return frame, warnings


def predict_next_period_grade(model: Any, prepared_feature_row: pd.DataFrame) -> float:
    prediction = model.predict(prepared_feature_row)
    return float(prediction[0])


def _risk_value(input_data: dict[str, Any], prepared_feature_row: pd.DataFrame, field_name: str) -> Any:
    if field_name in input_data:
        return input_data[field_name]
    if field_name in prepared_feature_row.columns:
        return prepared_feature_row.iloc[0][field_name]
    return None


def _to_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes"}:
        return True
    if text in {"0", "false", "no"}:
        return False
    return None


def _to_int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    return int(float(value))


def _to_float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def score_student_prediction(
    db: Session,
    input_data: dict[str, Any],
    model_name: str = DEFAULT_MODEL_NAME,
) -> dict[str, Any]:
    model_version = get_active_model_version(db, model_name=model_name)
    feature_schema = load_feature_schema_from_model_version(model_version)
    model = load_model_artifact(model_version.artifact_path)
    prepared_row, warnings = prepare_feature_row(input_data, feature_schema)
    predicted_grade = predict_next_period_grade(model, prepared_row)

    risk_result = evaluate_risk(
        RiskEngineInput(
            predicted_period_grade=predicted_grade,
            source_period_grade=_to_float_or_none(_risk_value(input_data, prepared_row, "source_period_grade")),
            grade_trend_vs_previous_period=_to_float_or_none(_risk_value(input_data, prepared_row, "grade_trend_vs_previous_period")),
            assessment_completion_rate=_to_float_or_none(_risk_value(input_data, prepared_row, "assessment_completion_rate")),
            missing_activity_count=_to_int_or_none(input_data.get("missing_activity_count")),
            late_submission_count=_to_int_or_none(input_data.get("late_submission_count")),
            data_coverage_ratio=_to_float_or_none(input_data.get("data_coverage_ratio")),
            has_previous_period=_to_bool(_risk_value(input_data, prepared_row, "has_previous_period")),
        ),
        db=db,
    )

    return {
        "model_version_id": model_version.model_version_id,
        "model_name": model_version.model_name,
        "model_type": model_version.model_type,
        "algorithm": model_version.algorithm,
        "predicted_period_grade": round(predicted_grade, 2),
        "risk_level": risk_result.risk_level,
        "risk_score": risk_result.risk_score,
        "data_status": risk_result.data_status,
        "reasons": risk_result.reasons,
        "recommended_action": risk_result.recommended_action,
        "triggered_rules": risk_result.triggered_rules,
        "feature_columns_used": list(feature_schema["feature_columns"]),
        "warnings": warnings,
    }
