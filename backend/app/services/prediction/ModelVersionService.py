from __future__ import annotations

import hashlib
import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.services.prediction.ModelRegistryExceptions import (
    ActiveModelNotFound,
    ArtifactIntegrityError,
    ConcurrentActivationConflict,
    ModelPurposeMismatch,
    UnsupportedModelPurpose,
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
VALID_PURPOSES = {p.value for p in ModelPurpose}


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def resolve_artifact_path(artifact_path: str, base_dir: Path | None = None) -> Path:
    path = Path(artifact_path)
    if path.is_absolute():
        resolved = path
    else:
        base = base_dir or backend_dir()
        resolved = base / path
    return resolved.resolve()


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


def compute_file_sha256(path: Path) -> str:
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"File not found for hash calculation: {path}")
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def verify_artifact_manifest(
    manifest: dict[str, Any],
    artifact_path: Path,
    schema_path: Path | None = None,
    report_path: Path | None = None,
) -> None:
    hashes = manifest.get("artifact_hashes", {})
    if "model_sha256" in hashes:
        actual_model_sha = compute_file_sha256(artifact_path)
        if actual_model_sha != hashes["model_sha256"]:
            raise ArtifactIntegrityError(
                f"Model artifact SHA-256 mismatch: expected {hashes['model_sha256']}, got {actual_model_sha}"
            )
    if schema_path and schema_path.exists() and "feature_schema_sha256" in hashes:
        actual_schema_sha = compute_file_sha256(schema_path)
        if actual_schema_sha != hashes["feature_schema_sha256"]:
            raise ArtifactIntegrityError(
                f"Feature schema SHA-256 mismatch: expected {hashes['feature_schema_sha256']}, got {actual_schema_sha}"
            )
    if report_path and report_path.exists() and "training_report_sha256" in hashes:
        actual_report_sha = compute_file_sha256(report_path)
        if actual_report_sha != hashes["training_report_sha256"]:
            raise ArtifactIntegrityError(
                f"Training report SHA-256 mismatch: expected {hashes['training_report_sha256']}, got {actual_report_sha}"
            )


def normalize_feature_schema(schema: dict[str, Any]) -> dict[str, Any]:
    norm = dict(schema)
    if "feature_columns" not in norm and "encoded_feature_names" in norm:
        norm["feature_columns"] = list(norm["encoded_feature_names"])
    if "required_runtime_columns" not in norm and "raw_feature_columns" in norm:
        norm["required_runtime_columns"] = list(norm["raw_feature_columns"])
    if "column_mappings" not in norm:
        norm["column_mappings"] = {}
    return norm


def normalize_training_report(report: dict[str, Any], schema: dict[str, Any] | None = None) -> dict[str, Any]:
    norm = dict(report)

    # Normalize algorithm if string includes extra notes e.g. "RandomForestRegressor (Tuned)" -> "RandomForestRegressor"
    algo = norm.get("algorithm", "")
    if algo.startswith("RandomForestRegressor"):
        norm["algorithm"] = "RandomForestRegressor"

    # Pull metrics from test_evaluation if nested
    if "test_evaluation" in norm and isinstance(norm["test_evaluation"], dict):
        overall = norm["test_evaluation"].get("overall", {})
        norm.setdefault("mae", overall.get("mae"))
        norm.setdefault("rmse", overall.get("rmse"))
        norm.setdefault("r2_score", overall.get("r2_score"))
        norm.setdefault("test_row_count", overall.get("count"))

    # Pull training_row_count if nested in development_cv_metrics
    if "training_row_count" not in norm and "development_cv_metrics" in norm:
        comps = norm["development_cv_metrics"].get("model_comparisons", {})
        rf_comp = comps.get("RandomForestRegressor (Tuned)") or comps.get("RandomForestRegressor")
        if rf_comp and "count" in rf_comp:
            norm["training_row_count"] = rf_comp["count"]

    # Pull feature_columns and feature_count from schema if missing from report
    if schema:
        norm_schema = normalize_feature_schema(schema)
        if "feature_columns" not in norm:
            norm["feature_columns"] = norm_schema.get("feature_columns", [])
        if "feature_count" not in norm:
            norm["feature_count"] = len(norm.get("feature_columns", []))

    return norm


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
    if "model_purpose" in report and report["model_purpose"] not in VALID_PURPOSES:
        raise UnsupportedModelPurpose(f"Invalid model_purpose in report: {report['model_purpose']}")


def validate_feature_schema(schema: dict[str, Any]) -> None:
    missing = sorted(REQUIRED_SCHEMA_FIELDS - set(schema))
    if missing:
        raise ValueError(f"Feature schema is missing required fields: {', '.join(missing)}")
    if not isinstance(schema["feature_columns"], list) or not schema["feature_columns"]:
        raise ValueError("Feature schema must include a non-empty feature_columns list.")
    if not isinstance(schema["required_runtime_columns"], list) or not schema["required_runtime_columns"]:
        raise ValueError("Feature schema must include a non-empty required_runtime_columns list.")
    if "model_purpose" in schema and schema["model_purpose"] not in VALID_PURPOSES:
        raise UnsupportedModelPurpose(f"Invalid model_purpose in schema: {schema['model_purpose']}")


def validate_artifact_path(path: Path) -> None:
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Model artifact file not found: {path}")


def normalize_artifact_path(path: Path, base_dir: Path | None = None) -> str:
    base = (base_dir or backend_dir()).resolve()
    resolved = path.resolve()
    try:
        normalized = resolved.relative_to(base)
    except ValueError:
        normalized = path
    return normalized.as_posix()


def parse_trained_at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def resolve_model_purpose(
    report: dict[str, Any],
    explicit_purpose: ModelPurpose | str | None = None,
) -> str:
    if explicit_purpose is not None:
        if isinstance(explicit_purpose, ModelPurpose):
            return explicit_purpose.value
        try:
            return ModelPurpose(explicit_purpose).value
        except ValueError:
            raise UnsupportedModelPurpose(f"Unsupported model purpose: '{explicit_purpose}'")

    if "model_purpose" in report and report["model_purpose"]:
        try:
            return ModelPurpose(report["model_purpose"]).value
        except ValueError:
            raise UnsupportedModelPurpose(f"Unsupported model purpose in report: '{report['model_purpose']}'")

    name = report.get("model_name", "")
    if "next_period" in name:
        return ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value
    if "current_period" in name:
        return ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value

    raise UnsupportedModelPurpose(f"Cannot deterministically resolve model purpose for model_name '{name}'")


def activate_model_version_atomic(
    db: Session,
    model_version_id: int,
    manifest_path: Path | None = None,
    base_dir: Path | None = None,
) -> tuple[AIModelVersion, int]:
    """Transactionally activate a model version for its model_purpose.

    1. Lock/serialize activation for that purpose.
    2. Validate artifact and hashes immediately before activation.
    3. Deactivate previous version of the SAME purpose only.
    4. Activate target version.
    5. Commit atomically. If any error occurs, rollback.
    """
    try:
        target = db.query(AIModelVersion).filter(AIModelVersion.model_version_id == model_version_id).one_or_none()
        if target is None:
            raise ActiveModelNotFound(f"Model version ID {model_version_id} not found.")

        purpose = target.model_purpose

        # 1. Lock/serialize activation for that purpose
        _ = db.query(AIModelVersion).filter(AIModelVersion.model_purpose == purpose).with_for_update().all()

        # 2. Validate artifact and hash immediately before activation
        resolved_path = resolve_artifact_path(target.artifact_path, base_dir=base_dir)
        m_path = manifest_path
        if m_path is None and resolved_path.exists():
            candidate = resolved_path.with_name(f"{target.model_name}_manifest.json")
            if candidate.exists():
                m_path = candidate

        if m_path and m_path.exists():
            validate_artifact_path(resolved_path)
            manifest_data = load_json(m_path)
            schema_path = resolved_path.with_name(f"{target.model_name}_feature_schema.json")
            report_path = resolved_path.with_name(f"{target.model_name}_training_report.json")
            verify_artifact_manifest(
                manifest_data,
                artifact_path=resolved_path,
                schema_path=schema_path if schema_path.exists() else None,
                report_path=report_path if report_path.exists() else None,
            )

        # 3. Deactivate previous version of SAME purpose only
        previous_active = (
            db.query(AIModelVersion)
            .filter(
                AIModelVersion.model_purpose == purpose,
                AIModelVersion.model_version_id != target.model_version_id,
                AIModelVersion.is_active == True,
            )
            .all()
        )
        deactivated_count = len(previous_active)
        for prev in previous_active:
            prev.is_active = False

        # 4. Activate target version
        target.is_active = True

        # 5. Commit atomically
        db.commit()
        db.refresh(target)
        return target, deactivated_count
    except IntegrityError as exc:
        db.rollback()
        raise ConcurrentActivationConflict(
            f"Concurrent activation conflict: an active model for purpose '{purpose}' was committed concurrently."
        ) from exc
    except Exception:
        db.rollback()
        raise


def register_model_version(
    db: Session,
    report: dict[str, Any],
    schema: dict[str, Any],
    artifact_path: str,
    activate: bool = False,
    model_purpose: ModelPurpose | str | None = None,
    manifest_path: Path | None = None,
    base_dir: Path | None = None,
) -> tuple[AIModelVersion, int, bool]:
    norm_schema = normalize_feature_schema(schema)
    norm_report = normalize_training_report(report, schema=norm_schema)
    validate_training_report(norm_report)
    validate_feature_schema(norm_schema)

    purpose_str = resolve_model_purpose(norm_report, explicit_purpose=model_purpose)
    model_name = norm_report["model_name"]
    model_type = norm_report["model_type"]

    resolved_path = resolve_artifact_path(artifact_path, base_dir=base_dir)
    if resolved_path.exists() or manifest_path:
        validate_artifact_path(resolved_path)

    if manifest_path and manifest_path.exists():
        manifest_data = load_json(manifest_path)
        verify_artifact_manifest(manifest_data, resolved_path)

    version = (
        db.query(AIModelVersion)
        .filter(
            AIModelVersion.model_name == model_name,
            AIModelVersion.model_type == model_type,
            AIModelVersion.model_purpose == purpose_str,
            AIModelVersion.artifact_path == artifact_path,
        )
        .one_or_none()
    )
    created = version is None

    if version is None:
        version = AIModelVersion(
            model_name=model_name,
            model_type=model_type,
            model_purpose=purpose_str,
            artifact_path=artifact_path,
            is_active=False,  # Registration always begins is_active=False
        )
        db.add(version)

    version.algorithm = norm_report["algorithm"]
    version.model_purpose = purpose_str
    version.trained_at = parse_trained_at(norm_report["created_at"])
    version.training_row_count = int(norm_report["training_row_count"])
    version.test_row_count = int(norm_report["test_row_count"])
    version.mae = Decimal(str(norm_report["mae"]))
    version.rmse = Decimal(str(norm_report["rmse"]))
    version.r2_score = Decimal(str(norm_report["r2_score"]))
    version.feature_schema_json = norm_schema
    version.artifact_path = artifact_path
    if created:
        version.is_active = False

    db.commit()
    db.refresh(version)

    deactivated_count = 0
    if activate:
        version, deactivated_count = activate_model_version_atomic(
            db=db,
            model_version_id=version.model_version_id,
            manifest_path=manifest_path,
            base_dir=base_dir,
        )

    return version, deactivated_count, created


def count_active_versions_by_purpose(db: Session, model_purpose: ModelPurpose | str) -> int:
    if isinstance(model_purpose, ModelPurpose):
        purpose_str = model_purpose.value
    else:
        purpose_str = str(model_purpose)
    return (
        db.query(AIModelVersion)
        .filter(
            AIModelVersion.model_purpose == purpose_str,
            AIModelVersion.is_active == True,
        )
        .count()
    )


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
