from pathlib import Path

from app.ml.DatasetPackValidator import (
    decide_ready_for_task_3,
    discover_csv_files,
    feature_name_mapping,
    synthetic_identity_warning,
    validate_assessments,
    validate_ml_features,
    validate_required_columns,
    validate_score_statuses,
    validate_student_overlap,
    validate_period_ratios,
    summarize_grade_distribution,
)


def test_directory_csv_discovery(tmp_path: Path):
    (tmp_path / "b.csv").write_text("id\n1\n", encoding="utf-8")
    (tmp_path / "a.csv").write_text("id\n1\n", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("ignore", encoding="utf-8")

    assert [path.name for path in discover_csv_files(tmp_path)] == ["a.csv", "b.csv"]


def test_csv_column_validation():
    result = validate_required_columns(["student_id", "grade_level"], ["student_id", "section"])

    assert result == {"found": ["student_id"], "missing": ["section"]}


def test_period_progress_ratio_validation():
    rows = [
        {"period_sequence": "1", "total_periods_in_year": "4", "period_progress_ratio": "0.25"},
        {"period_sequence": "2", "total_periods_in_year": "4", "period_progress_ratio": "0.50"},
        {"period_sequence": "3", "total_periods_in_year": "4", "period_progress_ratio": "0.90"},
    ]

    result = validate_period_ratios(rows, "period_sequence", "total_periods_in_year", "period_progress_ratio")

    assert result["invalid_ratio_rows"] == 1
    assert result["missing_ratio_inputs"] == 0


def test_score_status_validation_separates_blank_and_zero_scores():
    rows = [
        {"raw_score": "0", "score_status": "RECORDED"},
        {"raw_score": "", "score_status": "MISSING_NOT_ENCODED"},
        {"raw_score": "0", "score_status": "ABSENT"},
        {"raw_score": "5", "score_status": "NOPE"},
    ]

    result = validate_score_statuses(rows, "raw_score", "score_status")

    assert result["blank_scores_preserved_as_missing"] == 1
    assert result["numeric_zero_scores"] == 2
    assert result["zero_score_status_violations"] == 1
    assert result["invalid_score_statuses"] == {"NOPE": 1}


def test_grade_distribution_summary():
    rows = [
        {"final_period_grade": "74"},
        {"final_period_grade": "75"},
        {"final_period_grade": "89"},
        {"final_period_grade": "91"},
        {"final_period_grade": ""},
    ]

    result = summarize_grade_distribution(rows, "final_period_grade")

    assert result["min"] == 74
    assert result["max"] == 91
    assert result["below_75_count"] == 1
    assert result["below_90_count"] == 3
    assert result["missing_final_period_grades"] == 1


def test_feature_name_mapping_from_quarterly_to_periodical():
    result = feature_name_mapping(["grade_level", "quarterly_assessment_percent"])

    assert result == {"quarterly_assessment_percent": "periodical_assessment_percent"}


def test_assessment_component_mapping_accepts_quarterly_assessment_underscore():
    columns = ["assessment_id", "class_id", "subject_id", "academic_period_id", "component_type", "item_number", "max_score"]
    rows = [
        {
            "assessment_id": "A1",
            "class_id": "C1",
            "subject_id": "S1",
            "academic_period_id": "P1",
            "component_type": "QUARTERLY_ASSESSMENT",
            "item_number": "1",
            "max_score": "50",
        }
    ]

    result = validate_assessments(columns, rows)

    assert result["component_types_found"] == ["PERIODICAL_ASSESSMENT"]
    assert result["invalid_component_types"] == {}


def test_ml_feature_validation_excludes_split_metadata_from_numeric_features():
    columns = [
        "split",
        "student_id",
        "grade_level",
        "period_sequence",
        "has_previous_period",
        "written_work_percent",
        "performance_task_percent",
        "quarterly_assessment_percent",
        "assessment_completion_rate",
        "source_period_grade",
        "grade_trend_vs_previous_period",
        "cumulative_period_grade_avg",
        "subject_SCIENCE",
        "target_next_period_grade",
    ]
    train_rows = [
        {
            "split": "train",
            "student_id": "S1",
            "grade_level": "7",
            "period_sequence": "1",
            "has_previous_period": "0",
            "written_work_percent": "90",
            "performance_task_percent": "91",
            "quarterly_assessment_percent": "92",
            "assessment_completion_rate": "1",
            "source_period_grade": "90",
            "grade_trend_vs_previous_period": "0",
            "cumulative_period_grade_avg": "90",
            "subject_SCIENCE": "1",
            "target_next_period_grade": "91",
        }
    ]

    result = validate_ml_features(columns, train_rows, [])

    assert "split" not in result["feature_columns_checked"]
    assert result["non_numeric_feature_columns"] == []


def test_synthetic_identity_warning_generation():
    warning = synthetic_identity_warning()

    assert "synthetic" in warning.lower()
    assert "do not use names or LRNs as ML features".lower() in warning.lower()


def test_train_test_student_overlap_validation():
    train_rows = [{"student_id": "S1"}, {"student_id": "S2"}]
    test_rows = [{"student_id": "S2"}, {"student_id": "S3"}]

    result = validate_student_overlap(train_rows, test_rows)

    assert result["train_unique_students"] == 2
    assert result["test_unique_students"] == 2
    assert result["student_overlap_count"] == 1
    assert result["student_overlap_examples"] == ["S2"]


def test_ready_not_ready_decision_logic():
    good_ml_validation = {
        "target_column_exists": True,
        "unsafe_identity_fields_excluded_from_model_features": True,
        "non_numeric_feature_columns": [],
        "missing_feature_concepts": [],
    }
    no_overlap = {"student_overlap_count": 0}

    assert decide_ready_for_task_3(True, True, good_ml_validation, no_overlap) is True
    assert decide_ready_for_task_3(False, True, good_ml_validation, no_overlap) is False
    assert decide_ready_for_task_3(
        True,
        True,
        {**good_ml_validation, "target_column_exists": False},
        no_overlap,
    ) is False
    assert decide_ready_for_task_3(
        True,
        True,
        good_ml_validation,
        {"student_overlap_count": 1},
    ) is False
