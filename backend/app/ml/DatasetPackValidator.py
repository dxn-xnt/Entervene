from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any


PRIVATE_IDENTITY_FILENAME = "PRIVATE_source_student_identity_map.csv"
TARGET_COLUMN = "target_next_period_grade"
PERIODICAL_COLUMN = "periodical_assessment_percent"
QUARTERLY_COLUMN = "quarterly_assessment_percent"

EXPECTED_ROW_COUNTS = {
    "00_import_manifest.csv": 12,
    "04_students_synthetic.csv": 289,
    "10_assessments.csv": 400,
    "11_student_assessment_scores.csv": 13115,
    "12_student_period_grades.csv": 1564,
    "13_student_final_grades.csv": 391,
    "14_student_subject_period_features.csv": 1564,
    "15_prototype_model_rows.csv": 1169,
    "01_training_rows_readable.csv": 1169,
    "03_random_forest_regression_train.csv": 938,
    "04_random_forest_regression_test.csv": 231,
}

ALLOWED_COMPONENT_TYPES = {
    "WRITTEN_WORK",
    "PERFORMANCE_TASK",
    "PERIODICAL_ASSESSMENT",
}
COMPONENT_TYPE_MAPPINGS = {
    "WW": "WRITTEN_WORK",
    "WRITTEN WORK": "WRITTEN_WORK",
    "WRITTEN_WORK": "WRITTEN_WORK",
    "PT": "PERFORMANCE_TASK",
    "PERFORMANCE TASK": "PERFORMANCE_TASK",
    "PERFORMANCE_TASK": "PERFORMANCE_TASK",
    "QA": "PERIODICAL_ASSESSMENT",
    "QUARTERLY ASSESSMENT": "PERIODICAL_ASSESSMENT",
    "QUARTERLY_ASSESSMENT": "PERIODICAL_ASSESSMENT",
    "PERIODICAL ASSESSMENT": "PERIODICAL_ASSESSMENT",
    "PERIODICAL_ASSESSMENT": "PERIODICAL_ASSESSMENT",
    "EXAM": "PERIODICAL_ASSESSMENT",
}

ALLOWED_SCORE_STATUSES = {
    "RECORDED",
    "MISSING_NOT_ENCODED",
    "ABSENT",
    "NOT_APPLICABLE",
}

TRACEABILITY_COLUMNS = {
    "student_id",
    "source_student_id",
    "synthetic_student_id",
    "learner_id",
    "academic_year",
    "source_period_id",
    "target_period_id",
}
NON_FEATURE_COLUMNS = {"split"}
UNSAFE_IDENTITY_TERMS = ("name", "lrn")


def discover_csv_files(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    return sorted(path for path in directory.rglob("*.csv") if path.is_file())


def read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = [{key: (value or "") for key, value in row.items()} for row in reader]
        return list(reader.fieldnames or []), rows


def safe_read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]], str | None]:
    try:
        columns, rows = read_csv_rows(path)
        return columns, rows, None
    except UnicodeDecodeError:
        try:
            with path.open("r", encoding="latin-1", newline="") as handle:
                reader = csv.DictReader(handle)
                rows = [{key: (value or "") for key, value in row.items()} for row in reader]
                return list(reader.fieldnames or []), rows, None
        except Exception as exc:  # pragma: no cover - defensive fallback
            return [], [], str(exc)
    except Exception as exc:  # pragma: no cover - defensive fallback
        return [], [], str(exc)


def find_column(columns: list[str], candidates: list[str]) -> str | None:
    normalized = {column.lower(): column for column in columns}
    for candidate in candidates:
        if candidate.lower() in normalized:
            return normalized[candidate.lower()]
    return None


def validate_required_columns(columns: list[str], required: list[str]) -> dict[str, list[str]]:
    found = [column for column in required if find_column(columns, [column]) is not None]
    missing = [column for column in required if column not in found]
    return {"found": found, "missing": missing}


def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def is_blank(value: Any) -> bool:
    return value is None or str(value).strip() == ""


def normalize_component_type(value: str) -> str:
    return COMPONENT_TYPE_MAPPINGS.get(value.strip().upper(), value.strip().upper())


def validate_assessments(columns: list[str], rows: list[dict[str, str]]) -> dict[str, Any]:
    required = ["assessment_id", "class_id", "subject_id", "academic_period_id", "component_type", "item_number", "max_score"]
    component_col = find_column(columns, ["component_type", "assessment_component", "component"])
    max_score_col = find_column(columns, ["max_score", "maximum_score", "points_possible"])
    component_values = Counter()
    invalid_components = Counter()
    bad_max_scores = 0

    for row in rows:
        if component_col:
            raw_value = row.get(component_col, "")
            mapped = normalize_component_type(raw_value)
            component_values[mapped] += 1
            if mapped not in ALLOWED_COMPONENT_TYPES:
                invalid_components[raw_value] += 1
        if max_score_col:
            max_score = parse_float(row.get(max_score_col))
            if max_score is None or max_score <= 0:
                bad_max_scores += 1

    return {
        "row_count": len(rows),
        "required_columns": validate_required_columns(columns, required),
        "component_types_found": sorted(component_values),
        "invalid_component_types": dict(invalid_components),
        "max_score_null_or_non_positive": bad_max_scores,
        "component_type_mappings_tolerated": COMPONENT_TYPE_MAPPINGS,
    }


def validate_score_statuses(rows: list[dict[str, str]], score_column: str, status_column: str) -> dict[str, Any]:
    statuses = Counter()
    invalid_statuses = Counter()
    blank_scores = 0
    numeric_zero_scores = 0
    zero_score_status_violations = 0

    for row in rows:
        status = (row.get(status_column, "") or "").strip().upper()
        statuses[status] += 1
        if status not in ALLOWED_SCORE_STATUSES:
            invalid_statuses[status] += 1

        raw_score = row.get(score_column)
        if is_blank(raw_score):
            blank_scores += 1
            continue

        score = parse_float(raw_score)
        if score == 0:
            numeric_zero_scores += 1
            if status != "RECORDED":
                zero_score_status_violations += 1

    return {
        "row_count": len(rows),
        "score_status_values_found": dict(statuses),
        "invalid_score_statuses": dict(invalid_statuses),
        "blank_scores_preserved_as_missing": blank_scores,
        "numeric_zero_scores": numeric_zero_scores,
        "zero_score_status_violations": zero_score_status_violations,
    }


def validate_student_assessment_scores(columns: list[str], rows: list[dict[str, str]]) -> dict[str, Any]:
    score_col = find_column(columns, ["raw_score", "score", "student_score"])
    status_col = find_column(columns, ["score_status", "status"])
    if not score_col or not status_col:
        return {
            "row_count": len(rows),
            "missing_required_columns": [name for name, col in {"raw_score": score_col, "score_status": status_col}.items() if not col],
        }
    return validate_score_statuses(rows, score_col, status_col)


def summarize_grade_distribution(rows: list[dict[str, str]], grade_column: str) -> dict[str, Any]:
    grades = [grade for grade in (parse_float(row.get(grade_column)) for row in rows) if grade is not None]
    missing = len(rows) - len(grades)
    buckets = Counter()
    for grade in grades:
        if grade < 75:
            buckets["below_75"] += 1
        elif grade < 80:
            buckets["75_to_79"] += 1
        elif grade < 85:
            buckets["80_to_84"] += 1
        elif grade < 90:
            buckets["85_to_89"] += 1
        else:
            buckets["90_and_above"] += 1

    return {
        "row_count": len(rows),
        "min": min(grades) if grades else None,
        "max": max(grades) if grades else None,
        "below_75_count": sum(1 for grade in grades if grade < 75),
        "below_90_count": sum(1 for grade in grades if grade < 90),
        "missing_final_period_grades": missing,
        "distribution": dict(buckets),
    }


def validate_student_period_grades(columns: list[str], rows: list[dict[str, str]]) -> dict[str, Any]:
    grade_col = find_column(columns, ["final_period_grade", "period_grade", "transmuted_grade"])
    if not grade_col:
        return {"row_count": len(rows), "missing_required_columns": ["final_period_grade"]}
    return summarize_grade_distribution(rows, grade_col)


def validate_period_ratios(rows: list[dict[str, str]], sequence_col: str, total_col: str, ratio_col: str, tolerance: float = 0.0001) -> dict[str, Any]:
    invalid_rows = 0
    missing_rows = 0
    for row in rows:
        sequence = parse_float(row.get(sequence_col))
        total = parse_float(row.get(total_col))
        ratio = parse_float(row.get(ratio_col))
        if sequence is None or total in (None, 0) or ratio is None:
            missing_rows += 1
            continue
        if not math.isclose(sequence / total, ratio, abs_tol=tolerance):
            invalid_rows += 1
    return {"invalid_ratio_rows": invalid_rows, "missing_ratio_inputs": missing_rows}


def validate_academic_periods(columns: list[str], rows: list[dict[str, str]]) -> dict[str, Any]:
    required = ["period_name", "period_type", "period_sequence", "total_periods_in_year", "period_progress_ratio", "academic_year_id"]
    sequence_col = find_column(columns, ["period_sequence"])
    total_col = find_column(columns, ["total_periods_in_year"])
    ratio_col = find_column(columns, ["period_progress_ratio"])
    period_type_col = find_column(columns, ["period_type"])
    period_types = sorted({row.get(period_type_col, "").strip().upper() for row in rows if period_type_col and row.get(period_type_col)})
    ratio_validation = (
        validate_period_ratios(rows, sequence_col, total_col, ratio_col)
        if sequence_col and total_col and ratio_col
        else {"invalid_ratio_rows": None, "missing_ratio_inputs": len(rows)}
    )
    return {
        "row_count": len(rows),
        "required_columns": validate_required_columns(columns, required),
        "period_types_found": period_types,
        "quarter_only_historical_records": period_types == ["QUARTER"],
        **ratio_validation,
    }


def validate_students(columns: list[str], rows: list[dict[str, str]]) -> dict[str, Any]:
    student_id_col = find_column(columns, ["student_id", "synthetic_student_id"])
    first_name_col = find_column(columns, ["first_name", "student_first_name"])
    last_name_col = find_column(columns, ["last_name", "student_last_name"])
    full_name_col = find_column(columns, ["student_name", "full_name", "name"])
    grade_col = find_column(columns, ["grade_level", "academic_level", "grade"])
    section_col = find_column(columns, ["section", "section_name", "class_section"])
    lrn_col = find_column(columns, ["student_lrn", "lrn"])
    ids = [row.get(student_id_col, "").strip() for row in rows] if student_id_col else []
    id_counts = Counter(id_ for id_ in ids if id_)
    duplicate_ids = sorted(id_ for id_, count in id_counts.items() if count > 1)

    def missing_name(row: dict[str, str]) -> bool:
        if full_name_col:
            return is_blank(row.get(full_name_col))
        return is_blank(row.get(first_name_col)) or is_blank(row.get(last_name_col))

    return {
        "row_count": len(rows),
        "duplicate_student_ids": duplicate_ids,
        "duplicate_student_id_count": len(duplicate_ids),
        "missing_student_ids": sum(1 for value in ids if is_blank(value)) if student_id_col else len(rows),
        "missing_names": sum(1 for row in rows if missing_name(row)),
        "missing_grade_level": sum(1 for row in rows if not grade_col or is_blank(row.get(grade_col))),
        "missing_section": sum(1 for row in rows if not section_col or is_blank(row.get(section_col))),
        "lrn_exists": lrn_col is not None,
        "synthetic_identity_warning": synthetic_identity_warning(),
    }


def synthetic_identity_warning() -> str:
    return (
        "Names and LRNs in these packs are synthetic prototype identifiers only; "
        "do not use names or LRNs as ML features."
    )


def is_traceability_column(column: str) -> bool:
    lower = column.lower()
    return lower in TRACEABILITY_COLUMNS or lower.endswith("_id") or "student_id" in lower


def is_unsafe_identity_column(column: str) -> bool:
    lower = column.lower()
    return any(term in lower for term in UNSAFE_IDENTITY_TERMS)


def feature_name_mapping(columns: list[str]) -> dict[str, str]:
    if QUARTERLY_COLUMN in columns and PERIODICAL_COLUMN not in columns:
        return {QUARTERLY_COLUMN: PERIODICAL_COLUMN}
    return {}


def rows_have_numeric_values(rows: list[dict[str, str]], columns: list[str]) -> dict[str, list[str]]:
    non_numeric: list[str] = []
    for column in columns:
        for row in rows:
            value = row.get(column)
            if is_blank(value):
                continue
            if parse_float(value) is None:
                non_numeric.append(column)
                break
    return {"non_numeric_feature_columns": sorted(non_numeric)}


def validate_student_overlap(train_rows: list[dict[str, str]], test_rows: list[dict[str, str]], student_id_column: str = "student_id") -> dict[str, Any]:
    train_ids = {row.get(student_id_column, "").strip() for row in train_rows if row.get(student_id_column, "").strip()}
    test_ids = {row.get(student_id_column, "").strip() for row in test_rows if row.get(student_id_column, "").strip()}
    overlap = sorted(train_ids & test_ids)
    return {
        "train_unique_students": len(train_ids),
        "test_unique_students": len(test_ids),
        "student_overlap_count": len(overlap),
        "student_overlap_examples": overlap[:10],
    }


def validate_ml_features(train_columns: list[str], train_rows: list[dict[str, str]], test_rows: list[dict[str, str]]) -> dict[str, Any]:
    mappings = feature_name_mapping(train_columns)
    effective_columns = [mappings.get(column, column) for column in train_columns]
    has_target = TARGET_COLUMN in train_columns
    identity_columns_present = [column for column in train_columns if is_unsafe_identity_column(column)]
    traceability_columns_present = [column for column in train_columns if is_traceability_column(column)]
    feature_columns = [
        column
        for column in train_columns
        if column != TARGET_COLUMN
        and column.lower() not in NON_FEATURE_COLUMNS
        and not is_traceability_column(column)
        and not is_unsafe_identity_column(column)
        and "final_grade" not in column.lower()
    ]
    leaked_final_grade_columns = [
        column
        for column in feature_columns
        if "final_grade" in column.lower() and column != TARGET_COLUMN
    ]
    required_concepts = [
        "grade_level",
        "period_sequence",
        "has_previous_period",
        "written_work_percent",
        "performance_task_percent",
        PERIODICAL_COLUMN,
        "assessment_completion_rate",
        "source_period_grade",
        "grade_trend_vs_previous_period",
        "cumulative_period_grade_avg",
        TARGET_COLUMN,
    ]
    missing_concepts = [
        concept
        for concept in required_concepts
        if concept not in effective_columns
    ]
    subject_one_hot_columns = [column for column in train_columns if column.lower().startswith("subject_")]
    if not subject_one_hot_columns:
        missing_concepts.append("subject one-hot columns")

    generic_period_columns = {
        column: column in train_columns
        for column in ["period_type", "total_periods_in_year", "period_progress_ratio"]
    }
    numeric_validation = rows_have_numeric_values(train_rows + test_rows, feature_columns)
    target_values = [parse_float(row.get(TARGET_COLUMN)) for row in train_rows + test_rows if TARGET_COLUMN in row]
    target_grades = [value for value in target_values if value is not None]

    return {
        "target_column_exists": has_target,
        "recommended_column_mappings": mappings,
        "missing_feature_concepts": sorted(set(missing_concepts)),
        "subject_one_hot_columns_found": subject_one_hot_columns,
        "generic_academic_period_columns": generic_period_columns,
        "identity_columns_present": identity_columns_present,
        "traceability_columns_present": traceability_columns_present,
        "student_ids_used_only_for_traceability": any("student_id" in column.lower() for column in traceability_columns_present),
        "unsafe_identity_fields_excluded_from_model_features": len(identity_columns_present) == 0,
        "final_grade_leakage_columns": leaked_final_grade_columns,
        "feature_columns_checked": feature_columns,
        **numeric_validation,
        "below_75_target_count": sum(1 for grade in target_grades if grade < 75),
    }


def decide_ready_for_task_3(
    train_exists: bool,
    test_exists: bool,
    ml_feature_validation: dict[str, Any],
    overlap_validation: dict[str, Any],
) -> bool:
    return all(
        [
            train_exists,
            test_exists,
            ml_feature_validation.get("target_column_exists") is True,
            overlap_validation.get("student_overlap_count") == 0,
            ml_feature_validation.get("unsafe_identity_fields_excluded_from_model_features") is True,
            not ml_feature_validation.get("non_numeric_feature_columns"),
            not [
                missing
                for missing in ml_feature_validation.get("missing_feature_concepts", [])
                if missing not in {"periodical_assessment_percent", "period_type", "total_periods_in_year", "period_progress_ratio"}
            ],
        ]
    )


def collect_directory_metadata(directory: Path) -> tuple[dict[str, int | None], dict[str, list[str]], dict[str, str]]:
    row_counts: dict[str, int | None] = {}
    columns_per_file: dict[str, list[str]] = {}
    read_errors: dict[str, str] = {}
    for csv_path in discover_csv_files(directory):
        filename = csv_path.name
        if filename == PRIVATE_IDENTITY_FILENAME:
            row_counts[filename] = None
            columns_per_file[filename] = []
            continue
        columns, rows, error = safe_read_csv_rows(csv_path)
        row_counts[filename] = len(rows)
        columns_per_file[filename] = columns
        if error:
            read_errors[filename] = error
    return row_counts, columns_per_file, read_errors


def compare_expected_totals(row_counts: dict[str, int | None]) -> dict[str, Any]:
    comparisons = {}
    for filename, expected in EXPECTED_ROW_COUNTS.items():
        if filename in row_counts and row_counts[filename] is not None:
            actual = row_counts[filename]
            comparisons[filename] = {
                "expected": expected,
                "actual": actual,
                "matches": actual == expected,
            }
    return comparisons


def run_validation(normalized_dir: Path, ml_dir: Path, output_dir: Path) -> dict[str, Any]:
    warnings: list[str] = []
    normalized_counts, normalized_columns, normalized_errors = collect_directory_metadata(normalized_dir)
    ml_counts, ml_columns, ml_errors = collect_directory_metadata(ml_dir)
    row_counts = {**normalized_counts, **ml_counts}
    columns_per_file = {**normalized_columns, **ml_columns}
    files_found = {
        "normalized": sorted(path.name for path in discover_csv_files(normalized_dir)),
        "ml": sorted(path.name for path in discover_csv_files(ml_dir)),
    }
    private_exists = (normalized_dir / PRIVATE_IDENTITY_FILENAME).exists() or (ml_dir / PRIVATE_IDENTITY_FILENAME).exists()

    validations: dict[str, Any] = {}
    null_value_summary: dict[str, dict[str, int]] = {}
    missing_required_columns: dict[str, list[str]] = {}
    duplicate_key_findings: dict[str, Any] = {}

    for base_dir in (normalized_dir, ml_dir):
        for csv_path in discover_csv_files(base_dir):
            if csv_path.name == PRIVATE_IDENTITY_FILENAME:
                continue
            columns, rows, _ = safe_read_csv_rows(csv_path)
            null_value_summary[csv_path.name] = {
                column: sum(1 for row in rows if is_blank(row.get(column)))
                for column in columns
            }

    students_path = normalized_dir / "04_students_synthetic.csv"
    if students_path.exists():
        columns, rows, _ = safe_read_csv_rows(students_path)
        validations["students"] = validate_students(columns, rows)
        duplicate_key_findings["04_students_synthetic.csv"] = {
            "duplicate_student_id_count": validations["students"]["duplicate_student_id_count"]
        }

    assessments_path = normalized_dir / "10_assessments.csv"
    if assessments_path.exists():
        columns, rows, _ = safe_read_csv_rows(assessments_path)
        validations["assessments"] = validate_assessments(columns, rows)
        missing_required_columns["10_assessments.csv"] = validations["assessments"]["required_columns"]["missing"]

    scores_path = normalized_dir / "11_student_assessment_scores.csv"
    if scores_path.exists():
        columns, rows, _ = safe_read_csv_rows(scores_path)
        validations["student_assessment_scores"] = validate_student_assessment_scores(columns, rows)
        missing_required_columns["11_student_assessment_scores.csv"] = validations["student_assessment_scores"].get("missing_required_columns", [])

    period_grades_path = normalized_dir / "12_student_period_grades.csv"
    grade_distribution: dict[str, Any] = {}
    if period_grades_path.exists():
        columns, rows, _ = safe_read_csv_rows(period_grades_path)
        grade_distribution = validate_student_period_grades(columns, rows)
        validations["student_period_grades"] = grade_distribution
        if grade_distribution.get("below_75_count") == 0:
            warnings.append("No below-75 period-grade records found; data supports regression only, not a validated at-risk classifier.")

    periods_path = normalized_dir / "02_academic_periods.csv"
    three_term_readiness: dict[str, Any] = {}
    if periods_path.exists():
        columns, rows, _ = safe_read_csv_rows(periods_path)
        three_term_readiness = validate_academic_periods(columns, rows)
        validations["academic_periods"] = three_term_readiness
        if three_term_readiness.get("quarter_only_historical_records"):
            warnings.append("Academic period data is QUARTER-only, expected for historical records; future data should support TERM.")

    train_path = ml_dir / "03_random_forest_regression_train.csv"
    test_path = ml_dir / "04_random_forest_regression_test.csv"
    train_columns, train_rows, _ = safe_read_csv_rows(train_path) if train_path.exists() else ([], [], None)
    test_columns, test_rows, _ = safe_read_csv_rows(test_path) if test_path.exists() else ([], [], None)
    ml_feature_validation = validate_ml_features(train_columns, train_rows, test_rows) if train_path.exists() else {}
    student_id_col = find_column(train_columns, ["student_id", "synthetic_student_id"]) or "student_id"
    student_overlap_validation = validate_student_overlap(train_rows, test_rows, student_id_col) if train_path.exists() and test_path.exists() else {}
    ready = decide_ready_for_task_3(train_path.exists(), test_path.exists(), ml_feature_validation, student_overlap_validation)

    if private_exists:
        warnings.append("Private source student identity map exists; contents were not read or printed.")
    if normalized_errors or ml_errors:
        warnings.append("One or more CSV files could not be read; see read_errors.")

    report = {
        "normalized_dir": str(normalized_dir),
        "ml_dir": str(ml_dir),
        "files_found": files_found,
        "row_counts": row_counts,
        "columns_per_file": columns_per_file,
        "expected_total_comparison": compare_expected_totals(row_counts),
        "missing_required_columns": missing_required_columns,
        "duplicate_key_findings": duplicate_key_findings,
        "null_value_summary": null_value_summary,
        "grade_distribution": grade_distribution,
        "below_75_count": grade_distribution.get("below_75_count"),
        "below_90_count": grade_distribution.get("below_90_count"),
        "validations": validations,
        "ml_feature_validation": ml_feature_validation,
        "student_overlap_validation": student_overlap_validation,
        "synthetic_identity_warning": synthetic_identity_warning(),
        "private_file_warning": "Private identity map exists and was not read." if private_exists else "Private identity map not found.",
        "recommended_column_mappings": ml_feature_validation.get("recommended_column_mappings", {}),
        "three_term_readiness": three_term_readiness,
        "read_errors": {**normalized_errors, **ml_errors},
        "warnings": warnings,
        "ready_for_task_3": ready,
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "dataset_validation_report.json"
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return report


def print_summary(report: dict[str, Any]) -> None:
    print("Dataset validation summary")
    print(f"Normalized dir: {report['normalized_dir']}")
    print(f"ML dir: {report['ml_dir']}")
    print(f"Ready for Task 3: {report['ready_for_task_3']}")
    print(f"Private identity map: {report['private_file_warning']}")
    print("CSV row counts:")
    for filename, count in sorted(report["row_counts"].items()):
        print(f"  {filename}: {'private file present, not read' if count is None else count}")
    grade_distribution = report.get("grade_distribution") or {}
    print(f"Below-75 period grades: {grade_distribution.get('below_75_count')}")
    overlap = report.get("student_overlap_validation") or {}
    print(f"Train/test student overlap: {overlap.get('student_overlap_count')}")
    ml_validation = report.get("ml_feature_validation") or {}
    print(f"Recommended column mappings: {ml_validation.get('recommended_column_mappings', {})}")
    print(f"Generic academic period columns: {ml_validation.get('generic_academic_period_columns', {})}")
    if report.get("warnings"):
        print("Warnings:")
        for warning in report["warnings"]:
            print(f"  - {warning}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Entervene local dataset packs without training a model.")
    parser.add_argument("--normalized-dir", required=True, type=Path)
    parser.add_argument("--ml-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = run_validation(args.normalized_dir, args.ml_dir, args.output_dir)
    print_summary(report)


if __name__ == "__main__":
    main()
