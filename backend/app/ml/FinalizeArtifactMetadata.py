"""
Finalize and freeze metadata for CURRENT_PERIOD_FINAL_GRADE_PROJECTION (v1).
Updates training report and feature schema with exact QA metric classification,
readiness terminology, failure classification flag, and external manifest hashes.
"""

import hashlib
import json
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parents[2] / "data" / "models"
MODEL_PREFIX = "entervene_current_period_grade_rf_v1"

MODEL_FILE = MODELS_DIR / f"{MODEL_PREFIX}.joblib"
SCHEMA_FILE = MODELS_DIR / f"{MODEL_PREFIX}_feature_schema.json"
REPORT_FILE = MODELS_DIR / f"{MODEL_PREFIX}_training_report.json"
IMPORTANCE_FILE = MODELS_DIR / f"{MODEL_PREFIX}_feature_importance.csv"
SPLIT_FILE = MODELS_DIR / f"{MODEL_PREFIX}_split_audit.json"
MANIFEST_FILE = MODELS_DIR / f"{MODEL_PREFIX}_manifest.json"


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def main():
    print("Finalizing artifact metadata...")

    schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    report = json.loads(REPORT_FILE.read_text(encoding="utf-8"))

    # Update metadata
    schema["model_purpose"] = "CURRENT_PERIOD_FINAL_GRADE_PROJECTION"
    schema["supports_failure_classification"] = False
    schema["target_semantics"] = "partial evidence from Term N -> projected final grade of Term N"
    schema["readiness_terminology"] = {
        "INSUFFICIENT_EVIDENCE": "overall_available_activity_count < 3 or not (ww_has_evidence and pt_has_evidence)",
        "LIMITED_EVIDENCE": "overall_available_activity_count == 3 and ww_has_evidence and pt_has_evidence",
        "STANDARD_READY": "overall_available_activity_count >= 4 and ww_has_evidence == 1.0 and pt_has_evidence == 1.0 and observed_component_weight_sum >= 70.0",
        "HIGH_EVIDENCE": "overall_available_activity_count >= 7 and ww_has_evidence == 1.0 and pt_has_evidence == 1.0 and qa_has_evidence == 1.0 and observed_component_weight_sum == 100.0",
    }

    report["model_purpose"] = "CURRENT_PERIOD_FINAL_GRADE_PROJECTION"
    report["supports_failure_classification"] = False
    report["target_semantics"] = "partial evidence from Term N -> projected final grade of Term N"
    report["ready_for_task_4"] = True

    # QA metric classification correction
    report["development_cv_metrics"]["qa_robustness_test"] = {
        "status": "PASS",
        "evaluation_notes": "0.1498 was an in-sample evaluation on the fitted dev model. Genuine out-of-fold dev 75% MAE is 0.7078 and held-out test 75% MAE is 0.8728.",
        "qa_present_evaluation_type": "IN_SAMPLE_DEV_FIT",
        "in_sample_dev_qa_present_mae": 0.1498,
        "out_of_fold_dev_75_mae": 0.7078,
        "held_out_test_75_mae": 0.8728,
        "qa_masked_dev_mae": 1.4829,
        "qa_masked_test_mae": 1.7697,
        "degradation_vs_in_sample_mae": 1.3331,
        "degradation_vs_oof_mae": 0.7751,
        "degradation_vs_held_out_test_mae": 0.8969,
    }

    report["readiness_terminology"] = schema["readiness_terminology"]

    # Write schema and report cleanly without self-referential hash fields
    schema_text = json.dumps(schema, indent=2, sort_keys=True)
    SCHEMA_FILE.write_text(schema_text, encoding="utf-8")

    report_text = json.dumps(report, indent=2, sort_keys=True)
    REPORT_FILE.write_text(report_text, encoding="utf-8")

    # Compute clean external hashes
    model_sha = sha256_file(MODEL_FILE)
    schema_sha = sha256_file(SCHEMA_FILE)
    report_sha = sha256_file(REPORT_FILE)
    importance_sha = sha256_file(IMPORTANCE_FILE)
    split_sha = sha256_file(SPLIT_FILE)

    manifest = {
        "model_name": "entervene_current_period_grade_rf_v1",
        "model_purpose": "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
        "model_version": "v1",
        "supports_failure_classification": False,
        "artifact_hashes": {
            "model_sha256": model_sha,
            "feature_schema_sha256": schema_sha,
            "training_report_sha256": report_sha,
            "feature_importance_sha256": importance_sha,
            "split_audit_sha256": split_sha,
        },
        "target_semantics": "partial evidence from Term N -> projected final grade of Term N",
        "training_target_range": [80.0, 100.0],
        "validated_subjects": schema["validated_subjects"] if "validated_subjects" in schema else [
            "ADVANCED_PHYSICS", "CREATIVE_TECHNOLOGY", "ELECTRONICS", "ENGLISH",
            "ICT", "MAPEH", "MATHEMATICS", "SCIENCE", "VALUES_EDUCATION"
        ],
        "validated_component_weight_patterns": schema["validated_weight_combinations"],
        "feature_counts": {
            "raw_feature_count": schema["raw_feature_count"],
            "transformed_feature_count": schema["transformed_feature_count"],
        },
        "readiness_standard_gate": schema["readiness_terminology"]["STANDARD_READY"],
    }

    manifest_text = json.dumps(manifest, indent=2, sort_keys=True)
    MANIFEST_FILE.write_text(manifest_text, encoding="utf-8")
    manifest_sha = sha256_file(MANIFEST_FILE)

    print("Manifest created successfully:")
    print(f"  Model SHA-256:     {model_sha}")
    print(f"  Schema SHA-256:    {schema_sha}")
    print(f"  Report SHA-256:    {report_sha}")
    print(f"  Manifest SHA-256:  {manifest_sha}")


if __name__ == "__main__":
    main()
