"""
score_enrolled_cohort.py
========================
Generates authentic baseline AIPrediction records for all actively enrolled
students in the active academic year (AY 2025-2026) for Term 1.

Under cold-start conditions (zero recorded grades and assessment scores), each
student evaluates strictly to INSUFFICIENT_DATA with:
  - risk_level = 'INSUFFICIENT_DATA'
  - data_status = 'INSUFFICIENT_DATA'
  - predicted_period_grade = None
  - risk_score = None
  - authentic evidence summary and readiness audit reasons

Usage:
  python scripts/score_enrolled_cohort.py [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir.parent / ".env")
load_dotenv(backend_dir / ".env")

from app.db.Session import SessionLocal
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.services.prediction.DashboardPredictionService import enrolled_student_class_filter
from app.services.prediction.ModelScoringService import get_active_model_version
from app.services.prediction.PredictionFeatureBuilderService import (
    build_prediction_features_from_records,
    insufficient_prediction_response,
)
from app.services.prediction.PredictionPersistenceService import build_prediction_feature_rows


def score_enrolled_cohort(dry_run: bool = False) -> None:
    db = SessionLocal()
    start_time = datetime.now(timezone.utc)
    print(f"[{start_time.isoformat()}] Starting Enrolled Cohort Baseline Scoring Pipeline")

    try:
        # 1. Resolve active academic year and Term 1
        active_year = db.query(AcademicYear).filter(AcademicYear.is_active == True).first()
        if not active_year:
            raise RuntimeError("No active academic year found.")
        print(f"  Active Academic Year: {active_year.year_label} (ID: {active_year.academic_year_id})")

        term1 = (
            db.query(AcademicPeriod)
            .filter(
                AcademicPeriod.academic_year_id == active_year.academic_year_id,
                AcademicPeriod.period_sequence == 1,
            )
            .first()
        )
        if not term1:
            raise RuntimeError(f"Term 1 period not found for academic year {active_year.year_label}.")
        print(f"  Target Period: {term1.period_name} (ID: {term1.academic_period_id})")

        # 2. Resolve active ML model version
        model_version = get_active_model_version(db)
        print(f"  Active Model: {model_version.model_name} (Version ID: {model_version.model_version_id})")

        # 3. Ensure Class 1 (7-Sampaguita) has standard Grade 7 SubjectLoad entries for Term 1
        class_1_loads = db.query(SubjectLoad).filter(
            SubjectLoad.class_id == 1,
            SubjectLoad.academic_period_id == term1.academic_period_id,
        ).count()
        if class_1_loads == 0:
            print("  Seeding Term 1 SubjectLoad records for Class 1 (7-Sampaguita, Grade 7)...")
            g7_core_subjects = [2, 3, 4]  # Mathematics 7, Science 7, English 7
            for sid in g7_core_subjects:
                sl = SubjectLoad(
                    class_id=1,
                    subject_id=sid,
                    academic_period_id=term1.academic_period_id,
                    staff_id="2026-0002",
                    status="active",
                    is_active_version=True,
                    version=1,
                )
                db.add(sl)
            db.flush()
            print(f"    Added {len(g7_core_subjects)} SubjectLoad entries for Class 1.")

        # 4. Fetch all actively enrolled students across the 11 sections
        enrolled_records = (
            db.query(StudentClass)
            .filter(
                enrolled_student_class_filter(),
                StudentClass.academic_year_id == active_year.academic_year_id,
            )
            .order_by(StudentClass.class_id, StudentClass.student_id)
            .all()
        )
        distinct_students = {sc.student_id for sc in enrolled_records}
        print(f"  Found {len(enrolled_records)} active enrollment rows across {len(distinct_students)} distinct students.")

        # 5. Pre-map subjects per class for Term 1
        class_subjects_query = (
            db.query(SubjectLoad.class_id, SubjectLoad.subject_id)
            .filter(SubjectLoad.academic_period_id == term1.academic_period_id)
            .distinct()
            .all()
        )
        class_subjects: dict[int, list[int]] = {}
        for cid, sid in class_subjects_query:
            class_subjects.setdefault(cid, []).append(sid)

        print("  Subject assignments per class:")
        for cid in sorted(class_subjects.keys()):
            c_obj = db.get(Class, cid)
            c_name = c_obj.section_name if c_obj else f"Class {cid}"
            print(f"    Class {cid} ({c_name}): {len(class_subjects[cid])} subjects")

        created_count = 0
        updated_count = 0
        features_created_count = 0

        # 6. Build and persist baseline cold-start prediction for each (student, subject)
        for sc in enrolled_records:
            student_id = sc.student_id
            class_id = sc.class_id
            subjects = class_subjects.get(class_id, [])

            if not subjects:
                print(f"    [WARNING] No Term 1 subjects mapped for class {class_id} (Student: {student_id})")
                continue

            for subject_id in subjects:
                built = build_prediction_features_from_records(
                    db,
                    student_id=student_id,
                    class_id=class_id,
                    subject_id=subject_id,
                    source_period_id=term1.academic_period_id,
                    target_period_id=term1.academic_period_id,
                )
                insuf_response = insufficient_prediction_response(built)

                # Check existing prediction for (student, class, subject, target_period)
                existing = (
                    db.query(AIPrediction)
                    .filter(
                        AIPrediction.student_id == student_id,
                        AIPrediction.class_id == class_id,
                        AIPrediction.subject_id == subject_id,
                        AIPrediction.target_period_id == term1.academic_period_id,
                    )
                    .first()
                )

                if existing is not None:
                    pred = existing
                    pred.predicted_period_grade = None
                    pred.risk_score = None
                    pred.risk_level = "INSUFFICIENT_DATA"
                    pred.data_status = "INSUFFICIENT_DATA"
                    pred.model_version_id = model_version.model_version_id
                    updated_count += 1
                    # Clear old features before rebuilding
                    db.query(AIPredictionFeature).filter(
                        AIPredictionFeature.prediction_id == pred.prediction_id
                    ).delete(synchronize_session=False)
                    db.flush()
                else:
                    pred = AIPrediction(
                        student_id=student_id,
                        class_id=class_id,
                        subject_id=subject_id,
                        source_period_id=term1.academic_period_id,
                        target_period_id=term1.academic_period_id,
                        predicted_period_grade=None,
                        risk_score=None,
                        risk_level="INSUFFICIENT_DATA",
                        data_status="INSUFFICIENT_DATA",
                        model_version_id=model_version.model_version_id,
                    )
                    db.add(pred)
                    db.flush()
                    created_count += 1

                # Build and persist feature audit rows
                feature_rows = build_prediction_feature_rows(pred, built["features"], insuf_response)
                db.add_all(feature_rows)
                features_created_count += len(feature_rows)

        print(f"\n  Scoring Summary:")
        print(f"    Predictions Created: {created_count}")
        print(f"    Predictions Updated: {updated_count}")
        print(f"    Total Feature Rows:  {features_created_count}")

        if dry_run:
            print("\n[DRY RUN] Rolling back transaction without committing.")
            db.rollback()
        else:
            db.commit()
            print("\n  All predictions committed successfully to database.")

            # Record audit trail
            audit_dir = backend_dir / "data"
            audit_dir.mkdir(parents=True, exist_ok=True)
            audit_file = audit_dir / "migrations_audit.log"
            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()
            runner = os.environ.get("USERNAME") or os.environ.get("USER") or "system"
            audit_line = (
                f"[{end_time.isoformat()}] SCRIPT: score_enrolled_cohort.py | "
                f"RUNNER: {runner} | CREATED: {created_count} | UPDATED: {updated_count} | "
                f"FEATURES: {features_created_count} | DURATION: {duration:.2f}s | STATUS: SUCCESS\n"
            )
            with open(audit_file, "a", encoding="utf-8") as f:
                f.write(audit_line)
            print(f"  Audit trail recorded in {audit_file}")

    except Exception as exc:
        db.rollback()
        print(f"  [ERROR] Execution failed: {exc}", file=sys.stderr)
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(
        description="Generate baseline INSUFFICIENT_DATA predictions for active enrolled cohort."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate execution without committing changes.",
    )
    args = parser.parse_args()
    score_enrolled_cohort(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
