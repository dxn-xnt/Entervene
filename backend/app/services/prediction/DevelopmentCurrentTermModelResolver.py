"""Resolve and validate the single selected development current-term model."""

from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction_service
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import (
    CORRECTED_MODEL_NAME,
    MODEL_NAMES,
    artifact_path,
    require_development_model_name,
    selected_development_model_name,
)


PREDICTION_FEATURE_DISABLED = "PREDICTION_FEATURE_DISABLED"
SELECTED_MODEL_NOT_REFRESH_ELIGIBLE = "SELECTED_MODEL_NOT_REFRESH_ELIGIBLE"
MODEL_REGISTRY_ENTRY_NOT_FOUND = "MODEL_REGISTRY_ENTRY_NOT_FOUND"
DUPLICATE_MODEL_REGISTRY_ENTRY = "DUPLICATE_MODEL_REGISTRY_ENTRY"
MODEL_CONTRACT_INVALID = "MODEL_CONTRACT_INVALID"


class SelectedModelResolutionError(ValueError):
    def __init__(self, reason_code: str, message: str):
        super().__init__(message)
        self.reason_code = reason_code


def _digest_json(value: dict) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def require_current_term_model(
    db: Session,
    model_version_id: int | None,
) -> AIModelVersion:
    """Validate a referenced development or fully approved production model."""
    if model_version_id is None:
        raise ValueError("A model_version_id is required for current-term persistence.")
    version = db.get(AIModelVersion, model_version_id)
    if version is None:
        raise ValueError("The current-term model version was not found.")
    valid_development = (
        version.lifecycle_status == "DEVELOPMENT"
        and not version.is_active
        and not version.production_validated
        and not version.independent_three_term_validation
    )
    valid_production = (
        version.lifecycle_status == "PRODUCTION"
        and version.is_active
        and version.production_validated
        and version.independent_three_term_validation
    )
    if (
        version.model_name not in MODEL_NAMES
        or version.model_type != "REGRESSOR"
        or version.model_purpose != ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
        or version.target_column != "target_final_period_grade"
        or not (valid_development or valid_production)
    ):
        raise ValueError("The model version does not match an approved current-term lifecycle contract.")

    metadata = version.registry_metadata_json or {}
    if (
        set(metadata.get("supported_subjects") or []) != prediction_service.SUPPORTED_SUBJECTS
        or set(metadata.get("supported_weight_patterns") or []) != prediction_service.SUPPORTED_WEIGHT_PATTERNS
        or metadata.get("period_semantics") != "SOURCE_EQUALS_TARGET_SAME_TERM"
    ):
        raise ValueError("The model version's effective current-term domain does not match the scorer contract.")
    require_development_model_name(version.model_name)
    schema = scorer.load_development_current_term_schema(version.model_name)
    if version.feature_schema_json != schema or metadata.get("feature_schema_sha256") != _digest_json(schema):
        raise ValueError("The model version's feature schema does not match the V3 scorer.")
    artifact = (Path(__file__).resolve().parents[3] / version.artifact_path).resolve()
    if artifact != artifact_path(version.model_name).resolve() or not artifact.is_file():
        raise ValueError("The model version's artifact path does not match the V3 scorer.")
    if metadata.get("artifact_sha256") != sha256(artifact.read_bytes()).hexdigest():
        raise ValueError("The model version's artifact hash does not match the V3 scorer.")
    return version


def resolve_selected_development_model(db: Session) -> AIModelVersion:
    """Fail closed unless the configured corrected candidate is uniquely valid."""
    if settings.app_environment.lower() not in {"development", "test"} or not settings.development_prediction_api_enabled:
        raise SelectedModelResolutionError(
            PREDICTION_FEATURE_DISABLED,
            "Development current-term predictions are disabled.",
        )
    try:
        name = selected_development_model_name()
    except ValueError as exc:
        raise SelectedModelResolutionError(SELECTED_MODEL_NOT_REFRESH_ELIGIBLE, str(exc)) from exc
    if name != CORRECTED_MODEL_NAME:
        raise SelectedModelResolutionError(
            SELECTED_MODEL_NOT_REFRESH_ELIGIBLE,
            "The selected development model is not eligible for current-term refresh.",
        )
    rows = db.query(AIModelVersion).filter(AIModelVersion.model_name == name).all()
    if not rows:
        raise SelectedModelResolutionError(
            MODEL_REGISTRY_ENTRY_NOT_FOUND,
            "The selected development model registry entry was not found.",
        )
    if len(rows) != 1:
        raise SelectedModelResolutionError(
            DUPLICATE_MODEL_REGISTRY_ENTRY,
            "Multiple selected development model registry entries were found.",
        )
    try:
        return require_current_term_model(db, rows[0].model_version_id)
    except ValueError as exc:
        raise SelectedModelResolutionError(MODEL_CONTRACT_INVALID, str(exc)) from exc
