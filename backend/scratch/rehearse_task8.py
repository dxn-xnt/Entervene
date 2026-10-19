"""Task 8 Isolated Rehearsal Script.

Performs a full dry-run of:
1. Clone Entervene_Demo -> Entervene_Demo_Rehearsal
2. Safe cleanup of CW 11 (Finley PT 4)
3. Deferral of CA 10 (Term Exam) via is_published = False
4. Gradebook output verification
5. Readiness verification for all 11 students
6. Fresh prediction generation (Model v2) for all 11 students
7. Candidate synchronization and competency evidence snapshot verification
"""

import os
import sys

sys.path.insert(0, os.path.abspath("backend"))
os.environ["ENV_FILE"] = "backend/.env.demo"

from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.models.people.Student import Student
from app.models.academic.StudentCLass import StudentClass
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term
from app.services.student_record.StudentRecordService import (
    teacher_student_gradebook,
    _classwork_assignments,
    _teacher_scope,
    _roster,
)

def main():
    print("=" * 80)
    print("STARTING TASK 8 ISOLATED REHEARSAL")
    print("=" * 80)

    demo_env = dotenv_values("backend/.env.demo")
    base_url = demo_env.get("DATABASE_URL")
    if not base_url or "Entervene_Demo" not in base_url:
        raise RuntimeError(f"Safety abort: {base_url}")

    # Use postgres maintenance connection to create clone
    admin_url = base_url.rsplit("/", 1)[0] + "/postgres"
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")

    rehearsal_db = "Entervene_Demo_Rehearsal"
    rehearsal_url = base_url.rsplit("/", 1)[0] + f"/{rehearsal_db}"

    print(f"\n1. Cloning Entervene_Demo to {rehearsal_db}...")
    with admin_engine.connect() as conn:
        conn.execute(text(f"""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname IN ('{rehearsal_db}', 'Entervene_Demo') AND pid <> pg_backend_pid();
        """))
        conn.execute(text(f"DROP DATABASE IF EXISTS \"{rehearsal_db}\";"))
        conn.execute(text(f"CREATE DATABASE \"{rehearsal_db}\" TEMPLATE \"Entervene_Demo\";"))
    print("   Clone created successfully.")

    rehearsal_engine = create_engine(rehearsal_url)

    with Session(rehearsal_engine) as db:
        # Step A: Pre-cleanup audit
        print("\n2. Pre-cleanup audit in rehearsal DB:")
        cw11_cnt = db.execute(text("SELECT count(*) FROM classwork WHERE classwork_id = 11")).scalar()
        sub95_cnt = db.execute(text("SELECT count(*) FROM student_submission WHERE submission_id = 95")).scalar()
        ca10 = db.execute(text("SELECT is_published FROM classwork_assignment WHERE classwork_assignment_id = 10")).scalar()
        print(f"   CW 11 exists: {cw11_cnt == 1}")
        print(f"   Submission 95 exists: {sub95_cnt == 1}")
        print(f"   CA 10 is_published: {ca10}")

        # Step B: Remove CW 11 (Finley PT 4)
        print("\n3. Removing CW 11 (Finley PT 4)...")
        # Submissions and assignments will cascade on delete of classwork
        db.execute(text("DELETE FROM student_submission WHERE submission_id = 95"))
        db.execute(text("DELETE FROM classwork_assignment WHERE classwork_id = 11"))
        db.execute(text("DELETE FROM classwork WHERE classwork_id = 11"))
        db.commit()

        # Step C: Defer Term Exam (CA 10)
        print("\n4. Deferring Term Exam (CA 10) by setting is_published = False...")
        db.execute(text("UPDATE classwork_assignment SET is_published = False WHERE classwork_assignment_id = 10"))
        db.commit()

        # Step D: Test gradebook service
        print("\n5. Testing teacher_student_gradebook on rehearsal DB...")
        book = teacher_student_gradebook(db, "DEMO-T-001", 1, 1, 1)
        cg = book.classwork[0]
        print(f"   WW headers count: {len(cg.writtenWork)} -> {[h.title for h in cg.writtenWork]}")
        print(f"   PT headers count: {len(cg.performanceTask)} -> {[h.title for h in cg.performanceTask]}")
        print(f"   QA/Exam headers count: {len(cg.exams)} -> {[h.title for h in cg.exams]}")

        # Check Finley
        finley_row = next(r for r in book.studentGrades if "Finley" in r.name)
        print(f"\n   Finley's Gradebook Row:")
        print(f"     WW scores: {finley_row.writtenWork} (PS={finley_row.ps_written})")
        print(f"     PT scores: {finley_row.performanceTask} (PS={finley_row.ps_performance})")
        print(f"     QA scores: {finley_row.exams} (PS={finley_row.ps_exams})")
        print(f"     Initial Grade: {finley_row.initial_grade}, Transmuted: {finley_row.transmuted_grade}")

        # Check Jordan
        jordan_row = next(r for r in book.studentGrades if "Jordan" in r.name)
        print(f"\n   Jordan's Gradebook Row:")
        print(f"     WW scores: {jordan_row.writtenWork} (PS={jordan_row.ps_written})")
        print(f"     PT scores: {jordan_row.performanceTask} (PS={jordan_row.ps_performance})")
        print(f"     QA scores: {jordan_row.exams} (PS={jordan_row.ps_exams})")
        print(f"     Initial Grade: {jordan_row.initial_grade}, Transmuted: {jordan_row.transmuted_grade}")

        # Step E: Readiness for all 11 students
        print("\n6. Verifying live readiness via CurrentPeriodFeatureBuilderService...")
        students = (
            db.query(Student)
            .join(StudentClass, Student.student_id == StudentClass.student_id)
            .filter(StudentClass.class_id == 1, StudentClass.enrollment_status == "enrolled")
            .order_by(Student.last_name)
            .all()
        )
        assert len(students) == 11, f"Expected 11 students, got {len(students)}"

        readiness_results = {}
        for s in students:
            built = build_current_period_features_from_records(db, s.student_id, 1, 1, 1)
            ready = built.get("ready")
            level = built.get("readiness_level")
            obs_weight = built.get("features", {}).get("observed_component_weight_sum")
            es = built.get("evidence_summary", {})
            ww_cnt = es.get("written_work", {}).get("count", 0)
            pt_cnt = es.get("performance_task", {}).get("count", 0)
            qa_cnt = es.get("examination", {}).get("completed_count", 0)
            cnt = ww_cnt + pt_cnt + qa_cnt
            readiness_results[s.first_name] = (ready, level, obs_weight, cnt)
            print(f"   {s.first_name:22}: ready={ready}, level={level}, weight={obs_weight}%, count={cnt} (WW={ww_cnt}, PT={pt_cnt}, QA={qa_cnt})")
            assert ready is True, f"Student {s.first_name} is not ready!"
            assert level == "STANDARD_READY", f"Student {s.first_name} level is {level}!"
            assert obs_weight == 70.0, f"Student {s.first_name} observed weight is {obs_weight}!"

        # Step F: Generate predictions for all 11 students
        print("\n7. Generating fresh predictions for all 11 students (Model Version 2)...")
        model_version = db.query(AIModelVersion).filter_by(
            model_name=CORRECTED_MODEL_NAME,
            model_version_id=2
        ).first()
        assert model_version is not None, "Model version 2 not found!"

        generated_predictions = []
        for s in students:
            res = generate_and_persist_development_current_term(
                student_id=s.student_id,
                class_id=1,
                subject_id=1,
                period_id=1,
                model_version_id=model_version.model_version_id,
                bind=db.get_bind(),
            )
            generated_predictions.append((s, res))

        print(f"   Successfully generated {len(generated_predictions)} predictions.")

        # Step G: Verify persisted predictions and candidates
        print("\n8. Verifying persisted predictions and intervention candidates...")
        preds = (
            db.query(DevelopmentCurrentTermPrediction)
            .filter_by(class_id=1, subject_id=1, source_period_id=1, model_version_id=2)
            .order_by(DevelopmentCurrentTermPrediction.predicted_period_grade.asc())
            .all()
        )
        print(f"   Total predictions in DB: {len(preds)}")
        for p in preds:
            st = db.get(Student, p.student_id)
            print(f"   {st.first_name:22}: Predicted={p.predicted_period_grade:5.2f} | Risk={p.intervention_level:15} | Basis={p.intervention_basis}")

        candidates = (
            db.query(Intervention)
            .filter_by(class_id=1, subject_id=1, academic_period_id=1)
            .order_by(Intervention.intervention_id.asc())
            .all()
        )
        print(f"\n   Total Intervention Candidates in DB: {len(candidates)}")
        for c in candidates:
            st = db.get(Student, c.student_id)
            diag = c.diagnosis_snapshot or {}
            print(f"   Candidate ID={c.intervention_id} for {st.first_name:20}: Status={c.status}")
            print(f"     Diagnosis Weakest: {diag.get('weakest_supported_components')}")
            print(f"     Diagnosis Competency targets: {len(diag.get('competency_targets', []))}")
            for ct in diag.get("competency_targets", []):
                print(f"       Target: {ct.get('competency_code')} - {ct.get('competency_title')} (Avg: {ct.get('average_score_pct')}%)")

    print("\n" + "=" * 80)
    print("TASK 8 REHEARSAL COMPLETED SUCCESSFULLY")
    print("=" * 80)

if __name__ == "__main__":
    main()
