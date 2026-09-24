import csv
import hashlib
from pathlib import Path

import openpyxl

from app.ml.BuildCurrentTermDevelopmentDataset import FEATURE_COLUMNS
from app.ml.BuildCurrentTermOfficialTargetCandidate import (
    CANDIDATE_FILE,
    LINEAGE_FILE,
    build_candidate,
)


def _write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _fixture(tmp_path: Path) -> tuple[Path, Path, Path]:
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    for sheet_name, official in (("MATH_Q1", 91), ("ICT_Q2", 92), ("MATH_Q3", None)):
        sheet = workbook.create_sheet(sheet_name)
        sheet["F1"] = "WRITTEN WORKS"
        sheet["K1"] = "PERFORMANCE TASKS"
        sheet["P1"] = "QUARTERLY ASSESSMENT"
        for activity, total, ps, ws in (("F", "G", "H", "I"), ("K", "L", "M", "N"), ("P", "Q", "R", "S")):
            sheet[f"{activity}2"] = 1
            sheet[f"{total}2"] = "TOTAL"
            sheet[f"{ps}2"] = "PS"
            sheet[f"{ws}2"] = "WS"
            sheet[f"{activity}3"] = 100
            sheet[f"{activity}13"] = 90
        sheet["B3"] = "HIGHEST POSSIBLE SCORE"
        sheet["T2"] = "INITIAL GRADE"
        sheet["U2"] = "QUARTERLY GRADE"
        sheet["U13"] = official
        sheet["B13"] = "Synthetic learner"
    workbook.save(raw_dir / "fixture.xlsx")

    source = tmp_path / "processed.csv"
    source_rows = []
    for sheet_name, target_source, target, weights in (
        ("MATH_Q1", "RECONSTRUCTED_OFFICIAL_20_50_30_TARGETS", "95", (20, 50, 30)),
        ("ICT_Q2", "HISTORICAL_OFFICIAL_20_60_20_TARGETS", "92", (20, 60, 20)),
        ("MATH_Q3", "RECONSTRUCTED_OFFICIAL_20_50_30_TARGETS", "95", (20, 50, 30)),
    ):
        source_rows.append({
            "source_workbook": "fixture.xlsx", "source_sheet": sheet_name, "row_number": "13",
            "target_source": target_source, "target_final_period_grade": target,
            "ww_weight": str(weights[0]), "pt_weight": str(weights[1]), "qa_weight": str(weights[2]),
        })
    _write_csv(source, list(source_rows[0]), source_rows)

    old = tmp_path / "old_snapshots.csv"
    old_rows = []
    for idx, source_row in enumerate(source_rows):
        for fraction in ("0.25", "0.5", "0.75"):
            row = {column: "0.0" for column in FEATURE_COLUMNS}
            row.update({
                "row_identity": f"period-{idx}::{fraction}",
                "raw_student_key": f"pseudonymous-student-{idx}",
                "student_period_key": f"pseudonymous-period-{idx}",
                "source_file": "fixture.xlsx", "sheet_name": source_row["source_sheet"],
                "row_number": "13", "school_year": "2023-2024",
                "grade_level": "9.0", "subject": "ICT" if idx == 1 else "MATHEMATICS",
                "target_final_period_grade": source_row["target_final_period_grade"],
                "target_source": source_row["target_source"], "split": "train",
                "snapshot_fraction": fraction, "weight_pattern": "20/60/20" if idx == 1 else "20/50/30",
                "period_sequence_audit": str(idx + 1),
            })
            old_rows.append(row)
    _write_csv(old, list(old_rows[0]), old_rows)
    return raw_dir, source, old


def test_official_targets_replace_reconstructed_labels_without_leakage_or_pii(tmp_path):
    raw_dir, source, old = _fixture(tmp_path)
    original_hash = hashlib.sha256(old.read_bytes()).hexdigest()
    output = tmp_path / "candidate"
    summary = build_candidate(raw_dir=raw_dir, processed_source=source, development_dataset=old, output_dir=output)
    rows = _read_csv(output / CANDIDATE_FILE)
    lineage = _read_csv(output / LINEAGE_FILE)

    assert summary["student_periods"] == 3
    assert summary["resolved_student_periods"] == 2
    assert summary["unresolved_student_periods"] == 1
    assert summary["candidate_snapshots"] == 6
    assert summary["changed_student_periods"] == 1
    assert summary["legacy_reconstruction_matches"] == 2
    assert [row["target_final_period_grade"] for row in rows] == ["91"] * 3 + ["92"] * 3
    assert {row["target_source"] for row in rows} == {"OFFICIAL_WORKBOOK_GRADE"}
    assert [row["resolution_status"] for row in lineage].count("UNRESOLVED_OFFICIAL_GRADE") == 1
    assert all(len(row["pseudonymous_period_id"]) == 64 for row in lineage)
    assert not {"learner_name", "raw_student_name", "lrn", "contact_information"}.intersection(lineage[0])
    assert "Synthetic learner" not in (output / LINEAGE_FILE).read_text(encoding="utf-8")
    assert "Synthetic learner" not in (output / CANDIDATE_FILE).read_text(encoding="utf-8")
    assert hashlib.sha256(old.read_bytes()).hexdigest() == original_hash
    assert all(row["qa_available_activity_count"] == "0.0" for row in rows if row["snapshot_fraction"] != "0.75")


def test_candidate_rebuild_is_deterministic(tmp_path):
    raw_dir, source, old = _fixture(tmp_path)
    first = tmp_path / "first"
    second = tmp_path / "second"
    one = build_candidate(raw_dir=raw_dir, processed_source=source, development_dataset=old, output_dir=first)
    two = build_candidate(raw_dir=raw_dir, processed_source=source, development_dataset=old, output_dir=second)
    assert one["candidate_sha256"] == two["candidate_sha256"]
    assert one["lineage_sha256"] == two["lineage_sha256"]
    assert (first / CANDIDATE_FILE).read_bytes() == (second / CANDIDATE_FILE).read_bytes()
    assert (first / LINEAGE_FILE).read_bytes() == (second / LINEAGE_FILE).read_bytes()
