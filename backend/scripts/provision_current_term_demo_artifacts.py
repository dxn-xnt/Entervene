"""Provision the verified, locally supplied DEVELOPMENT demo model bundle.

The source directory has the same `models/` and `experiments/` layout as
`backend/data/`. Nothing is downloaded or trained.
"""

from __future__ import annotations

import argparse
import json
import shutil
from hashlib import sha256
from pathlib import Path

import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline


BACKEND_DIR = Path(__file__).resolve().parents[1]
MODEL_NAME = "entervene_current_term_official_target_rf_candidate"
LEGACY_NAME = "entervene_current_term_development_rf_v3"
FILES = {
    f"models/{MODEL_NAME}.joblib": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc",
    f"models/{LEGACY_NAME}.joblib": "8666c600a1e1ed5afaaa73c5fae8f381e83150c26af3f0af8c1580fd8d2eb3fd",
    f"models/{LEGACY_NAME}_feature_schema.json": "5554c3cd743ea3999cf1e6757d53dae3c6b5ed6d3714cb9c5af70466a29d26ff",
    "models/entervene_current_period_grade_rf_v1_feature_schema.json": "9519518d7a17e6d7142c851868739545fcb6c96585624fe0fa7b35c07ca95998",
    "experiments/official_target_rf_4i/evaluation_report.json": "e75f5ed87cf525c5b6e7e7a79403c1208d1d4558520faf5eaf4e65b2a70793fb",
}
SCHEMA_PATH = BACKEND_DIR / "app" / "services" / "prediction" / "schemas" / f"{MODEL_NAME}_feature_schema.json"
MANIFEST_PATH = SCHEMA_PATH.with_name(f"{MODEL_NAME}_manifest.json")


def digest(path: Path) -> str:
    hasher = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def verify_source(source: Path) -> dict[str, str]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    if manifest.get("artifact_sha256") != FILES[f"models/{MODEL_NAME}.joblib"]:
        raise ValueError("Checked-in corrected model manifest does not match the trusted checksum.")
    for relative, expected in FILES.items():
        path = source / relative
        if not path.is_file():
            raise ValueError(f"Required development demo bundle file missing: {relative}")
        if digest(path) != expected:
            raise ValueError(f"Development demo bundle checksum mismatch: {relative}")

    columns = schema.get("feature_columns")
    ordered_hash = sha256(json.dumps(columns, separators=(",", ":")).encode()).hexdigest()
    if (manifest.get("model_name") != MODEL_NAME
        or manifest.get("model_purpose") != "CURRENT_TERM_FINAL_GRADE_PROJECTION"
        or manifest.get("target_column") != "target_final_period_grade"
        or manifest.get("feature_order_sha256") != ordered_hash
        or schema.get("artifact_feature_order_sha256") != ordered_hash
        or len(columns or []) != 31
        or any(manifest.get(key) is not False for key in ("is_active", "production_validated", "independent_three_term_validation"))):
        raise ValueError("Corrected development model manifest/schema mismatch.")

    # Joblib is loaded only after its exact trusted checksum has passed.
    artifact = joblib.load(source / f"models/{MODEL_NAME}.joblib")
    if not isinstance(artifact, dict):
        raise ValueError("Corrected development model artifact metadata missing.")
    report = json.loads((source / "experiments/official_target_rf_4i/evaluation_report.json").read_text(encoding="utf-8"))
    pipeline = artifact.get("pipeline") if isinstance(artifact, dict) else None
    estimator = pipeline.steps[-1][1] if isinstance(pipeline, Pipeline) and pipeline.steps else None
    if (artifact.get("model_name") != MODEL_NAME
        or artifact.get("target_column") != "target_final_period_grade"
        or artifact.get("feature_columns") != columns
        or artifact.get("feature_schema_sha256") != ordered_hash
        or artifact.get("dataset_sha256") != manifest.get("dataset_sha256")
        or artifact.get("lifecycle") != "DEVELOPMENT"
        or not isinstance(estimator, RandomForestRegressor)
        or estimator.n_estimators != 300
        or report.get("model_name") != MODEL_NAME
        or report.get("artifact", {}).get("sha256") != manifest.get("artifact_sha256")
        or report.get("verification", {}).get("feature_schema_sha256") != ordered_hash
        or report.get("verification", {}).get("data_sha256") != artifact.get("dataset_sha256")
        or any(artifact.get(key) is not False or report.get(key) is not False for key in ("is_active", "production_validated", "independent_three_term_validation"))):
        raise ValueError("Corrected development model artifact, schema, and report disagree.")
    return dict(FILES)


def provision(source: Path, destination: Path) -> list[str]:
    verified = verify_source(source)
    for relative, expected in verified.items():
        target = destination / relative
        if target.exists() and digest(target) != expected:
            raise ValueError(f"Refusing to replace a different runtime artifact: {relative}")
    copied = []
    for relative, expected in verified.items():
        target = destination / relative
        if target.is_file():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".provisioning")
        try:
            shutil.copyfile(source / relative, temporary)
            if digest(temporary) != expected:
                raise ValueError(f"Copied development demo artifact checksum mismatch: {relative}")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        copied.append(relative)
    return copied


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True, help="Trusted local bundle root containing models/ and experiments/.")
    args = parser.parse_args()
    copied = provision(args.source_dir.resolve(), BACKEND_DIR / "data")
    print(f"Verified {len(FILES)} development demo files; copied {len(copied)} into the ignored runtime data directory.")


if __name__ == "__main__":
    main()
