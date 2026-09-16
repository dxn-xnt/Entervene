from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion


REQUIRED_REPORT_FIELDS = {
    "model_name",
    "model_type",
    "algorithm",
    "target_column",
    "training_row_count",
    "test_row_count",
    "mae",
    "rmse",
    "r2_score",
    "feature_count",
    "feature_columns",
    "created_at",
    "ready_for_task_4",
}
REQUIRED_SCHEMA_FIELDS = {
    "feature_columns",
    "target_column",
    "excluded_columns",
    "column_mappings",
    "required_runtime_columns",
}


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return payload


def load_training_report(path: Path) -> dict[str, Any]:
    return load_json(path)


def load_feature_schema(path: Path) -> dict[str, Any]:
    return load_json(path)


def validate_training_report(report: dict[str, Any]) -> None:
    missing = sorted(REQUIRED_REPORT_FIELDS - set(report))
    if missing:
        raise ValueError(f"Training report is missing required fields: {', '.join(missing)}")
    if report["ready_for_task_4"] is not True:
        raise ValueError("Training report is not ready for Task 4.")
    if report["model_type"] != "REGRESSOR":
        raise ValueError("Only REGRESSOR model versions can be registered by this utility.")
    if report["algorithm"] != "RandomForestRegressor":
        raise ValueError("Only RandomForestRegressor artifacts can be registered by this utility.")
    if len(report["feature_columns"]) != int(report["feature_count"]):
        raise ValueError("Feature count does not match feature_columns length.")


def validate_feature_schema(schema: dict[str, Any]) -> None:
    missing = sorted(REQUIRED_SCHEMA_FIELDS - set(schema))
    if missing:
        raise ValueError(f"Feature schema is missing required fields: {', '.join(missing)}")
    if not isinstance(schema["feature_columns"], list) or not schema["feature_columns"]:
        raise ValueError("Feature schema must include a non-empty feature_columns list.")
    if not isinstance(schema["required_runtime_columns"], list) or not schema["required_runtime_columns"]:
        raise ValueError("Feature schema must include a non-empty required_runtime_columns list.")


def validate_artifact_path(path: Path) -> None:
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Model artifact file not found: {path}")


def normalize_artifact_path(path: Path, base_dir: Path | None = None) -> str:
    base = (base_dir or Path.cwd()).resolve()
    resolved = path.resolve()
    try:
        normalized = resolved.relative_to(base)
    except ValueError:
        normalized = path
    return normalized.as_posix()


def parse_trained_at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def deactivate_existing_versions(db: Session, model_name: str, model_type: str) -> int:
    versions = (
        db.query(AIModelVersion)
        .filter(
            AIModelVersion.model_name == model_name,
            AIModelVersion.model_type == model_type,
            AIModelVersion.is_active == True,
        )
        .all()
    )
    for version in versions:
        version.is_active = False
    return len(versions)


def register_model_version(
    db: Session,
    report: dict[str, Any],
    schema: dict[str, Any],
    artifact_path: str,
    activate: bool,
) -> tuple[AIModelVersion, int, bool]:
    validate_training_report(report)
    validate_feature_schema(schema)

    model_name = report["model_name"]
    model_type = report["model_type"]
    version = (
        db.query(AIModelVersion)
        .filter(
            AIModelVersion.model_name == model_name,
            AIModelVersion.model_type == model_type,
            AIModelVersion.artifact_path == artifact_path,
        )
        .one_or_none()
    )
    created = version is None

    deactivated_count = 0
    if activate:
        deactivated_count = deactivate_existing_versions(db, model_name, model_type)

    if version is None:
        version = AIModelVersion(
            model_name=model_name,
            model_type=model_type,
            artifact_path=artifact_path,
        )
        db.add(version)

    version.algorithm = report["algorithm"]
    version.trained_at = parse_trained_at(report["created_at"])
    version.training_row_count = int(report["training_row_count"])
    version.test_row_count = int(report["test_row_count"])
    version.mae = Decimal(str(report["mae"]))
    version.rmse = Decimal(str(report["rmse"]))
    version.r2_score = Decimal(str(report["r2_score"]))
    version.feature_schema_json = schema
    version.artifact_path = artifact_path
    version.is_active = bool(activate)

    db.commit()
    db.refresh(version)
    return version, deactivated_count, created


def count_active_versions(db: Session, model_name: str, model_type: str) -> int:
    return (
        db.query(AIModelVersion)
        .filter(
            AIModelVersion.model_name == model_name,
            AIModelVersion.model_type == model_type,
            AIModelVersion.is_active == True,
        )
        .count()
    )
