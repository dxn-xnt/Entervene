from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

try:
    from app.ml.EClassRecordRawParser import (
        EClassRecordRawParser,
        dataclass_rows,
        records_sha256,
        write_csv,
    )
except ModuleNotFoundError:  # pragma: no cover - direct script execution
    from EClassRecordRawParser import EClassRecordRawParser, dataclass_rows, records_sha256, write_csv

BACKEND_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = BACKEND_DIR / "data" / "raw_eclass_records"
OUTPUT_DIR = BACKEND_DIR / "data" / "datasets" / "current_period_projection"
DATASET_FILE = "current_period_projection_snapshots.csv"
SHEET_AUDIT_FILE = "sheet_audit.csv"
ANOMALIES_FILE = "anomalies.csv"
REMOVED_ROWS_FILE = "removed_rows.csv"
SUMMARY_FILE = "dataset_summary.json"


def _target_distribution(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_period: dict[str, float] = {}
    for row in rows:
        by_period[row["student_period_key"]] = float(row["target_final_period_grade"])
    values = list(by_period.values())
    if not values:
        return {"count": 0}
    values_sorted = sorted(values)
    return {
        "count": len(values),
        "min": min(values),
        "max": max(values),
        "mean": sum(values) / len(values),
        "below_75_count": sum(1 for value in values if value < 75),
        "grade_75_to_79_count": sum(1 for value in values if 75 <= value < 80),
        "grade_80_to_84_count": sum(1 for value in values if 80 <= value < 85),
        "grade_85_to_89_count": sum(1 for value in values if 85 <= value < 90),
        "grade_90_plus_count": sum(1 for value in values if value >= 90),
        "median": values_sorted[len(values_sorted) // 2],
    }


def _summary(rows: list[dict[str, Any]], parser: EClassRecordRawParser) -> dict[str, Any]:
    sheet_status = Counter(audit.status for audit in parser.sheet_audits)
    grading_audits = [
        audit
        for audit in parser.sheet_audits
        if audit.sheet_name != "<workbook>" and audit.reason != "NOT_A_GRADING_PERIOD_SHEET"
    ]
    grading_sheet_status = Counter(audit.status for audit in grading_audits)
    workbook_status: dict[str, str] = {}
    for source_file in sorted({audit.source_file for audit in grading_audits}):
        statuses = {audit.status for audit in grading_audits if audit.source_file == source_file}
        if statuses and statuses <= {"PARSED"}:
            workbook_status[source_file] = "PARSED"
        elif statuses & {"PARSED", "PARTIAL"}:
            workbook_status[source_file] = "PARTIAL"
        else:
            workbook_status[source_file] = "SKIPPED"
    workbook_counts = Counter(workbook_status.values())
    subject_counts = Counter(row["subject"] for row in rows if row.get("snapshot_fraction") == 0.25)
    snapshots_by_fraction = Counter(str(row["snapshot_fraction"]) for row in rows)
    periods = {row["student_period_key"] for row in rows}
    learners = {row["raw_student_key"] for row in rows}
    anomaly_counts = Counter(anomaly.anomaly_type for anomaly in parser.anomalies)
    anomaly_classifications = Counter(anomaly.classification for anomaly in parser.anomalies)
    removed_reasons = Counter(row.reason for row in parser.removed_rows)
    weight_patterns = Counter(
        json.dumps(audit.weights, sort_keys=True)
        for audit in parser.sheet_audits
        if audit.status in {"PARSED", "PARTIAL"}
    )
    return {
        "dataset_name": "current_period_final_grade_projection_snapshots",
        "purpose": "partial current-period raw activity evidence to final grade of the same grading period",
        "model_training_performed": False,
        "production_prediction_behavior_changed": False,
        "snapshot_policy": "WW/PT reveal first ceil(fraction * component activity count) by component column order; QA is unavailable at 25% and 50%, and available at 75%; no actual dates are claimed.",
        "no_100_percent_snapshot": True,
        "attendance_invented": False,
        "raw_workbook_count": len({audit.source_file for audit in parser.sheet_audits if audit.source_file != "<workbook>"}),
        "workbook_status_counts": dict(workbook_counts),
        "sheet_status_counts_all_sheets": dict(sheet_status),
        "grading_period_sheet_status_counts": dict(grading_sheet_status),
        "snapshot_row_count": len(rows),
        "usable_student_period_count": len(periods),
        "usable_learner_count": len(learners),
        "snapshots_by_fraction": dict(snapshots_by_fraction),
        "subject_counts_by_student_period": dict(subject_counts),
        "target_distribution_by_student_period": _target_distribution(rows),
        "anomaly_counts": dict(anomaly_counts),
        "anomaly_classifications": dict(anomaly_classifications),
        "removed_row_reasons": dict(removed_reasons),
        "component_weight_patterns_by_sheet": dict(weight_patterns),
        "dataset_sha256": records_sha256(rows),
        "leakage_controls": [
            "target_final_period_grade is target-only",
            "completed-quarter Total/PS/WS columns excluded from snapshot feature calculations",
            "Initial Grade and Quarterly Grade columns excluded from model inputs",
            "snapshot_trace_json records included raw activity columns and excluded summary columns",
            "raw_student_key and student_period_key support grouped future train/test splitting",
        ],
        "known_training_limitations": [
            "historical quarter sheets are generic grading periods, not validated three-term equivalents",
            "activity timestamps are absent; snapshots use deterministic component column order",
            "attendance is absent from raw workbooks and is not invented",
            "below-75 final targets are too rare for reliable failing-grade prediction",
        ],
    }


def build_dataset(raw_dir: Path = RAW_DIR, output_dir: Path = OUTPUT_DIR) -> dict[str, Any]:
    parser = EClassRecordRawParser()
    rows = parser.parse_directory(raw_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(output_dir / DATASET_FILE, rows)
    write_csv(output_dir / SHEET_AUDIT_FILE, dataclass_rows(parser.sheet_audits))
    write_csv(output_dir / ANOMALIES_FILE, dataclass_rows(parser.anomalies))
    write_csv(output_dir / REMOVED_ROWS_FILE, dataclass_rows(parser.removed_rows))
    summary = _summary(rows, parser)
    (output_dir / SUMMARY_FILE).write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Build leakage-safe current-period projection snapshots from raw E-Class Records.")
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    summary = build_dataset(args.raw_dir, args.output_dir)
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

