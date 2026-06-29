from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from app.ml.Train import (
    TEST_FILENAME,
    TRAIN_FILENAME,
    apply_column_mappings,
    calculate_metrics,
    detect_target_column,
    select_feature_columns,
    train_model,
    validate_numeric_features,
)


def test_target_column_detection_prefers_next_period_grade():
    assert detect_target_column(["student_id", "target_next_period_grade"]) == "target_next_period_grade"


def test_quarterly_assessment_percent_maps_to_periodical():
    df = pd.DataFrame({"quarterly_assessment_percent": [90], "target_next_period_grade": [91]})

    mapped, mappings = apply_column_mappings(df)

    assert "periodical_assessment_percent" in mapped.columns
    assert "quarterly_assessment_percent" not in mapped.columns
    assert mappings == {"quarterly_assessment_percent": "periodical_assessment_percent"}


def test_identity_and_leakage_columns_are_excluded():
    columns = [
        "student_id",
        "student_lrn",
        "learner_name",
        "source_file_name",
        "at_risk",
        "final_result",
        "date_unregistration",
        "final_grade",
        "grade_level",
        "subject_SCIENCE",
        "target_next_period_grade",
    ]

    features, excluded = select_feature_columns(columns, "target_next_period_grade")

    assert features == ["grade_level", "subject_SCIENCE"]
    assert "student_id" in excluded
    assert "student_lrn" in excluded
    assert "at_risk" in excluded
    assert "final_result" in excluded
    assert "date_unregistration" in excluded
    assert "target_next_period_grade" in excluded


def test_student_id_is_not_included_in_features():
    features, _ = select_feature_columns(["student_id", "grade_level", "target_next_period_grade"], "target_next_period_grade")

    assert "student_id" not in features
    assert features == ["grade_level"]


def test_non_numeric_feature_validation_fails_clearly():
    df = pd.DataFrame({"grade_level": [7], "bad_feature": ["not-number"]})

    with pytest.raises(ValueError, match="bad_feature"):
        validate_numeric_features(df, ["grade_level", "bad_feature"])


def test_regression_metric_calculation_works():
    metrics = calculate_metrics(pd.Series([90, 92, 94]), [91, 92, 93])

    assert metrics["mae"] == pytest.approx(2 / 3)
    assert metrics["rmse"] == pytest.approx((2 / 3) ** 0.5)
    assert "r2_score" in metrics


def _write_tiny_pack(ml_dir: Path) -> None:
    train_rows = []
    test_rows = []
    for index in range(12):
        row = {
            "row_id": f"TR-{index}",
            "student_id": f"S{index}",
            "split": "train",
            "student_lrn": f"{index:012d}",
            "grade_level": 7,
            "period_sequence": 1 + (index % 3),
            "has_previous_period": 1,
            "written_work_percent": 80 + index,
            "performance_task_percent": 81 + index,
            "quarterly_assessment_percent": 82 + index,
            "assessment_completion_rate": 1.0,
            "source_period_grade": 83 + index,
            "grade_trend_vs_previous_period": 0.5,
            "cumulative_period_grade_avg": 84 + index,
            "subject_SCIENCE": 1,
            "target_next_period_grade": 85 + index,
        }
        train_rows.append(row)
    for index in range(4):
        row = train_rows[index].copy()
        row["row_id"] = f"TE-{index}"
        row["student_id"] = f"T{index}"
        row["split"] = "test"
        row["target_next_period_grade"] = 86 + index
        test_rows.append(row)

    pd.DataFrame(train_rows).to_csv(ml_dir / TRAIN_FILENAME, index=False)
    pd.DataFrame(test_rows).to_csv(ml_dir / TEST_FILENAME, index=False)


def test_training_works_on_tiny_synthetic_csv_and_saves_artifacts(tmp_path: Path):
    ml_dir = tmp_path / "ml"
    output_dir = tmp_path / "models"
    ml_dir.mkdir()
    _write_tiny_pack(ml_dir)

    report = train_model(ml_dir, output_dir, "tiny_rf")

    assert report["ready_for_task_4"] is True
    assert report["target_column"] == "target_next_period_grade"
    assert report["training_row_count"] == 12
    assert report["test_row_count"] == 4
    assert report["student_overlap_count"] == 0
    assert "student_id" not in report["feature_columns"]
    assert "periodical_assessment_percent" in report["feature_columns"]
    assert report["column_mappings"] == {"quarterly_assessment_percent": "periodical_assessment_percent"}

    model_path = output_dir / "tiny_rf.joblib"
    report_path = output_dir / "tiny_rf_training_report.json"
    schema_path = output_dir / "tiny_rf_feature_schema.json"
    importance_path = output_dir / "tiny_rf_feature_importance.csv"
    assert model_path.exists()
    assert report_path.exists()
    assert schema_path.exists()
    assert importance_path.exists()

    saved_report = json.loads(report_path.read_text(encoding="utf-8"))
    saved_schema = json.loads(schema_path.read_text(encoding="utf-8"))
    assert saved_report["algorithm"] == "RandomForestRegressor"
    assert saved_schema["target_column"] == "target_next_period_grade"
    assert saved_schema["required_runtime_columns"]
