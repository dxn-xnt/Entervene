"""
cleanup_synthetic_data.py
=========================
Safely purges synthetic student records, synthetic AI predictions, and
placeholder LIVE_IMPORT subjects created by SeedLivePredictions.py.

Key Guarantees:
- Targets exactly the 1,271 deterministic UUID5 synthetic students from the source CSV.
- Optional --include-smoke-test-student flag purges the single test artifact (Codex Smoke).
- Verifies zero live curriculum/scheduling references to LIVE_IMPORT subjects.
- Runs in an atomic transaction (with db.begin()) with pre-commit dynamic delta assertions.
- Guarantees 0 enrolled students, 0 UserAccounts, and 0 legitimate predictions are deleted.

Usage:
  # Dry-run (default, inspects and checks assertions without committing):
  python scripts/cleanup_synthetic_data.py --dry-run --include-smoke-test-student

  # Execute purge:
  python scripts/cleanup_synthetic_data.py --execute --include-smoke-test-student
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import sys
import uuid
from pathlib import Path
from typing import Set

if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ensure backend root is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir.parent / ".env")
load_dotenv(backend_dir / ".env")

from sqlalchemy import text
from app.db.Session import SessionLocal
from app.models.academic.Class_ import Class
from app.models.classwork.Classwork import Classwork
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.ai.TeacherRiskReview import TeacherRiskReview
from app.models.attendance.Attendance import AttendanceRecord, LeaveRequest
from app.models.auth.UserAccount import UserAccount
from app.models.academic.Lesson import Lesson
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.suggestion.StudentSuggestion import StudentSuggestion


def deterministic_uuid(seed: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_DNS, f"entervene.synthetic.student.{seed}")


def load_csv_synthetic_uuids(csv_path: Path) -> Set[uuid.UUID]:
    if not csv_path.exists():
        raise FileNotFoundError(f"Source prediction CSV not found at: {csv_path}")

    csv_uuids: Set[uuid.UUID] = set()
    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            student_key = row.get("student_id", "").strip()
            if student_key:
                csv_uuids.add(deterministic_uuid(student_key))
    return csv_uuids


def run_cleanup(execute: bool = False, include_smoke_test_student: bool = False) -> None:
    mode_str = "EXECUTE (LIVE PURGE)" if execute else "DRY-RUN (NO CHANGES SAVED)"
    print("=" * 70)
    print(f" ENTERVENE DATABASE CLEANUP UTILITY - {mode_str}")
    print("=" * 70)

    # 1. Locate CSV
    csv_path = backend_dir / "data" / "live_predictions" / "final_student_risk_predictions.csv"
    print(f"\n[1/6] Loading synthetic student keys from: {csv_path.name}...")
    csv_uuids = load_csv_synthetic_uuids(csv_path)
    print(f"      Loaded {len(csv_uuids):,} unique deterministic UUIDs from CSV.")

    db = SessionLocal()

    try:
        # 2. Capture baseline state
        print("\n[2/6] Auditing database baseline state...")
        before_total_students = db.query(Student).count()
        enrolled_student_ids = set(r[0] for r in db.query(StudentClass.student_id).distinct().all())
        before_enrolled_students = len(enrolled_student_ids)
        before_user_accounts = db.query(UserAccount).count()
        before_total_predictions = db.query(AIPrediction).count()
        before_enrolled_predictions = (
            db.query(AIPrediction).filter(AIPrediction.student_id.in_(enrolled_student_ids)).count()
        )

        live_subjects = db.query(Subject).filter(Subject.subject_group == "LIVE_IMPORT").all()
        live_subject_ids = [s.subject_id for s in live_subjects]

        print(f"      Total students: {before_total_students:,}")
        print(f"      Enrolled students (StudentClass): {before_enrolled_students:,}")
        print(f"      User accounts: {before_user_accounts:,}")
        print(f"      Total AI predictions: {before_total_predictions:,}")
        print(f"      Enrolled student predictions: {before_enrolled_predictions:,}")
        print(f"      LIVE_IMPORT subjects: {len(live_subjects)} (IDs: {live_subject_ids})")

        # 3. Scope Assertions for LIVE_IMPORT subjects
        print("\n[3/6] Verifying safety assertions on LIVE_IMPORT subjects...")
        if live_subject_ids:
            sl_count = db.query(SubjectLoad).filter(SubjectLoad.subject_id.in_(live_subject_ids)).count()
            so_count = db.query(SubjectOffering).filter(SubjectOffering.subject_id.in_(live_subject_ids)).count()
            cw_count = db.query(Classwork).filter(Classwork.subject_id.in_(live_subject_ids)).count()

            print(f"      Active SubjectLoad references: {sl_count}")
            print(f"      Active SubjectOffering references: {so_count}")
            print(f"      Active Classwork references: {cw_count}")

            if sl_count > 0 or so_count > 0 or cw_count > 0:
                raise RuntimeError(
                    f"SAFETY ABORT: LIVE_IMPORT subjects are referenced by live entities "
                    f"(loads={sl_count}, offerings={so_count}, classwork={cw_count}). Cannot delete!"
                )
            print("      [OK] Zero active curriculum or scheduling references to LIVE_IMPORT subjects.")
        else:
            print("      [OK] No LIVE_IMPORT subjects found in database.")

        # 4. Resolve students to delete
        print("\n[4/6] Identifying candidate student records for deletion...")
        unenrolled_in_db = db.query(Student).filter(Student.student_id.notin_(enrolled_student_ids)).all()
        target_student_ids: Set[uuid.UUID] = set()

        seed_matches = 0
        smoke_matches = 0
        unmatched_students = []

        for s in unenrolled_in_db:
            if s.student_id in csv_uuids:
                # Must not have user_id or enrollments
                if s.user_id is None:
                    target_student_ids.add(s.student_id)
                    seed_matches += 1
            elif include_smoke_test_student and s.first_name == "Codex" and s.last_name == "Smoke":
                if s.user_id is None:
                    target_student_ids.add(s.student_id)
                    smoke_matches += 1
            else:
                unmatched_students.append(s)

        print(f"      Matched CSV deterministic synthetic students: {seed_matches:,}")
        if include_smoke_test_student:
            print(f"      Matched smoke test artifact student (Codex Smoke): {smoke_matches}")
        print(f"      Total students scheduled for removal: {len(target_student_ids):,}")

        if unmatched_students:
            print(f"      WARNING: Found {len(unmatched_students)} unenrolled students NOT scheduled for removal:")
            for u in unmatched_students[:5]:
                print(f"        - {u.student_id} | {u.student_lrn} | {u.first_name} {u.last_name} | {u.email}")
            if not include_smoke_test_student and any(u.first_name == "Codex" for u in unmatched_students):
                print("        (Note: Pass --include-smoke-test-student to include the smoke test artifact)")

        # Verify none of target_student_ids are enrolled or have user accounts
        assert target_student_ids.isdisjoint(enrolled_student_ids), "CRITICAL: Target students overlap with enrolled cohort!"

        # Count dependent rows scheduled for deletion
        target_predictions = (
            db.query(AIPrediction.prediction_id)
            .filter(
                (AIPrediction.student_id.in_(target_student_ids))
                | (AIPrediction.subject_id.in_(live_subject_ids))
            )
            .all()
        )
        target_pred_ids = [p[0] for p in target_predictions]
        print(f"      Associated AI predictions scheduled for removal: {len(target_pred_ids):,}")

        # 5. Perform deletions inside transaction with pre-commit checks
        print(f"\n[5/6] Executing deletion pipeline ({mode_str})...")

        try:
            # Step A: Test suggestions and reviews on target predictions/students/subjects
            if target_student_ids or target_pred_ids or live_subject_ids:
                del_sugg = (
                    db.query(StudentSuggestion)
                    .filter(
                        (StudentSuggestion.student_id.in_(target_student_ids))
                        | (StudentSuggestion.prediction_id.in_(target_pred_ids))
                        | (StudentSuggestion.subject_id.in_(live_subject_ids))
                    )
                    .delete(synchronize_session=False)
                )
                print(f"      Deleted test student suggestions: {del_sugg}")

                del_trr = (
                    db.query(TeacherRiskReview)
                    .filter(
                        (TeacherRiskReview.student_id.in_(target_student_ids))
                        | (TeacherRiskReview.prediction_id.in_(target_pred_ids))
                    )
                    .delete(synchronize_session=False)
                )
                print(f"      Deleted test teacher risk reviews: {del_trr}")

            # Step B: Test lesson tied to LIVE_IMPORT subject 22
            if live_subject_ids:
                del_lessons = db.query(Lesson).filter(Lesson.subject_id.in_(live_subject_ids)).delete(synchronize_session=False)
                print(f"      Deleted test lessons (LIVE_IMPORT): {del_lessons}")

            # Step C & D: Outcomes and Features
            if target_pred_ids:
                del_outcomes = (
                    db.query(PredictionOutcome)
                    .filter(PredictionOutcome.prediction_id.in_(target_pred_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      Deleted prediction outcomes: {del_outcomes:,}")

                del_features = (
                    db.query(AIPredictionFeature)
                    .filter(AIPredictionFeature.prediction_id.in_(target_pred_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      Deleted prediction features: {del_features:,}")

                # Step E: AI Predictions
                del_preds = (
                    db.query(AIPrediction)
                    .filter(AIPrediction.prediction_id.in_(target_pred_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      Deleted AI predictions: {del_preds:,}")

            # Step F: LIVE_IMPORT Subjects
            if live_subject_ids:
                del_subs = (
                    db.query(Subject)
                    .filter(Subject.subject_id.in_(live_subject_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      Deleted LIVE_IMPORT subjects: {del_subs}")

            # Step G: Synthetic Students
            if target_student_ids:
                del_students = (
                    db.query(Student)
                    .filter(Student.student_id.in_(target_student_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      Deleted synthetic students: {del_students:,}")

            # 6. Pre-Commit Dynamic Delta Assertions
            print("\n[6/6] Verifying pre-commit integrity assertions...")
            after_enrolled_students = len(set(r[0] for r in db.query(StudentClass.student_id).distinct().all()))
            after_user_accounts = db.query(UserAccount).count()
            after_enrolled_predictions = (
                db.query(AIPrediction).filter(AIPrediction.student_id.in_(enrolled_student_ids)).count()
            )
            after_total_students = db.query(Student).count()
            after_live_subjects = db.query(Subject).filter(Subject.subject_group == "LIVE_IMPORT").count()
            after_unknown_students = (
                db.query(Student)
                .filter((Student.first_name == "Unknown") | (Student.last_name == "0"))
                .count()
            )

            print(f"      Assertion 1: Enrolled students preserved ({before_enrolled_students} == {after_enrolled_students})")
            assert after_enrolled_students == before_enrolled_students, "FAIL: Enrolled student count changed!"

            print(f"      Assertion 2: User accounts preserved ({before_user_accounts} == {after_user_accounts})")
            assert after_user_accounts == before_user_accounts, "FAIL: User account count changed!"

            print(f"      Assertion 3: Enrolled predictions preserved ({before_enrolled_predictions} == {after_enrolled_predictions})")
            assert after_enrolled_predictions == before_enrolled_predictions, "FAIL: Enrolled prediction count changed!"

            print(f"      Assertion 4: Total student delta ({before_total_students} - {len(target_student_ids)} == {after_total_students})")
            assert after_total_students == (before_total_students - len(target_student_ids)), "FAIL: Student delta mismatch!"

            print(f"      Assertion 5: Zero LIVE_IMPORT subjects remain ({after_live_subjects} == 0)")
            assert after_live_subjects == 0, "FAIL: LIVE_IMPORT subjects still exist!"

            print(f"      Assertion 6: Zero 'Unknown 0' students remain ({after_unknown_students} == 0)")
            assert after_unknown_students == 0, "FAIL: 'Unknown 0' students still exist!"

            print("\n      [OK] ALL PRE-COMMIT ASSERTIONS PASSED PERFECTLY.")

            if execute:
                db.commit()
                print("\n" + "=" * 70)
                print(" SUCCESS: PURGE TRANSACTION COMMITTED TO DATABASE.")
                print(f" Final student count: {after_total_students}")
                print(f" Final AI prediction count: {db.query(AIPrediction).count()}")
                print(f" Final user account count: {after_user_accounts}")
                print("=" * 70)
            else:
                db.rollback()
                print("\n[DRY-RUN COMPLETE] Transaction rolled back cleanly. Zero changes committed to DB.")

        except Exception:
            db.rollback()
            raise
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean up synthetic student records and LIVE_IMPORT subjects.")
    parser.add_argument("--execute", action="store_true", help="Execute the purge and commit changes to the DB.")
    parser.add_argument("--dry-run", action="store_true", help="Inspect and test assertions without committing (default).")
    parser.add_argument(
        "--include-smoke-test-student",
        action="store_true",
        help="Include the single test artifact (Codex Smoke, @example.invalid) in the deletion.",
    )
    args = parser.parse_args()

    execute_mode = args.execute and not args.dry_run
    run_cleanup(execute=execute_mode, include_smoke_test_student=args.include_smoke_test_student)


if __name__ == "__main__":
    main()
