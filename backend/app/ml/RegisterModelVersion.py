from __future__ import annotations

import argparse
from pathlib import Path

from app.db.Session import SessionLocal
from app.services.prediction.ModelVersionService import (
    count_active_versions,
    load_feature_schema,
    load_training_report,
    normalize_artifact_path,
    register_model_version,
    validate_artifact_path,
    validate_feature_schema,
    validate_training_report,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Register a trained Entervene model artifact in ai_model_version.")
    parser.add_argument("--training-report", required=True, type=Path)
    parser.add_argument("--feature-schema", required=True, type=Path)
    parser.add_argument("--artifact-path", required=True, type=Path)
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--activate", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = load_training_report(args.training_report)
    schema = load_feature_schema(args.feature_schema)
    validate_training_report(report)
    validate_feature_schema(schema)
    validate_artifact_path(args.artifact_path)

    if report["model_name"] != args.model_name:
        raise ValueError(
            f"Model name mismatch: report has {report['model_name']}, CLI received {args.model_name}"
        )

    stored_artifact_path = normalize_artifact_path(args.artifact_path)
    db = SessionLocal()
    try:
        version, deactivated_count, created = register_model_version(
            db=db,
            report=report,
            schema=schema,
            artifact_path=stored_artifact_path,
            activate=args.activate,
        )
        active_count = count_active_versions(db, version.model_name, version.model_type)
        print("AI model version registration summary")
        print(f"model_version_id: {version.model_version_id}")
        print(f"model_name: {version.model_name}")
        print(f"model_type: {version.model_type}")
        print(f"algorithm: {version.algorithm}")
        print(f"artifact_path: {version.artifact_path}")
        print(f"training_row_count: {version.training_row_count}")
        print(f"test_row_count: {version.test_row_count}")
        print(f"mae: {version.mae}")
        print(f"rmse: {version.rmse}")
        print(f"r2_score: {version.r2_score}")
        print(f"is_active: {version.is_active}")
        print(f"created_new_row: {created}")
        print(f"deactivated_previous_active_versions: {deactivated_count}")
        print(f"active_versions_for_model: {active_count}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
