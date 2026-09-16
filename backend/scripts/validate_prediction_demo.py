"""Run the Grade 7 prediction demo validation against an isolated demo database."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.ai.AIPrediction import AIPrediction
from app.models.attendance.Attendance import AttendanceRecord
from app.models.people.Student import Student
from app.services.prediction.PredictionFeatureBuilderService import build_prediction_features_from_records
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction
from app.services.prediction.PredictionPersistenceService import score_and_persist_prediction
from app.services.prediction.PredictionReadService import get_prediction_detail
from scripts.prediction_demo_fixture import LABEL_PREFIX, MANIFEST_DIR, SCOPES, require_demo_database, write_manifest


def canonical_hash(payload: dict[str, Any] | None) -> str:
    encoded = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def report_path(run_id: str) -> Path:
    return MANIFEST_DIR / f"{run_id}.validation.json"


def compact(built: dict[str, Any]) -> dict[str, Any]:
    features = built["features"]
    summary = built["evidence_summary"]
    return {
        "ready": built["ready"],
        "readiness_level": built["readiness_level"],
        "readiness_reasons": built.get("readiness_reasons", []),
        "completion": features.get("assessment_completion_rate"),
        "completion_state": summary.get("assessment_completion_state"),
        "coverage": features.get("data_coverage_ratio"),
        "coverage_state": summary.get("data_coverage_state"),
        "expected_count": summary.get("expected_count"),
        "completed_count": summary.get("completed_count"),
        "graded_count": summary.get("graded_count"),
        "missing_count": features.get("missing_activity_count"),
        "late_count": features.get("late_submission_count"),
        "attendance": summary.get("risk_adjusted_attendance_rate"),
        "attendance_counts": {key: summary.get(key) for key in ("attendance_total_days", "attendance_present_count", "attendance_late_count", "attendance_excused_count", "attendance_absent_count")},
        "participation": summary.get("learning_participation"),
        "source_grade": features.get("source_period_grade"),
        "source_grade_provenance": summary.get("source_grade_provenance"),
        "prediction_mode": built.get("prediction_mode"),
        "warnings": built.get("warnings", []),
    }


def validate_semantics(profile_key: str, result: dict[str, Any]) -> list[str]:
    """Assert only semantic invariants; thresholds remain owned by the application."""
    errors: list[str] = []
    if result["prediction_mode"] != "CURRENT_PERIOD_PROJECTION":
        errors.append("Expected the Term 1 fixture to use CURRENT_PERIOD_PROJECTION.")
    if profile_key == "zero_completion":
        if result["completion_state"] != "AVAILABLE":
            errors.append("Expected genuine zero completion to remain AVAILABLE.")
        if result["completion"] != 0.0:
            errors.append("Expected genuine zero completion value 0.0, never NULL.")
        if result["completed_count"] != 0 or not result["expected_count"]:
            errors.append("Expected a 0 of N completion observation.")
    if profile_key == "attempt_unresolved" and result["completion_state"] != "UNRESOLVED":
        errors.append("Expected current authoritative-attempt policy to report UNRESOLVED.")
    if profile_key == "completed_ungraded":
        if result["completion"] != 1.0 or result["graded_count"] != 0:
            errors.append("Expected completed-but-ungraded work to preserve completion and zero graded observations.")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), required=os.getenv("DATABASE_URL") is None)
    parser.add_argument("--run-id", default=LABEL_PREFIX)
    parser.add_argument(
        "--replace-legacy",
        action="store_true",
        help="Replace a conflicting legacy prediction only in the isolated demo database.",
    )
    args = parser.parse_args()
    require_demo_database(args.database_url)
    manifest_file = MANIFEST_DIR / f"{args.run_id}.json"
    if not manifest_file.exists():
        raise ValueError(f"Fixture manifest not found: {manifest_file}")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    engine = create_engine(args.database_url)
    report: dict[str, Any] = {"run_id": args.run_id, "database": make_url(args.database_url).database, "profiles": {}, "failures": []}
    audited_prediction_ids: list[int] = []

    try:
        for scope_name, scope in SCOPES.items():
            with Session(engine) as session:
                students = {student.student_lrn: student for student in session.query(Student).filter(Student.student_lrn.in_(scope["profiles"])).all()}
                for lrn, profile in scope["profiles"].items():
                    student = students[lrn]
                    request_scope = {
                        "student_id": student.student_id,
                        "class_id": scope["class_id"],
                        "subject_id": scope["subject_id"],
                        "source_period_id": 1,
                        "target_period_id": 1,
                    }
                    built = build_prediction_features_from_records(session, **request_scope)
                    observed = compact(built)
                    semantic_errors = validate_semantics(profile["key"], observed)
                    profile_report: dict[str, Any] = {"scope": {key: str(value) for key, value in request_scope.items()}, "profile": profile["key"], "preview": observed, "semantic_errors": semantic_errors, "prediction_persisted": False}
                    if built["ready"]:
                        existing_ids_before = {
                            prediction_id
                            for (prediction_id,) in session.query(AIPrediction.prediction_id)
                            .filter(
                                AIPrediction.student_id == student.student_id,
                                AIPrediction.class_id == scope["class_id"],
                                AIPrediction.subject_id == scope["subject_id"],
                                AIPrediction.source_period_id == request_scope["source_period_id"],
                                AIPrediction.target_period_id == request_scope["target_period_id"],
                            )
                            .all()
                        }

                        def generate(generation_db: Session):
                            rebuilt = build_prediction_features_from_records(generation_db, **request_scope)
                            return score_and_persist_prediction(
                                generation_db,
                                {**request_scope, "features": rebuilt["features"]},
                                commit=False,
                                replace_existing=args.replace_legacy,
                                evidence_context=rebuilt,
                                generation_request_id=f"{args.run_id}:{scope_name}:{lrn}",
                            )
                        persisted = run_prediction_generation_transaction(request_scope, "entervene_next_period_grade_rf", generate, bind=engine)
                        if persisted.get("duplicate"):
                            collision = (
                                "A pre-existing prediction already occupies this source/target/model scope; "
                                "the demo will not overwrite it."
                            )
                            profile_report.update({
                                "persistence_collision": collision,
                                "existing_prediction_id": persisted["prediction_id"],
                            })
                            report["failures"].append(f"{scope_name}:{lrn}: {collision}")
                        else:
                            replaced_legacy = persisted["prediction_id"] in existing_ids_before
                            profile_report.update({
                                "prediction_persisted": True,
                                "prediction_id": persisted["prediction_id"],
                            "predicted_period_grade": persisted["predicted_period_grade"],
                                "risk_level": persisted["risk_level"],
                                "risk_score": persisted["risk_score"],
                                "legacy_prediction_replaced": replaced_legacy,
                            })
                            audited_prediction_ids.append(persisted["prediction_id"])
                            if not replaced_legacy:
                                manifest["created_ids"].setdefault("ai_prediction", []).append(persisted["prediction_id"])
                    report["profiles"][f"{scope_name}:{lrn}"] = profile_report
                    report["failures"].extend(f"{scope_name}:{lrn}: {error}" for error in semantic_errors)

        # Immutability proof: mutate one fixture attendance row, read the old
        # saved prediction, then restore the source row.  Snapshot equality is
        # tested as canonical JSON, not as an unstable whole API response.
        persisted_ids = audited_prediction_ids
        attendance_ids = manifest["created_ids"].get("attendance_record", [])
        if persisted_ids and attendance_ids:
            with Session(engine) as session:
                prediction = session.get(AIPrediction, persisted_ids[0])
                before = canonical_hash(prediction.evidence_snapshot)
                record = session.get(AttendanceRecord, attendance_ids[0])
                original_status = record.status
                record.status = "absent" if original_status != "absent" else "present"
                session.commit()
            with Session(engine) as session:
                after = canonical_hash(session.get(AIPrediction, persisted_ids[0]).evidence_snapshot)
                detail = get_prediction_detail(session, persisted_ids[0], staff_id="2026-0004", is_admin=False)
                report["snapshot_immutability"] = {
                    "snapshot_hash_before": before,
                    "snapshot_hash_after": after,
                    "unchanged": before == after,
                    "teacher_evidence_rows": len(detail.get("evidence", [])),
                }
            with Session(engine) as session:
                session.get(AttendanceRecord, attendance_ids[0]).status = original_status
                session.commit()

        manifest["validation_report"] = str(report_path(args.run_id))
        write_manifest(manifest_file, manifest)
        report["status"] = "PASS" if not report["failures"] else "SEMANTIC_FAILURES"
        report_path(args.run_id).write_text(json.dumps(report, indent=2, sort_keys=True, default=str), encoding="utf-8")
        print(json.dumps({"status": report["status"], "report": str(report_path(args.run_id)), "profiles": len(report["profiles"]), "persisted_predictions": len(manifest["created_ids"].get("ai_prediction", []))}, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
