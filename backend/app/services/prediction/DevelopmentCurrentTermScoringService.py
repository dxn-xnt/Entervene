from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import pandas as pd


MODEL_NAME = "entervene_current_term_development_rf_v3"
MODELS_DIR = Path(__file__).resolve().parents[3] / "data" / "models"
MODEL_PATH = MODELS_DIR / f"{MODEL_NAME}.joblib"
SCHEMA_PATH = MODELS_DIR / f"{MODEL_NAME}_feature_schema.json"

FORBIDDEN_INPUT_FIELDS = {
    "target_final_period_grade",
    "target_next_period_grade",
    "student_id",
    "student_lrn",
    "student_period_key",
    "raw_student_key",
    "raw_student_name",
}


def load_development_current_term_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def required_feature_columns(schema: dict[str, Any]) -> list[str]:
    return list(schema.get("feature_columns") or schema.get("raw_feature_columns") or [])


def compare_feature_contract(features: dict[str, Any], schema: dict[str, Any] | None = None) -> dict[str, Any]:
    schema = schema or load_development_current_term_schema()
    required = required_feature_columns(schema)
    numeric_fields = set(schema.get("numeric_features", []))
    categorical_fields = list(schema.get("categorical_features", []))
    feature_keys = set(features)
    type_mismatches: list[dict[str, str]] = []

    for field in numeric_fields.intersection(feature_keys):
        try:
            pd.to_numeric(pd.Series([features[field]]), errors="raise")
        except Exception:
            type_mismatches.append({"feature": field, "expected": "numeric"})

    for field in set(categorical_fields).intersection(feature_keys):
        value = features[field]
        if value is None or str(value).strip() == "":
            type_mismatches.append({"feature": field, "expected": "non-empty categorical"})

    return {
        "required_features": required,
        "missing_features": [field for field in required if field not in feature_keys],
        "unexpected_features": [field for field in features if field not in set(required)],
        "categorical_fields": categorical_fields,
        "type_mismatches": type_mismatches,
    }


def prepare_development_current_term_frame(
    features: dict[str, Any],
    schema: dict[str, Any] | None = None,
) -> pd.DataFrame:
    schema = schema or load_development_current_term_schema()
    forbidden = [field for field in features if field in FORBIDDEN_INPUT_FIELDS]
    if forbidden:
        raise ValueError(f"Forbidden leakage fields for development current-term model: {', '.join(forbidden)}")

    contract = compare_feature_contract(features, schema)
    if contract["missing_features"]:
        raise ValueError(f"Missing development current-term features: {', '.join(contract['missing_features'])}")
    if contract["unexpected_features"]:
        raise ValueError(f"Unexpected development current-term features: {', '.join(contract['unexpected_features'])}")
    if contract["type_mismatches"]:
        names = ", ".join(item["feature"] for item in contract["type_mismatches"])
        raise ValueError(f"Invalid development current-term feature types: {names}")

    columns = required_feature_columns(schema)
    frame = pd.DataFrame([{column: features[column] for column in columns}], columns=columns)
    for column in schema.get("numeric_features", []):
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    return frame


def score_development_current_term(features: dict[str, Any]) -> float:
    schema = load_development_current_term_schema()
    frame = prepare_development_current_term_frame(features, schema)
    artifact = joblib.load(MODEL_PATH)
    model = artifact["pipeline"] if isinstance(artifact, dict) and "pipeline" in artifact else artifact
    return float(model.predict(frame)[0])
