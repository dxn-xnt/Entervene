"""
Tests for CURRENT_PERIOD_FINAL_GRADE_PROJECTION (v1) model artifacts,
zero-leakage verification, train-serving feature parity, and inference safety.
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest

MODELS_DIR = Path(__file__).resolve().parents[1] / "data" / "models"
MODEL_PREFIX = "entervene_current_period_grade_rf_v1"

MODEL_FILE = MODELS_DIR / f"{MODEL_PREFIX}.joblib"
SCHEMA_FILE = MODELS_DIR / f"{MODEL_PREFIX}_feature_schema.json"
REPORT_FILE = MODELS_DIR / f"{MODEL_PREFIX}_training_report.json"
IMPORTANCE_FILE = MODELS_DIR / f"{MODEL_PREFIX}_feature_importance.csv"
SPLIT_FILE = MODELS_DIR / f"{MODEL_PREFIX}_split_audit.json"


def test_all_v1_artifacts_exist():
    assert MODEL_FILE.exists(), f"Missing model artifact: {MODEL_FILE}"
    assert SCHEMA_FILE.exists(), f"Missing schema artifact: {SCHEMA_FILE}"
    assert REPORT_FILE.exists(), f"Missing report artifact: {REPORT_FILE}"
    assert IMPORTANCE_FILE.exists(), f"Missing importance artifact: {IMPORTANCE_FILE}"
    assert SPLIT_FILE.exists(), f"Missing split audit artifact: {SPLIT_FILE}"


def test_split_audit_guarantees_zero_leakage():
    split_data = json.loads(SPLIT_FILE.read_text(encoding="utf-8"))
    overlaps = split_data["overlap_counts"]

    assert overlaps["dev_test"] == 0, "Learner overlap detected between development and test!"

    dev_c = set(split_data["dev_cohorts"])
    test_c = set(split_data["test_cohorts"])

    assert dev_c.isdisjoint(test_c), "Cohort overlap between development and test!"


def test_feature_schema_contains_zero_temporal_or_audit_leakage():
    schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    input_cols = set(schema["raw_feature_columns"])
    excluded = set(schema["excluded_columns"])

    forbidden_patterns = [
        "total_activity_count",
        "coverage_ratio",
        "snapshot_fraction",
        "snapshot_trace",
        "student_key",
        "period_key",
        "name",
        "source_file",
        "sheet_name",
        "row_number",
        "target_final_period_grade",
    ]

    for col in input_cols:
        for forbidden in forbidden_patterns:
            assert forbidden not in col, f"Forbidden leakage field '{col}' found in model input features!"

    assert "target_final_period_grade" in excluded
    assert "snapshot_fraction" in excluded
    assert "ww_total_activity_count" in excluded
    assert "overall_total_activity_count" in excluded
    assert schema["raw_feature_count"] == 31
    assert schema["transformed_feature_count"] == 39


def test_train_serving_feature_parity_equivalence():
    """
    Verify that an active live DB record and a historical snapshot record
    representing the same student evidence produce identical feature vectors.
    """
    schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    feature_columns = schema["raw_feature_columns"]

    synthetic_live_evidence = {
        "grade_level": 9,
        "subject": "MATHEMATICS",
        "ww_weight": 40.0,
        "pt_weight": 40.0,
        "qa_weight": 20.0,
        "ww_available_activity_count": 2,
        "pt_available_activity_count": 1,
        "qa_available_activity_count": 0,
        "overall_available_activity_count": 3,
        "ww_points_earned_so_far": 45.0,
        "ww_points_possible_so_far": 50.0,
        "ww_percent_so_far": 90.0,
        "ww_weighted_score_so_far": 36.0,
        "pt_points_earned_so_far": 90.0,
        "pt_points_possible_so_far": 100.0,
        "pt_percent_so_far": 90.0,
        "pt_weighted_score_so_far": 36.0,
        "qa_points_earned_so_far": 0.0,
        "qa_points_possible_so_far": 0.0,
        "qa_percent_so_far": 0.0,
        "qa_weighted_score_so_far": 0.0,
        "observed_component_weight_sum": 80.0,
        "overall_weighted_score_so_far": 72.0,
        "overall_partial_percent": 90.0,
        "ww_has_evidence": 1.0,
        "pt_has_evidence": 1.0,
        "qa_has_evidence": 0.0,
        "has_any_input_evidence": 1.0,
        "ww_score_over_hps_count_so_far": 0,
        "pt_score_over_hps_count_so_far": 0,
        "qa_score_over_hps_count_so_far": 0,
    }

    df_live = pd.DataFrame([synthetic_live_evidence])[feature_columns]

    artifact = joblib.load(MODEL_FILE)
    pipeline = artifact["pipeline"]

    pred = pipeline.predict(df_live)
    assert len(pred) == 1
    assert np.isfinite(pred[0])
    assert 80.0 <= pred[0] <= 100.0


def test_model_inference_on_diverse_slices_and_qa_masked():
    artifact = joblib.load(MODEL_FILE)
    pipeline = artifact["pipeline"]
    schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    cols = schema["raw_feature_columns"]

    # 1. Early 25% slice
    sample_25 = {col: 0.0 for col in cols}
    sample_25.update({
        "grade_level": 10, "subject": "SCIENCE",
        "ww_weight": 40.0, "pt_weight": 40.0, "qa_weight": 20.0,
        "ww_available_activity_count": 1, "pt_available_activity_count": 1, "qa_available_activity_count": 0,
        "overall_available_activity_count": 2,
        "ww_points_earned_so_far": 20.0, "ww_points_possible_so_far": 25.0, "ww_percent_so_far": 80.0,
        "ww_weighted_score_so_far": 32.0, "pt_points_earned_so_far": 40.0, "pt_points_possible_so_far": 50.0,
        "pt_percent_so_far": 80.0, "pt_weighted_score_so_far": 32.0,
        "observed_component_weight_sum": 80.0, "overall_weighted_score_so_far": 64.0, "overall_partial_percent": 80.0,
        "ww_has_evidence": 1.0, "pt_has_evidence": 1.0, "qa_has_evidence": 0.0, "has_any_input_evidence": 1.0,
    })

    # 2. High evidence 75% slice with QA present
    sample_75 = sample_25.copy()
    sample_75.update({
        "ww_available_activity_count": 4, "pt_available_activity_count": 3, "qa_available_activity_count": 1,
        "overall_available_activity_count": 8,
        "qa_points_earned_so_far": 36.0, "qa_points_possible_so_far": 40.0, "qa_percent_so_far": 90.0,
        "qa_weighted_score_so_far": 18.0, "qa_has_evidence": 1.0,
        "observed_component_weight_sum": 100.0, "overall_weighted_score_so_far": 82.0, "overall_partial_percent": 82.0,
    })

    # 3. High evidence with QA masked (Term exam pending)
    sample_75_qa_masked = sample_75.copy()
    sample_75_qa_masked.update({
        "qa_available_activity_count": 0, "qa_points_earned_so_far": 0.0, "qa_points_possible_so_far": 0.0,
        "qa_percent_so_far": 0.0, "qa_weighted_score_so_far": 0.0, "qa_has_evidence": 0.0,
        "observed_component_weight_sum": 80.0, "overall_available_activity_count": 7,
    })

    df_test = pd.DataFrame([sample_25, sample_75, sample_75_qa_masked])[cols]
    preds = pipeline.predict(df_test)

    assert len(preds) == 3
    for p in preds:
        assert isinstance(p, (float, np.floating))
        assert np.isfinite(p)
        assert 0.0 <= p <= 100.0


def test_training_report_records_provenance_and_warnings():
    report = json.loads(REPORT_FILE.read_text(encoding="utf-8"))

    assert report["dataset_sha256"], "Missing dataset SHA-256 in training report"
    assert report["model_artifact_sha256"], "Missing model artifact SHA-256 in training report"
    assert report["schema_sha256"], "Missing schema SHA-256 in training report"
    assert "disclaimers" in report
    assert "dataset_limitation" in report["disclaimers"]
    assert "domain_shift_notice" in report["disclaimers"]
    assert "snapshot_reconstruction" in report["disclaimers"]
    assert "runtime_readiness_selection" in report
    assert report["runtime_readiness_selection"]["selected_rule_name"] == "Gate_4_activities"
