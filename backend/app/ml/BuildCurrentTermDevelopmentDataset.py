from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from app.ml.EClassRecordRawParser import (
    EClassRecordRawParser,
    SNAPSHOT_POLICY_VERSION,
    dataclass_rows,
    records_sha256,
    write_csv,
)

BACKEND_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = BACKEND_DIR / "data" / "raw_eclass_records"
SOURCE_CSV = BACKEND_DIR / "data" / "processed" / "unified_v3_official_ecr_candidate_with_tle.csv"
OUTPUT_DIR = BACKEND_DIR / "data" / "datasets" / "current_term_development"
DATASET_FILE = "current_term_development_snapshots.csv"
SUMMARY_FILE = "current_term_development_summary.json"
SHEET_AUDIT_FILE = "sheet_audit.csv"
ANOMALIES_FILE = "anomalies.csv"
REMOVED_ROWS_FILE = "removed_rows.csv"

RANDOM_SEED = 42
SUPPORTED_WEIGHT_PATTERNS = ("20/50/30", "20/60/20")
SUPPORTED_SUBJECTS = (
    "CREATIVE_TECHNOLOGY",
    "ELECTRONICS",
    "ENGLISH",
    "ICT",
    "MATHEMATICS",
    "SCIENCE",
    "VALUES_EDUCATION",
)
FEATURE_COLUMNS = (
    "grade_level",
    "ww_weight",
    "pt_weight",
    "qa_weight",
    "ww_available_activity_count",
    "pt_available_activity_count",
    "qa_available_activity_count",
    "overall_available_activity_count",
    "ww_points_earned_so_far",
    "ww_points_possible_so_far",
    "ww_percent_so_far",
    "ww_weighted_score_so_far",
    "pt_points_earned_so_far",
    "pt_points_possible_so_far",
    "pt_percent_so_far",
    "pt_weighted_score_so_far",
    "qa_points_earned_so_far",
    "qa_points_possible_so_far",
    "qa_percent_so_far",
    "qa_weighted_score_so_far",
    "observed_component_weight_sum",
    "overall_weighted_score_so_far",
    "overall_partial_percent",
    "ww_has_evidence",
    "pt_has_evidence",
    "qa_has_evidence",
    "has_any_input_evidence",
    "ww_score_over_hps_count_so_far",
    "pt_score_over_hps_count_so_far",
    "qa_score_over_hps_count_so_far",
    "subject",
)
METADATA_COLUMNS = (
    "row_identity",
    "raw_student_key",
    "student_period_key",
    "source_file",
    "sheet_name",
    "row_number",
    "school_year",
    "section",
    "historical_period_label",
    "period_sequence_audit",
    "snapshot_fraction",
    "snapshot_policy_version",
    "target_source",
    "historical_exam_semantics",
    "weight_pattern",
    "split",
)
TARGET_COLUMN = "target_final_period_grade"
SAME_PERIOD_TARGET_SOURCES = {
    "final_quarterly_grade_column",
    "RECONSTRUCTED_OFFICIAL_20_50_30_TARGETS",
    "HISTORICAL_OFFICIAL_20_60_20_TARGETS",
    "historical_ecr_derived_final_grade",
}
EXCLUDED_FEATURE_NAMES = {
    TARGET_COLUMN,
    "raw_student_key",
    "student_period_key",
    "raw_student_name",
    "row_identity",
    "source_file",
    "sheet_name",
    "target_source",
    "snapshot_fraction",
    "snapshot_trace_json",
    "period_sequence_audit",
}


@dataclass(frozen=True)
class DatasetBuildResult:
    output_dir: Path
    dataset_path: Path
    summary_path: Path
    summary: dict[str, Any]


def normalize_subject(value: Any) -> str | None:
    text = re.sub(r"[^A-Z0-9]+", "_", str(value or "").upper()).strip("_")
    if not text:
        return None
    if text in SUPPORTED_SUBJECTS:
        return text
    if text.startswith("MATH") or text in {"GENERAL_MATHEMATICS"}:
        return "MATHEMATICS"
    if "SCIENCE" in text or text in {"CON_CHEM", "CHEMISTRY"}:
        return "SCIENCE"
    if "ENGLISH" in text:
        return "ENGLISH"
    if "VALUES" in text or text == "GMRC":
        return "VALUES_EDUCATION"
    if text == "ICT":
        return "ICT"
    if "ELECTRONICS" in text:
        return "ELECTRONICS"
    if "CREATIVE" in text and "TECH" in text:
        return "CREATIVE_TECHNOLOGY"
    return None


def weight_pattern(row: dict[str, Any]) -> str | None:
    weights = []
    for key in ("ww_weight", "pt_weight", "qa_weight"):
        value = _to_float(row.get(key))
        if value is None:
            return None
        weights.append(str(int(round(value))))
    return "/".join(weights)


def build_dataset(
    raw_dir: Path = RAW_DIR,
    output_dir: Path = OUTPUT_DIR,
    *,
    source_csv: Path | None = SOURCE_CSV,
    seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    parser = EClassRecordRawParser()
    use_source_csv = (
        source_csv is not None
        and source_csv.exists()
        and raw_dir.resolve() == RAW_DIR.resolve()
    )
    parsed_rows = _load_processed_source(source_csv) if use_source_csv else parser.parse_directory(raw_dir)
    source_label = (
        "real_historical_eclass_records_official_ecr_candidate"
        if use_source_csv
        else "real_historical_eclass_records_raw_workbooks"
    )
    source_student_count = len({row["raw_student_key"] for row in parsed_rows})
    source_student_period_count = len({row["student_period_key"] for row in parsed_rows})

    exclusion_counts: Counter[str] = Counter()
    excluded_subjects: Counter[str] = Counter()
    excluded_weight_patterns: Counter[str] = Counter()
    included_rows: list[dict[str, Any]] = []

    for row in parsed_rows:
        subject = normalize_subject(row.get("subject"))
        if subject is None:
            exclusion_counts["unsupported_subject"] += 1
            excluded_subjects[str(row.get("subject") or "UNKNOWN")] += 1
            continue

        pattern = weight_pattern(row)
        if pattern not in SUPPORTED_WEIGHT_PATTERNS:
            exclusion_counts["unsupported_weight_pattern"] += 1
            excluded_weight_patterns[str(pattern or "UNKNOWN")] += 1
            continue

        if not row.get("has_any_input_evidence"):
            exclusion_counts["no_input_evidence"] += 1
            continue

        clean = _project_row(row, subject, pattern)
        included_rows.append(clean)

    splits = make_student_group_splits([row["raw_student_key"] for row in included_rows], seed=seed)
    for row in included_rows:
        row["split"] = splits[row["raw_student_key"]]

    assert_no_target_leakage(included_rows)
    assert_student_group_split(included_rows)
    assert_same_period_target(included_rows)
    assert_historical_exam_semantics(included_rows)

    output_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = output_dir / DATASET_FILE
    summary_path = output_dir / SUMMARY_FILE
    write_csv(dataset_path, included_rows)
    write_csv(output_dir / SHEET_AUDIT_FILE, dataclass_rows(parser.sheet_audits))
    write_csv(output_dir / ANOMALIES_FILE, dataclass_rows(parser.anomalies))
    write_csv(output_dir / REMOVED_ROWS_FILE, dataclass_rows(parser.removed_rows))

    summary = summarize_dataset(
        rows=included_rows,
        parsed_rows=parsed_rows,
        source_student_count=source_student_count,
        source_student_period_count=source_student_period_count,
        exclusion_counts=exclusion_counts,
        excluded_subjects=excluded_subjects,
        excluded_weight_patterns=excluded_weight_patterns,
        source_label=source_label,
        source_path=source_csv if use_source_csv else raw_dir,
        seed=seed,
    )
    summary["dataset_sha256"] = records_sha256(included_rows)
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    return summary


def make_student_group_splits(
    student_keys: Iterable[str],
    *,
    seed: int = RANDOM_SEED,
    train_ratio: float = 0.70,
    validation_ratio: float = 0.15,
) -> dict[str, str]:
    import random

    unique = sorted(set(student_keys))
    rng = random.Random(seed)
    rng.shuffle(unique)
    train_end = int(len(unique) * train_ratio)
    validation_end = train_end + int(len(unique) * validation_ratio)
    splits: dict[str, str] = {}
    for idx, key in enumerate(unique):
        if idx < train_end:
            split = "train"
        elif idx < validation_end:
            split = "validation"
        else:
            split = "test"
        splits[key] = split
    return splits


def summarize_dataset(
    *,
    rows: list[dict[str, Any]],
    parsed_rows: list[dict[str, Any]],
    source_student_count: int,
    source_student_period_count: int,
    exclusion_counts: Counter[str],
    excluded_subjects: Counter[str],
    excluded_weight_patterns: Counter[str],
    source_label: str,
    source_path: Path,
    seed: int,
) -> dict[str, Any]:
    targets = [_to_float(row[TARGET_COLUMN]) for row in rows]
    target_values = [value for value in targets if value is not None]
    split_students: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        split_students[row["split"]].add(row["raw_student_key"])
    return {
        "dataset_name": "current_term_development_snapshots",
        "development_status": "DEVELOPMENT_ONLY_NOT_PRODUCTION_VALIDATED",
        "source": source_label,
        "source_path": str(source_path),
        "historical_exam_semantics": (
            "Historical QA aggregate is used as the development analogue of the current "
            "Examination component; ST1/ST2/Term Exam are not fabricated."
        ),
        "snapshot_policy_version": SNAPSHOT_POLICY_VERSION,
        "target_column": TARGET_COLUMN,
        "feature_columns": list(FEATURE_COLUMNS),
        "feature_count": len(FEATURE_COLUMNS),
        "supported_subjects": list(SUPPORTED_SUBJECTS),
        "supported_weight_patterns": list(SUPPORTED_WEIGHT_PATTERNS),
        "excluded_weight_patterns": dict(sorted(excluded_weight_patterns.items())),
        "unsupported_subjects": dict(sorted(excluded_subjects.items())),
        "exclusion_counts": dict(sorted(exclusion_counts.items())),
        "source_student_count": source_student_count,
        "source_student_period_count": source_student_period_count,
        "parsed_snapshot_count_before_filters": len(parsed_rows),
        "snapshot_row_count": len(rows),
        "usable_student_count": len({row["raw_student_key"] for row in rows}),
        "usable_student_period_count": len({row["student_period_key"] for row in rows}),
        "grade_level_distribution": _counter(rows, "grade_level"),
        "subject_distribution": _counter(rows, "subject"),
        "grading_weight_distribution": _counter(rows, "weight_pattern"),
        "snapshot_fraction_distribution": _counter(rows, "snapshot_fraction"),
        "split_snapshot_counts": _counter(rows, "split"),
        "split_student_counts": {split: len(keys) for split, keys in sorted(split_students.items())},
        "split_seed": seed,
        "target_distribution": {
            "count": len(target_values),
            "min": _safe_round(min(target_values)) if target_values else None,
            "max": _safe_round(max(target_values)) if target_values else None,
            "mean": _safe_round(sum(target_values) / len(target_values)) if target_values else None,
            "below_75_count": sum(1 for value in target_values if value < 75),
            "count_75_to_79": sum(1 for value in target_values if 75 <= value < 80),
            "count_80_to_84": sum(1 for value in target_values if 80 <= value < 85),
            "count_85_to_89": sum(1 for value in target_values if 85 <= value < 90),
            "count_90_plus": sum(1 for value in target_values if value >= 90),
        },
        "leakage_assertions": {
            "target_not_in_features": TARGET_COLUMN not in FEATURE_COLUMNS,
            "student_identity_not_in_features": "raw_student_key" not in FEATURE_COLUMNS,
            "same_period_target": True,
            "student_group_split": True,
            "no_st1_st2_term_exam_fabrication": True,
        },
    }


def assert_no_target_leakage(rows: list[dict[str, Any]]) -> None:
    if TARGET_COLUMN in FEATURE_COLUMNS:
        raise AssertionError("target_final_period_grade must not be a model feature")
    overlap = set(FEATURE_COLUMNS) & EXCLUDED_FEATURE_NAMES
    if overlap:
        raise AssertionError(f"Leakage/meta columns in feature list: {sorted(overlap)}")
    for row in rows:
        trace = row.get("snapshot_trace_json")
        if trace is not None:
            raise AssertionError("snapshot_trace_json must not be in projected training rows")
        if any(key in row for key in ("st1_percent", "st2_percent", "term_exam_percent")):
            raise AssertionError("Historical rows must not fabricate ST1/ST2/Term Exam fields")


def assert_student_group_split(rows: list[dict[str, Any]]) -> None:
    seen: dict[str, str] = {}
    for row in rows:
        key = row["raw_student_key"]
        split = row["split"]
        prior = seen.setdefault(key, split)
        if prior != split:
            raise AssertionError(f"Student {key} appears in multiple splits: {prior}, {split}")


def assert_same_period_target(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        if row.get("target_source") not in SAME_PERIOD_TARGET_SOURCES:
            raise AssertionError("Unexpected target source; target must come from the same period final grade column")


def assert_historical_exam_semantics(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        if row.get("historical_exam_semantics") != "AGGREGATE_QA_AS_EXAM_ANALOGUE":
            raise AssertionError("Historical exam semantics marker missing")
        forbidden = {"st1_percent", "st2_percent", "term_exam_percent"}
        if forbidden & set(row):
            raise AssertionError("Historical ST1/ST2/Term Exam fields were fabricated")


def _project_row(row: dict[str, Any], subject: str, pattern: str) -> dict[str, Any]:
    projected: dict[str, Any] = {}
    projected["row_identity"] = (
        f"{row['student_period_key']}::{row['snapshot_fraction']}::{subject}::{pattern}"
    )
    for column in METADATA_COLUMNS:
        if column in {"row_identity", "historical_exam_semantics", "weight_pattern", "split"}:
            continue
        projected[column] = row.get(column)
    projected["historical_exam_semantics"] = "AGGREGATE_QA_AS_EXAM_ANALOGUE"
    projected["weight_pattern"] = pattern
    for column in FEATURE_COLUMNS:
        projected[column] = subject if column == "subject" else row.get(column)
    projected[TARGET_COLUMN] = row.get(TARGET_COLUMN)
    return projected


def _load_processed_source(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            normalized = dict(row)
            normalized["source_file"] = row.get("source_workbook") or row.get("source_file")
            normalized["sheet_name"] = row.get("source_sheet") or row.get("sheet_name")
            normalized["period_sequence_audit"] = row.get("historical_period_sequence")
            normalized["historical_period_label"] = normalized["sheet_name"]
            normalized["snapshot_fraction"] = _stage_to_fraction(row.get("prediction_stage"))
            normalized["snapshot_policy_version"] = SNAPSHOT_POLICY_VERSION
            normalized["target_source"] = row.get("target_source") or "historical_ecr_derived_final_grade"
            for key in FEATURE_COLUMNS:
                if key in normalized and key != "subject":
                    normalized[key] = _coerce_feature_value(normalized[key])
            normalized[TARGET_COLUMN] = _coerce_feature_value(normalized.get(TARGET_COLUMN))
            rows.append(normalized)
    return rows


def _stage_to_fraction(value: Any) -> float | None:
    text = str(value or "").strip().replace("%", "")
    number = _to_float(text)
    if number is None:
        return None
    return number / 100.0


def _coerce_feature_value(value: Any) -> Any:
    if value in {"", None}:
        return None
    number = _to_float(value)
    if number is None:
        return value
    return number


def _counter(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts = Counter(str(row.get(key)) for row in rows)
    return dict(sorted(counts.items()))


def _safe_round(value: float) -> float:
    return round(float(value), 4)


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the development current-term ML dataset.")
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--source-csv", type=Path, default=SOURCE_CSV)
    parser.add_argument("--use-raw-workbooks", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = parser.parse_args()
    summary = build_dataset(
        args.raw_dir,
        args.output_dir,
        source_csv=None if args.use_raw_workbooks else args.source_csv,
        seed=args.seed,
    )
    print(json.dumps({
        "dataset": str(args.output_dir / DATASET_FILE),
        "summary": str(args.output_dir / SUMMARY_FILE),
        "snapshot_row_count": summary["snapshot_row_count"],
        "usable_student_count": summary["usable_student_count"],
        "target_distribution": summary["target_distribution"],
    }, indent=2))


if __name__ == "__main__":
    main()
