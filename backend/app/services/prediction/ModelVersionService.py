from __future__ import annotations

import json
from hashlib import sha256
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import null

from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.services.prediction.ModelRegistryExceptions import (
    ArtifactIntegrityError,
    ConcurrentActivationConflict,
)


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
LEGACY_PURPOSES = {
    "entervene_next_period_grade_rf": ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
    "entervene_current_period_grade_rf_v1": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
}


def _purpose_value(value: ModelPurpose | str) -> str:
    purpose = value.value if isinstance(value, ModelPurpose) else value
    if purpose not in {member.value for member in ModelPurpose}:
        raise ValueError(f"Unsupported model purpose: {purpose}")
    return purpose


def get_model_versions(
    db: Session,
    *,
    purpose: ModelPurpose | str | None = None,
    lifecycle_status: str | None = None,
    is_active: bool | None = None,
) -> list[AIModelVersion]:
    query = db.query(AIModelVersion)
    if purpose is not None:
        query = query.filter(AIModelVersion.model_purpose == _purpose_value(purpose))
    if lifecycle_status is not None:
        query = query.filter(AIModelVersion.lifecycle_status == lifecycle_status)
    if is_active is not None:
        query = query.filter(AIModelVersion.is_active.is_(is_active))
    return query.order_by(AIModelVersion.model_version_id).all()


def count_active_versions_by_purpose(db: Session, purpose: ModelPurpose | str) -> int:
    return db.query(AIModelVersion).filter(
        AIModelVersion.model_purpose == _purpose_value(purpose),
        AIModelVersion.is_active.is_(True),
    ).count()


def get_production_model_versions(db: Session, purpose: ModelPurpose | str) -> list[AIModelVersion]:
    return db.query(AIModelVersion).filter(
        AIModelVersion.model_purpose == _purpose_value(purpose),
        AIModelVersion.lifecycle_status == "PRODUCTION",
        AIModelVersion.production_validated.is_(True),
        AIModelVersion.is_active.is_(True),
    ).order_by(AIModelVersion.model_version_id).all()


def activate_model_version_atomic(
    db: Session,
    model_version_id: int,
    *,
    manifest_path: Path | None = None,
) -> AIModelVersion:
    version = db.get(AIModelVersion, model_version_id)
    if version is None:
        raise LookupError(f"Model version {model_version_id} was not found.")
    if manifest_path is not None:
        expected = (load_json(manifest_path).get("artifact_hashes") or {}).get("model_sha256")
        artifact = Path(version.artifact_path)
        if not expected or not artifact.is_file() or sha256(artifact.read_bytes()).hexdigest() != expected:
            raise ArtifactIntegrityError("Model artifact SHA-256 mismatch.")
    try:
        _deactivate_purpose(db, version.model_purpose)
        version.is_active = True
        db.commit()
        db.refresh(version)
    except IntegrityError as exc:
        db.rollback()
        raise ConcurrentActivationConflict("Concurrent activation conflict for model purpose.") from exc
    return version


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


def normalize_feature_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return schema


def normalize_training_report(report: dict[str, Any], *, schema: dict[str, Any]) -> dict[str, Any]:
    if report.get("development_status") != "DEVELOPMENT_ONLY":
        return report
    metrics = report["test_metrics"]
    normalized = dict(report)
    normalized.update(
        model_type="REGRESSOR",
        algorithm=report["selected_model"],
        training_row_count=report["train_rows"],
        test_row_count=report["test_rows"],
        mae=metrics["mae"],
        rmse=metrics["rmse"],
        r2_score=metrics["r2"],
        feature_count=len(schema["feature_columns"]),
    )
    return normalized


def validate_training_report(report: dict[str, Any]) -> None:
    is_development = report.get("development_status") == "DEVELOPMENT_ONLY"
    required = REQUIRED_REPORT_FIELDS - ({"created_at", "ready_for_task_4"} if is_development else set())
    missing = sorted(required - set(report))
    if missing:
        raise ValueError(f"Training report is missing required fields: {', '.join(missing)}")
    if is_development and (
        report.get("production_validated") is not False
        or report.get("independent_three_term_validation") is not False
    ):
        raise ValueError("Development report must explicitly remain unvalidated.")
    if not is_development and report["ready_for_task_4"] is not True:
        raise ValueError("Training report is not ready for Task 4.")
    if report["model_type"] != "REGRESSOR":
        raise ValueError("Only REGRESSOR model versions can be registered by this utility.")
    if report["algorithm"] != "RandomForestRegressor":
        raise ValueError("Only RandomForestRegressor artifacts can be registered by this utility.")
    if len(report["feature_columns"]) != int(report["feature_count"]):
        raise ValueError("Feature count does not match feature_columns length.")


def validate_feature_schema(schema: dict[str, Any]) -> None:
    required = {"feature_columns", "target_column"} if schema.get("development_status") == "DEVELOPMENT_ONLY" else REQUIRED_SCHEMA_FIELDS
    missing = sorted(required - set(schema))
    if missing:
        raise ValueError(f"Feature schema is missing required fields: {', '.join(missing)}")
    if not isinstance(schema["feature_columns"], list) or not schema["feature_columns"]:
        raise ValueError("Feature schema must include a non-empty feature_columns list.")
    if schema.get("development_status") != "DEVELOPMENT_ONLY" and (
        not isinstance(schema["required_runtime_columns"], list) or not schema["required_runtime_columns"]
    ):
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


def _deactivate_purpose(db: Session, purpose: str) -> int:
    versions = get_model_versions(db, purpose=purpose, is_active=True)
    for version in versions:
        version.is_active = False
    db.flush()
    return len(versions)


def register_model_version(
    db: Session,
    report: dict[str, Any],
    schema: dict[str, Any],
    artifact_path: str,
    activate: bool,
    model_purpose: ModelPurpose | str | None = None,
    manifest_path: Path | None = None,
) -> tuple[AIModelVersion, int, bool]:
    validate_training_report(report)
    validate_feature_schema(schema)

    purpose = _purpose_value(model_purpose or report.get("model_purpose") or LEGACY_PURPOSES.get(report["model_name"], ""))
    if report.get("development_status") == "DEVELOPMENT_ONLY" and activate:
        raise ValueError("Development-only model versions cannot be activated by registration.")
    if schema["target_column"] != report["target_column"]:
        raise ValueError("Training report and feature schema target columns disagree.")
    if manifest_path is not None:
        manifest = load_json(manifest_path)
        expected = (manifest.get("artifact_hashes") or {}).get("model_sha256")
        artifact_file = Path(artifact_path)
        if not expected or not artifact_file.is_file():
            raise ArtifactIntegrityError("Model artifact SHA-256 mismatch.")
        actual = sha256(artifact_file.read_bytes()).hexdigest()
        if actual != expected:
            raise ArtifactIntegrityError("Model artifact SHA-256 mismatch.")

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
        deactivated_count = _deactivate_purpose(db, purpose)

    if version is None:
        version = AIModelVersion(
            model_name=model_name,
            model_type=model_type,
            model_purpose=purpose,
            artifact_path=artifact_path,
        )
        db.add(version)

    version.algorithm = report["algorithm"]
    version.model_purpose = purpose
    version.target_column = report["target_column"]
    if created:
        version.lifecycle_status = "DEVELOPMENT"
        version.production_validated = False
        version.independent_three_term_validation = False
    metadata = dict(version.registry_metadata_json or {})
    for field in (
        "feature_schema_version", "training_dataset_version", "supported_subjects",
        "supported_weight_patterns", "period_semantics", "artifact_sha256", "feature_schema_sha256",
    ):
        if field in schema:
            metadata[field] = schema[field]
        elif field in report:
            metadata[field] = report[field]
    if report.get("model_name") == "entervene_current_term_development_rf_v3":
        from app.services.prediction.DevelopmentCurrentTermPredictionService import (
            SUPPORTED_SUBJECTS,
            SUPPORTED_WEIGHT_PATTERNS,
        )
        artifact_subjects = set(schema.get("supported_subjects") or [])
        artifact_weights = set(schema.get("supported_weight_patterns") or [])
        if not SUPPORTED_SUBJECTS <= artifact_subjects or not SUPPORTED_WEIGHT_PATTERNS <= artifact_weights:
            raise ValueError("V3 runtime domain is not contained in the artifact schema domain.")
        metadata["artifact_supported_subjects"] = sorted(artifact_subjects)
        metadata["supported_subjects"] = sorted(SUPPORTED_SUBJECTS)
        metadata["supported_weight_patterns"] = sorted(SUPPORTED_WEIGHT_PATTERNS)
    schema_digest = sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    metadata["feature_schema_sha256"] = schema_digest
    metadata.setdefault("feature_schema_version", f"sha256:{schema_digest}")
    if report.get("dataset_sha256"):
        metadata["training_dataset_version"] = f"sha256:{report['dataset_sha256']}"
    if purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value:
        metadata["period_semantics"] = "SOURCE_EQUALS_TARGET_SAME_TERM"
    artifact_file = Path(artifact_path)
    if artifact_file.is_file():
        metadata["artifact_sha256"] = sha256(artifact_file.read_bytes()).hexdigest()
    version.registry_metadata_json = metadata or None
    if report.get("created_at"):
        version.trained_at = parse_trained_at(report["created_at"])
    elif created:
        version.trained_at = null()
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
