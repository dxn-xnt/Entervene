from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from app.ml.BuildCurrentPeriodProjectionDataset import ANOMALIES_FILE, OUTPUT_DIR, RAW_DIR, SHEET_AUDIT_FILE
    from app.ml.EClassRecordRawParser import EClassRecordRawParser, dataclass_rows, write_csv
except ModuleNotFoundError:  # pragma: no cover - direct script execution
    from BuildCurrentPeriodProjectionDataset import ANOMALIES_FILE, OUTPUT_DIR, RAW_DIR, SHEET_AUDIT_FILE
    from EClassRecordRawParser import EClassRecordRawParser, dataclass_rows, write_csv

AUDIT_SUMMARY_FILE = "raw_eclass_audit_summary.json"
REMOVED_ROWS_FILE = "removed_rows.csv"


def audit_records(raw_dir: Path = RAW_DIR, output_dir: Path = OUTPUT_DIR) -> dict[str, object]:
    parser = EClassRecordRawParser()
    rows = parser.parse_directory(raw_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(output_dir / SHEET_AUDIT_FILE, dataclass_rows(parser.sheet_audits))
    write_csv(output_dir / ANOMALIES_FILE, dataclass_rows(parser.anomalies))
    write_csv(output_dir / REMOVED_ROWS_FILE, dataclass_rows(parser.removed_rows))
    status_counts: dict[str, int] = {}
    grading_status_counts: dict[str, int] = {}
    for audit in parser.sheet_audits:
        status_counts[audit.status] = status_counts.get(audit.status, 0) + 1
        if audit.reason != "NOT_A_GRADING_PERIOD_SHEET" and audit.sheet_name != "<workbook>":
            grading_status_counts[audit.status] = grading_status_counts.get(audit.status, 0) + 1
    summary = {
        "raw_dir": str(raw_dir),
        "workbooks_seen": len(list(raw_dir.glob("*.xlsx"))),
        "sheets_audited": len(parser.sheet_audits),
        "sheet_status_counts_all_sheets": status_counts,
        "grading_period_sheet_status_counts": grading_status_counts,
        "snapshot_rows_that_would_be_created": len(rows),
        "student_periods_that_would_be_created": len({row["student_period_key"] for row in rows}),
        "anomaly_count": len(parser.anomalies),
        "removed_row_count": len(parser.removed_rows),
    }
    (output_dir / AUDIT_SUMMARY_FILE).write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    return summary


def main() -> None:
    arg_parser = argparse.ArgumentParser(description="Audit raw E-Class Record workbooks for current-period projection dataset readiness.")
    arg_parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    arg_parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = arg_parser.parse_args()
    print(json.dumps(audit_records(args.raw_dir, args.output_dir), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

