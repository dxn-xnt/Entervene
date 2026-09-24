"""Verify and register the existing corrected RF in the isolated demo database."""

from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path

import joblib
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.services.prediction.DevelopmentCurrentTermModelSelection import (
    CORRECTED_MODEL_NAME, artifact_path, schema_path,
)
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    SUPPORTED_SUBJECTS, SUPPORTED_WEIGHT_PATTERNS,
)

BACKEND_DIR = Path(__file__).resolve().parents[3]
REPORT_PATH = BACKEND_DIR / "data" / "experiments" / "official_target_rf_4i" / "evaluation_report.json"
MANIFEST_PATH = Path(__file__).resolve().parent / "schemas" / f"{CORRECTED_MODEL_NAME}_manifest.json"


def require_isolated_demo_database(db: Session) -> None:
    url = make_url(str(db.get_bind().url))
    if settings.app_environment.lower() != "development" or (url.database or "").casefold() != "entervene_demo" or url.host not in {"localhost", "127.0.0.1"}:
        raise ValueError("Corrected model registration requires local Entervene_Demo in development mode.")


def verified_corrected_package() -> tuple[dict, dict, str, str]:
    path = artifact_path(CORRECTED_MODEL_NAME)
    schema = json.loads(schema_path(CORRECTED_MODEL_NAME).read_text(encoding="utf-8"))
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    digest = sha256(path.read_bytes()).hexdigest()
    artifact = joblib.load(path)
    features = schema.get("feature_columns")
    ordered_hash = sha256(json.dumps(features, separators=(",", ":")).encode()).hexdigest()
    if (
        report.get("model_name") != CORRECTED_MODEL_NAME
        or report.get("artifact", {}).get("sha256") != digest
        or report.get("verification", {}).get("data_sha256") != artifact.get("dataset_sha256")
        or report.get("verification", {}).get("feature_schema_sha256") != ordered_hash
        or artifact.get("model_name") != CORRECTED_MODEL_NAME
        or artifact.get("feature_columns") != features
        or artifact.get("feature_schema_sha256") != ordered_hash
        or schema.get("artifact_feature_order_sha256") != ordered_hash
        or len(features) != 31
        or schema.get("target_column") != artifact.get("target_column")
        or manifest.get("model_name") != CORRECTED_MODEL_NAME
        or manifest.get("model_purpose") != ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
        or manifest.get("target_column") != artifact.get("target_column")
        or manifest.get("lifecycle") != "DEVELOPMENT"
        or manifest.get("artifact_sha256") != digest
        or manifest.get("feature_order_sha256") != ordered_hash
        or manifest.get("dataset_sha256") != artifact.get("dataset_sha256")
        or any(manifest.get(key) is not False for key in ("is_active", "production_validated", "independent_three_term_validation"))
        or artifact.get("target_column") != "target_final_period_grade"
        or set(schema.get("supported_subjects") or []) != SUPPORTED_SUBJECTS
        or set(schema.get("supported_weight_patterns") or []) != SUPPORTED_WEIGHT_PATTERNS
        or any(artifact.get(key) is not False or report.get(key) is not False for key in ("is_active", "production_validated", "independent_three_term_validation"))
        or artifact.get("lifecycle") != "DEVELOPMENT"
        or report.get("lifecycle") != "DEVELOPMENT"
    ):
        raise ValueError("Corrected RF artifact, schema, and evaluation report disagree.")
    schema_digest = sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return schema, report, digest, schema_digest


def register_corrected_development_model(db: Session) -> tuple[AIModelVersion, bool]:
    require_isolated_demo_database(db)
    schema, report, artifact_digest, schema_digest = verified_corrected_package()
    rows = db.query(AIModelVersion).filter(AIModelVersion.model_name == CORRECTED_MODEL_NAME).all()
    if len(rows) > 1:
        raise ValueError("Duplicate corrected development model registry entries.")
    if rows:
        row = rows[0]
        metadata = row.registry_metadata_json or {}
        if (row.model_type != "REGRESSOR" or row.model_purpose != ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
            or row.target_column != "target_final_period_grade" or row.lifecycle_status != "DEVELOPMENT"
            or row.is_active or row.production_validated or row.independent_three_term_validation
            or row.feature_schema_json != schema or metadata.get("feature_schema_sha256") != schema_digest
            or metadata.get("artifact_sha256") != artifact_digest
            or row.artifact_path != f"data/models/{CORRECTED_MODEL_NAME}.joblib"):
            raise ValueError("Existing corrected model registry entry does not match the verified package.")
        return row, False
    metrics = report["views"]["runtime_exact"]["75_pct_latest_period"]["rf"]
    metadata = {
        "supported_subjects": sorted(SUPPORTED_SUBJECTS),
        "supported_weight_patterns": sorted(SUPPORTED_WEIGHT_PATTERNS),
        "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM",
        "feature_schema_sha256": schema_digest,
        "feature_schema_version": f"sha256:{schema_digest}",
        "artifact_sha256": artifact_digest,
        "training_dataset_version": f"sha256:{schema['dataset_sha256']}",
        "evaluation_report_path": "data/experiments/official_target_rf_4i/evaluation_report.json",
        "artifact_feature_order_sha256": schema["artifact_feature_order_sha256"],
    }
    row = AIModelVersion(
        model_name=CORRECTED_MODEL_NAME, model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
        algorithm="RandomForestRegressor", target_column="target_final_period_grade",
        lifecycle_status="DEVELOPMENT", is_active=False, production_validated=False,
        independent_three_term_validation=False,
        artifact_path=f"data/models/{CORRECTED_MODEL_NAME}.joblib",
        feature_schema_json=schema, registry_metadata_json=metadata,
        training_row_count=report["verification"]["snapshots"],
        test_row_count=metrics["n"], mae=metrics["mae"], rmse=metrics["rmse"],
        r2_score=metrics["r2"],
    )
    db.add(row)
    db.flush()
    return row, True
