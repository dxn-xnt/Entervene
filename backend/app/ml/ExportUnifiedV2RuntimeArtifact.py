from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

try:
    from app.ml import RunUnifiedDevelopmentExperiment as devexp
except ModuleNotFoundError:  # pragma: no cover
    import RunUnifiedDevelopmentExperiment as devexp


MODEL_NAME = "unified_current_term_projection_v2"
MODEL_PURPOSE = "UNIFIED_CURRENT_TERM_PROJECTION"
DEVELOPMENT_STATUS = "DEVELOPMENT_PROMISING"
INDEPENDENT_3TERM_VALIDATION = False
PERIOD_FEATURE = "current_period_progress_ratio"
UNSUPPORTED_SUBJECTS = ["MAPEH", "ADVANCED_PHYSICS"]
SUPPORTED_SUBJECTS = [
    "CREATIVE_TECHNOLOGY",
    "ELECTRONICS",
    "ENGLISH",
    "ICT",
    "MATHEMATICS",
    "SCIENCE",
    "VALUES_EDUCATION",
]
RF_HYPERPARAMETERS = {
    "n_estimators": 300,
    "max_depth": None,
    "max_features": 0.5,
    "min_samples_leaf": 2,
    "min_samples_split": 5,
}


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def sha256_json(obj: Any) -> str:
    payload = json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def model_paths(output_dir: Path | None = None) -> dict[str, Path]:
    out = output_dir or (devexp.BACKEND_DIR / "data" / "models")
    return {
        "artifact": out / f"{MODEL_NAME}.joblib",
        "schema": out / f"{MODEL_NAME}_feature_schema.json",
        "report": out / f"{MODEL_NAME}_training_report.json",
        "manifest": out / f"{MODEL_NAME}_manifest.json",
    }


def unified_v2_features() -> list[str]:
    return devexp.FEATURE_SETS["F1"][:-1] + [PERIOD_FEATURE] + ["subject"]


def load_training_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    dataset_sha = sha256_file(devexp.DATASET_PATH)
    if dataset_sha != devexp.EXPECTED_DATASET_SHA256:
        raise RuntimeError(
            f"Unified dataset SHA mismatch: expected {devexp.EXPECTED_DATASET_SHA256}, actual {dataset_sha}"
        )
    df = pd.read_csv(devexp.DATASET_PATH)
    if len(df) != devexp.EXPECTED_ROWS:
        raise RuntimeError(f"Unified dataset row mismatch: expected {devexp.EXPECTED_ROWS}, actual {len(df)}")
    if (df["subject_meta"] == "MAPEH").any() or (df["subject"] == "MAPEH").any():
        raise RuntimeError("MAPEH rows are not allowed in Unified V2 training.")
    df[PERIOD_FEATURE] = (df["historical_period_sequence"].astype(float) / 4.0).round(6)
    frozen_mask = df["cohort_group_key"].isin(devexp.FROZEN_TEST_COHORTS)
    dev = df.loc[~frozen_mask].copy()
    frozen = df.loc[frozen_mask].copy()
    if len(dev) != devexp.EXPECTED_DEV_ROWS or len(frozen) != devexp.EXPECTED_FROZEN_ROWS:
        raise RuntimeError(f"Unexpected split sizes: development={len(dev)}, frozen={len(frozen)}")
    if set(dev["raw_student_key"]) & set(frozen["raw_student_key"]):
        raise RuntimeError("Development/frozen learner overlap detected.")
    return dev, frozen


def verify_feature_contract(features: list[str]) -> None:
    if len(features) != 34:
        raise RuntimeError(f"Unified V2 raw feature count must be 34, got {len(features)}")
    if PERIOD_FEATURE not in features:
        raise RuntimeError(f"{PERIOD_FEATURE} is missing from Unified V2 features.")
    if devexp.TARGET_COLUMN in features:
        raise RuntimeError("Target column leaks into Unified V2 features.")
    metadata_leaks = sorted(set(features) & devexp.METADATA_COLUMNS)
    if metadata_leaks:
        raise RuntimeError(f"Metadata columns leak into Unified V2 features: {metadata_leaks}")


def build_schema(features: list[str]) -> dict[str, Any]:
    numeric = [feature for feature in features if feature != "subject"]
    categorical = ["subject"]
    return {
        "schema_version": "unified-current-term-v2-runtime-schema-1",
        "model_name": MODEL_NAME,
        "model_purpose": MODEL_PURPOSE,
        "development_status": DEVELOPMENT_STATUS,
        "independent_3term_validation": INDEPENDENT_3TERM_VALIDATION,
        "feature_columns": features,
        "raw_feature_columns": features,
        "raw_feature_count": len(features),
        "numeric_features": numeric,
        "categorical_features": categorical,
        "required_runtime_columns": features,
        "target_column": devexp.TARGET_COLUMN,
        "excluded_columns": sorted(devexp.METADATA_COLUMNS | {devexp.TARGET_COLUMN}),
        "column_mappings": {},
        "preprocessing": {
            "numeric": {
                "imputer": "SimpleImputer(strategy='median')",
                "missingness_strategy": "M1",
            },
            "categorical": {
                "encoder": "OneHotEncoder(handle_unknown='ignore')",
                "features": categorical,
            },
        },
        "period_context": {
            "feature": PERIOD_FEATURE,
            "definition": "academic_period.period_sequence / academic_period.total_periods_in_year",
            "historical_training_mapping": {"P1": 0.25, "P2": 0.5, "P3": 0.75, "P4": 1.0},
            "production_three_term_mapping": {
                "Term 1": round(1 / 3, 6),
                "Term 2": round(2 / 3, 6),
                "Term 3": 1.0,
            },
        },
        "supported_subjects": SUPPORTED_SUBJECTS,
        "unsupported_subjects": UNSUPPORTED_SUBJECTS,
        "domain_notes": [
            "MAPEH is unsupported because standard WW/PT/QA aggregate features do not preserve its component-first workbook semantics.",
            "ADVANCED_PHYSICS is unsupported because available historical period coverage is structurally incomplete.",
            "Independent populated supported-subject 3-term validation data was not available at export time.",
        ],
    }


def build_report(dev: pd.DataFrame, frozen: pd.DataFrame, features: list[str]) -> dict[str, Any]:
    # Development OOF metrics come from U4E; they are not recomputed here for selection.
    u4e_path = devexp.EXPERIMENT_DIR / "u4e_period_context_development_experiment.json"
    u4e = json.loads(u4e_path.read_text(encoding="utf-8")) if u4e_path.exists() else {}
    overall = ((u4e.get("overall_comparison") or {}).get("v2") or {})
    created_at = datetime.now(timezone.utc).isoformat()
    return {
        "model_name": MODEL_NAME,
        "model_purpose": MODEL_PURPOSE,
        "model_type": "REGRESSOR",
        "algorithm": "RandomForestRegressor",
        "target_column": devexp.TARGET_COLUMN,
        "training_row_count": int(len(dev)),
        "test_row_count": 0,
        "frozen_rows_excluded_from_training": int(len(frozen)),
        "mae": overall.get("mae"),
        "rmse": overall.get("rmse"),
        "r2_score": overall.get("r2"),
        "feature_count": len(features),
        "feature_columns": features,
        "created_at": created_at,
        "trained_at": created_at,
        "ready_for_task_4": True,
        "development_status": DEVELOPMENT_STATUS,
        "independent_3term_validation": INDEPENDENT_3TERM_VALIDATION,
        "training_dataset_path": devexp.DATASET_PATH.as_posix(),
        "training_dataset_sha256": devexp.EXPECTED_DATASET_SHA256,
        "training_split": {
            "development_rows_used_for_fit": int(len(dev)),
            "old_frozen_rows_excluded_from_fit": int(len(frozen)),
            "frozen_cohorts_excluded": sorted(devexp.FROZEN_TEST_COHORTS),
        },
        "rf_hyperparameters": RF_HYPERPARAMETERS,
        "missingness_strategy": "M1",
        "supported_subjects": SUPPORTED_SUBJECTS,
        "unsupported_subjects": UNSUPPORTED_SUBJECTS,
        "u4e_development_metrics": overall,
        "u4e_period_stability": u4e.get("period_stability"),
    }


def export_artifact(output_dir: Path | None = None) -> dict[str, Any]:
    paths = model_paths(output_dir)
    paths["artifact"].parent.mkdir(parents=True, exist_ok=True)
    dev, frozen = load_training_data()
    features = unified_v2_features()
    verify_feature_contract(features)

    pipeline = devexp.build_pipeline(features, "M1", RF_HYPERPARAMETERS)
    pipeline.fit(dev[features], dev[devexp.TARGET_COLUMN].astype(float))

    artifact_payload = {
        "model_name": MODEL_NAME,
        "model_purpose": MODEL_PURPOSE,
        "development_status": DEVELOPMENT_STATUS,
        "independent_3term_validation": INDEPENDENT_3TERM_VALIDATION,
        "pipeline": pipeline,
        "target_column": devexp.TARGET_COLUMN,
        "raw_feature_columns": features,
        "numeric_features": [feature for feature in features if feature != "subject"],
        "categorical_features": ["subject"],
        "raw_feature_count": len(features),
        "dataset_sha256": devexp.EXPECTED_DATASET_SHA256,
        "random_seed": devexp.RANDOM_STATE,
        "rf_hyperparameters": RF_HYPERPARAMETERS,
        "supported_subjects": SUPPORTED_SUBJECTS,
        "unsupported_subjects": UNSUPPORTED_SUBJECTS,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    joblib.dump(artifact_payload, paths["artifact"])

    schema = build_schema(features)
    paths["schema"].write_text(json.dumps(schema, indent=2, sort_keys=True), encoding="utf-8")
    report = build_report(dev, frozen, features)
    paths["report"].write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")

    hashes = {
        "model_sha256": sha256_file(paths["artifact"]),
        "feature_schema_sha256": sha256_file(paths["schema"]),
        "training_report_sha256": sha256_file(paths["report"]),
        "model_configuration_sha256": sha256_json(
            {
                "features": features,
                "missingness_strategy": "M1",
                "rf_hyperparameters": RF_HYPERPARAMETERS,
                "model_purpose": MODEL_PURPOSE,
            }
        ),
        "training_dataset_sha256": devexp.EXPECTED_DATASET_SHA256,
    }
    manifest = {
        "model_name": MODEL_NAME,
        "model_purpose": MODEL_PURPOSE,
        "development_status": DEVELOPMENT_STATUS,
        "independent_3term_validation": INDEPENDENT_3TERM_VALIDATION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "artifact_hashes": hashes,
        "paths": {key: str(path) for key, path in paths.items() if key != "manifest"},
        "training_rows_used": int(len(dev)),
        "old_frozen_rows_excluded": int(len(frozen)),
    }
    paths["manifest"].write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    # Reload verification and deterministic score check.
    loaded = joblib.load(paths["artifact"])
    if loaded["raw_feature_columns"] != features:
        raise RuntimeError("Reloaded artifact feature list mismatch.")
    sample = dev.iloc[[0]][features]
    pred1 = loaded["pipeline"].predict(sample)
    pred2 = loaded["pipeline"].predict(sample)
    if not np.allclose(pred1, pred2, rtol=0.0, atol=1e-12):
        raise RuntimeError("Reloaded artifact did not produce deterministic prediction for identical input.")

    return {
        "artifact_path": str(paths["artifact"]),
        "schema_path": str(paths["schema"]),
        "report_path": str(paths["report"]),
        "manifest_path": str(paths["manifest"]),
        "hashes": hashes,
        "training_rows_used": int(len(dev)),
        "old_frozen_rows_excluded": int(len(frozen)),
        "feature_count": len(features),
        "features": features,
        "deterministic_sample_prediction": float(pred1[0]),
    }


def main() -> None:
    result = export_artifact()
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

