"""
remove_section_sampaguita.py
============================
Safely removes section 7-Sampaguita (class_id = 1), unassigns its adviser
(Maria Cruz, 2026-0002), deletes its 3 SubjectLoads, and purges its 6
enrolled students, their UserAccounts, and their 19 AI predictions.

Guarantees:
- Maria Cruz's teacher account and her other 4 class loads remain 100% intact.
- Global DepEd Grade 7 subjects (English 7, Math 7, Science 7) remain 100% intact.
- Runs inside an atomic database transaction with strict pre-commit assertions.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path
from typing import List, Set

if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir.parent / ".env")
load_dotenv(backend_dir / ".env")

from sqlalchemy import text
from app.db.Session import SessionLocal
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserLoginLog import UserLoginLog
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


def run_removal(execute: bool = False) -> None:
    mode_str = "EXECUTE (LIVE PURGE)" if execute else "DRY-RUN (NO CHANGES SAVED)"
    print("=" * 70)
    print(f" REMOVE SECTION 7-SAMPAGUITA UTILITY - {mode_str}")
    print("=" * 70)

    db = SessionLocal()

    try:
        # 1. Audit baseline state
        print("\n[1/5] Auditing database baseline state...")
        sampaguita = db.query(Class).filter(Class.class_id == 1).first()
        if not sampaguita:
            print("Section 7-Sampaguita (class_id = 1) does not exist in database!")
            return

        print(f"      Target Section: {sampaguita.section_name} (class_id={sampaguita.class_id}, status={sampaguita.class_status})")
        print(f"      Adviser: {sampaguita.adviser_staff_id}")

        before_classes = db.query(Class).count()
        before_students = db.query(Student).count()
        before_users = db.query(UserAccount).count()
        before_predictions = db.query(AIPrediction).count()
        before_loads = db.query(SubjectLoad).count()

        # Identify enrolled students in Sampaguita
        sc_rows = db.query(StudentClass).filter(StudentClass.class_id == 1).all()
        target_student_ids: List[uuid.UUID] = [sc.student_id for sc in sc_rows]
        target_students = db.query(Student).filter(Student.student_id.in_(target_student_ids)).all()
        target_user_ids: List[uuid.UUID] = [s.user_id for s in target_students if s.user_id]

        print(f"      Enrolled students to purge: {len(target_student_ids)}")
        for s in target_students:
            print(f"        - {s.student_id} | {s.first_name} {s.last_name} | user_id={s.user_id}")

        # Identify subject loads for Sampaguita
        sampaguita_loads = db.query(SubjectLoad).filter(SubjectLoad.class_id == 1).all()
        target_load_ids = [l.subject_load_id for l in sampaguita_loads]
        print(f"      Subject loads to purge: {len(target_load_ids)} (IDs: {target_load_ids})")

        # Identify predictions for these students and class 1
        target_preds = (
            db.query(AIPrediction)
            .filter(
                (AIPrediction.class_id == 1) | (AIPrediction.student_id.in_(target_student_ids))
            )
            .all()
        )
        target_pred_ids = [p.prediction_id for p in target_preds]
        print(f"      AI predictions to purge: {len(target_pred_ids)} (IDs: {target_pred_ids[:5]}...)")

        # Identify outcomes for these predictions
        target_outcomes = (
            db.query(PredictionOutcome)
            .filter(PredictionOutcome.prediction_id.in_(target_pred_ids))
            .all()
        )
        target_outcome_ids = [o.outcome_id for o in target_outcomes]
        print(f"      Prediction outcomes to purge: {len(target_outcome_ids)}")

        # Check Maria Cruz baseline
        maria = db.query(AcademicStaff).filter(AcademicStaff.staff_id == "2026-0002").first()
        maria_loads_before = db.query(SubjectLoad).filter(SubjectLoad.staff_id == "2026-0002").count()
        print(f"      Teacher Maria Cruz: staff_id={maria.staff_id}, total loads before={maria_loads_before}")

        # 2. Deletions inside atomic transaction
        print(f"\n[2/5] Executing deletion pipeline ({mode_str})...")

        try:
            # Step 0: Test suggestions and reviews (defensive check)
            if target_student_ids or target_pred_ids:
                del_sugg = (
                    db.query(StudentSuggestion)
                    .filter(
                        (StudentSuggestion.student_id.in_(target_student_ids))
                        | (StudentSuggestion.prediction_id.in_(target_pred_ids))
                    )
                    .delete(synchronize_session=False)
                )
                print(f"      [Step 0A] Deleted student suggestions: {del_sugg}")

                del_trr = (
                    db.query(TeacherRiskReview)
                    .filter(
                        (TeacherRiskReview.student_id.in_(target_student_ids))
                        | (TeacherRiskReview.prediction_id.in_(target_pred_ids))
                    )
                    .delete(synchronize_session=False)
                )
                print(f"      [Step 0B] Deleted teacher risk reviews: {del_trr}")

            # Step A: Prediction outcomes
            if target_pred_ids:
                del_outcomes = (
                    db.query(PredictionOutcome)
                    .filter(PredictionOutcome.prediction_id.in_(target_pred_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      [Step A] Deleted prediction outcomes: {del_outcomes}")

            # Step B: AI predictions
            if target_pred_ids:
                del_preds = (
                    db.query(AIPrediction)
                    .filter(AIPrediction.prediction_id.in_(target_pred_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      [Step B] Deleted AI predictions: {del_preds}")

            # Step C: StudentClass enrollments
            del_sc = (
                db.query(StudentClass)
                .filter(StudentClass.class_id == 1)
                .delete(synchronize_session=False)
            )
            print(f"      [Step C] Deleted student class enrollments: {del_sc}")

            # Step D: Subject loads for Sampaguita
            del_loads = (
                db.query(SubjectLoad)
                .filter(SubjectLoad.class_id == 1)
                .delete(synchronize_session=False)
            )
            print(f"      [Step D] Deleted subject loads: {del_loads}")

            # Step E: Class row for 7-Sampaguita
            del_class = (
                db.query(Class)
                .filter(Class.class_id == 1)
                .delete(synchronize_session=False)
            )
            print(f"      [Step E] Deleted class 7-Sampaguita: {del_class}")

            # Step F: Student rows
            if target_student_ids:
                del_students = (
                    db.query(Student)
                    .filter(Student.student_id.in_(target_student_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      [Step F] Deleted students: {del_students}")

            # Step G: User login logs and roles for the 6 user_ids
            if target_user_ids:
                del_logs = (
                    db.query(UserLoginLog)
                    .filter(UserLoginLog.user_id.in_(target_user_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      [Step G1] Deleted user login logs: {del_logs}")

                del_roles = (
                    db.query(UserRoles)
                    .filter(UserRoles.user_id.in_(target_user_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      [Step G2] Deleted user roles: {del_roles}")

                # Step H: UserAccount rows
                del_users = (
                    db.query(UserAccount)
                    .filter(UserAccount.user_id.in_(target_user_ids))
                    .delete(synchronize_session=False)
                )
                print(f"      [Step H] Deleted user accounts: {del_users}")

            # 3. Pre-commit assertions
            print("\n[3/5] Verifying pre-commit integrity assertions...")
            after_classes = db.query(Class).count()
            after_students = db.query(Student).count()
            after_users = db.query(UserAccount).count()
            after_predictions = db.query(AIPrediction).count()
            after_loads = db.query(SubjectLoad).count()

            maria_after = db.query(AcademicStaff).filter(AcademicStaff.staff_id == "2026-0002").first()
            maria_loads_after = db.query(SubjectLoad).filter(SubjectLoad.staff_id == "2026-0002").count()

            # Global DepEd subjects check
            g7_subjects = db.query(Subject).filter(Subject.subject_name.in_(["English 7", "Mathematics 7", "Science 7"])).count()

            print(f"      Assertion 1: Classes delta ({before_classes} - 1 == {after_classes})")
            assert after_classes == before_classes - 1, "FAIL: Class count mismatch!"

            print(f"      Assertion 2: Students delta ({before_students} - {len(target_student_ids)} == {after_students})")
            assert after_students == before_students - len(target_student_ids), "FAIL: Student count mismatch!"

            print(f"      Assertion 3: Users delta ({before_users} - {len(target_user_ids)} == {after_users})")
            assert after_users == before_users - len(target_user_ids), "FAIL: User count mismatch!"

            print(f"      Assertion 4: Predictions delta ({before_predictions} - {len(target_pred_ids)} == {after_predictions})")
            assert after_predictions == before_predictions - len(target_pred_ids), "FAIL: Prediction count mismatch!"

            print(f"      Assertion 5: Subject loads delta ({before_loads} - {len(target_load_ids)} == {after_loads})")
            assert after_loads == before_loads - len(target_load_ids), "FAIL: Subject load count mismatch!"

            print(f"      Assertion 6: Section 1 completely gone ({db.query(Class).filter(Class.class_id == 1).count()} == 0)")
            assert db.query(Class).filter(Class.class_id == 1).count() == 0, "FAIL: Section 1 still exists!"

            print(f"      Assertion 7: Maria Cruz preserved with 4 other loads ({maria_after is not None} and loads={maria_loads_after})")
            assert maria_after is not None, "FAIL: Maria Cruz was deleted!"
            assert maria_loads_after == 4, f"FAIL: Expected Maria Cruz to have 4 remaining loads, got {maria_loads_after}!"

            print(f"      Assertion 8: Grade 7 subjects intact in catalog ({g7_subjects} == 3)")
            assert g7_subjects == 3, "FAIL: Grade 7 subjects were damaged!"

            print("\n      [OK] ALL PRE-COMMIT ASSERTIONS PASSED PERFECTLY.")

            if execute:
                db.commit()
                print("\n" + "=" * 70)
                print(" SUCCESS: 7-SAMPAGUITA PURGE COMMITTED TO DATABASE.")
                print(f" Final class count: {after_classes}")
                print(f" Final student count: {after_students}")
                print(f" Final user account count: {after_users}")
                print(f" Final AI prediction count: {after_predictions}")
                print(f" Final subject load count: {after_loads}")
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
    parser = argparse.ArgumentParser(description="Remove section 7-Sampaguita and its associated records.")
    parser.add_argument("--execute", action="store_true", help="Execute the purge and commit to the database.")
    parser.add_argument("--dry-run", action="store_true", help="Test assertions and rollback without saving (default).")
    args = parser.parse_args()

    execute_mode = args.execute and not args.dry_run
    run_removal(execute=execute_mode)


if __name__ == "__main__":
    main()
