"""Allowlisted model selection for the development current-term flow only."""

from __future__ import annotations

from pathlib import Path

from app.core.Config import settings


LEGACY_MODEL_NAME = "entervene_current_term_development_rf_v3"
CORRECTED_MODEL_NAME = "entervene_current_term_official_target_rf_candidate"
MODEL_NAMES = frozenset({LEGACY_MODEL_NAME, CORRECTED_MODEL_NAME})
MODELS_DIR = Path(__file__).resolve().parents[3] / "data" / "models"


def require_development_model_name(model_name: str) -> str:
    if model_name not in MODEL_NAMES:
        raise ValueError("Unknown development current-term model selector.")
    return model_name


def selected_development_model_name() -> str:
    return require_development_model_name(settings.development_current_term_model_name)


def artifact_path(model_name: str) -> Path:
    return MODELS_DIR / f"{require_development_model_name(model_name)}.joblib"


def schema_path(model_name: str) -> Path:
    name = require_development_model_name(model_name)
    if name == CORRECTED_MODEL_NAME:
        return Path(__file__).resolve().parent / "schemas" / f"{name}_feature_schema.json"
    return MODELS_DIR / f"{name}_feature_schema.json"
