"""Apply Task 8 Cleanup and Fresh Predictions to Entervene_Demo.

Safely:
1. Removes CW 11 (Finley PT 4 synthetic activity, CA 11, Sub 95).
2. Defers Term Exam (CA 10) from active scored gradebook via is_published = False.
3. Preserves all 11 students, 4 competencies, 4 lessons, curriculum mappings, and Summative 1/2 scores.
4. Confirms STANDARD_READY readiness for all 11 students.
5. Generates fresh official development predictions for all 11 students using Model Version 2 (Random Forest).
6. Automatically synchronizes intervention candidates for students with predicted grade < 85.0.
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
    print("APPLYING TASK 8 CLEANUP AND FRESH PREDICTIONS TO ENTERVENE_DEMO")
    print("=" * 80)

    demo_env = dotenv_values("backend/.env.demo")
    db_url = demo_env.get("DATABASE_URL")
    if not db_url or "Entervene_Demo" not in db_url:
        raise RuntimeError(f"Safety abort: Refusing to run on unexpected database: {db_url}")

    engine = create_engine(db_url)

    with Session(engine) as db:
        dbname, user = db.execute(text("SELECT current_database(), current_user")).fetchone()
        print(f"Connected to database: '{dbname}' as user: '{user}'")
        if dbname != "Entervene_Demo":
            raise RuntimeError(f"Safety abort: Expected Entervene_Demo, got {dbname}")

        # 1. Pre-cleanup state verification
        print("\n[Step 1] Verifying pre-cleanup state in Entervene_Demo...")
        st_count = db.execute(text("SELECT count(*) FROM student s JOIN student_class sc ON s.student_id = sc.student_id WHERE sc.class_id = 1")).scalar()
        comp_count = db.execute(text("SELECT count(*) FROM competency")).scalar()
        lesson_count = db.execute(text("SELECT count(*) FROM lesson")).scalar()
        cw11_cnt = db.execute(text("SELECT count(*) FROM classwork WHERE classwork_id = 11")).scalar()
        sub95_cnt = db.execute(text("SELECT count(*) FROM student_submission WHERE submission_id = 95")).scalar()
        ca10_pub = db.execute(text("SELECT is_published FROM classwork_assignment WHERE classwork_assignment_id = 10")).scalar()

        print(f"  Students in Class 1: {st_count} (Expected: 11)")
        print(f"  Competencies: {comp_count} (Expected: 4)")
        print(f"  Lessons: {lesson_count} (Expected: 4)")
        print(f"  CW 11 exists: {cw11_cnt == 1}")
        print(f"  Submission 95 exists: {sub95_cnt == 1}")
        print(f"  CA 10 is_published: {ca10_pub}")

        assert st_count == 11, f"Expected 11 students, got {st_count}"
        assert comp_count == 4, f"Expected 4 competencies, got {comp_count}"
        assert lesson_count == 4, f"Expected 4 lessons, got {lesson_count}"

        # 2. Cleanup CW 11 (Finley PT 4)
        print("\n[Step 2] Safely removing CW 11 and Submission 95...")
        db.execute(text("DELETE FROM student_submission WHERE submission_id = 95"))
        db.execute(text("DELETE FROM classwork_assignment WHERE classwork_id = 11"))
        db.execute(text("DELETE FROM classwork WHERE classwork_id = 11"))
        db.commit()
        print("  CW 11, CA 11, and Submission 95 deleted.")

        # 3. Defer Term Exam (CA 10)
        print("\n[Step 3] Deferring Term Exam (CA 10) from active gradebook (is_published = False)...")
        db.execute(text("UPDATE classwork_assignment SET is_published = False WHERE classwork_assignment_id = 10"))
        db.commit()
        print("  CA 10 is_published set to False.")

        # 4. Verify Gradebook Presentation
        print("\n[Step 4] Verifying teacher_student_gradebook presentation...")
        book = teacher_student_gradebook(db, "DEMO-T-001", 1, 1, 1)
        cg = book.classwork[0]
        print(f"  WW headers ({len(cg.writtenWork)}): {[h.title for h in cg.writtenWork]}")
        print(f"  PT headers ({len(cg.performanceTask)}): {[h.title for h in cg.performanceTask]}")
        print(f"  QA headers ({len(cg.exams)}): {[h.title for h in cg.exams]}")
        assert len(cg.writtenWork) == 4, "Expected 4 WW headers"
        assert len(cg.performanceTask) == 3, "Expected 3 PT headers (PT 4 removed)"
        assert len(cg.exams) == 2, "Expected 2 QA headers (Term Exam deferred)"

        finley_row = next(r for r in book.studentGrades if "Finley" in r.name)
        jordan_row = next(r for r in book.studentGrades if "Jordan" in r.name)
        print(f"  Finley: WW={finley_row.writtenWork}, PT={finley_row.performanceTask}, QA={finley_row.exams}, IG={finley_row.initial_grade}, TG={finley_row.transmuted_grade}")
        print(f"  Jordan: WW={jordan_row.writtenWork}, PT={jordan_row.performanceTask}, QA={jordan_row.exams}, IG={jordan_row.initial_grade}, TG={jordan_row.transmuted_grade}")
        assert 95.0 not in (finley_row.performanceTask or []), "Finley still has 95 score!"

        # 5. Verify Readiness for all 11 students
        print("\n[Step 5] Verifying readiness for all 11 students...")
        students = (
            db.query(Student)
            .join(StudentClass, Student.student_id == StudentClass.student_id)
            .filter(StudentClass.class_id == 1, StudentClass.enrollment_status == "enrolled")
            .order_by(Student.last_name)
            .all()
        )
        assert len(students) == 11, f"Expected 11 students, got {len(students)}"

        readiness_map = {}
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
            readiness_map[s.first_name] = (ready, level, obs_weight, cnt)
            print(f"  {s.first_name:22}: ready={ready}, level={level}, weight={obs_weight}%, count={cnt}")
            assert ready is True, f"Student {s.first_name} is not ready!"
            assert level == "STANDARD_READY", f"Student {s.first_name} level is {level}!"
            assert obs_weight == 70.0, f"Student {s.first_name} observed weight is {obs_weight}!"

        # 6. Generate fresh predictions for all 11 students
        print("\n[Step 6] Generating fresh development predictions (Model Version 2)...")
        db.execute(text("DELETE FROM development_current_term_prediction WHERE class_id = 1"))
        db.execute(text("DELETE FROM intervention WHERE class_id = 1"))
        db.commit()

        model_version = db.query(AIModelVersion).filter_by(
            model_name=CORRECTED_MODEL_NAME,
            model_version_id=2
        ).first()
        assert model_version is not None, "Model version 2 not found!"

        predictions_generated = []
        for s in students:
            res = generate_and_persist_development_current_term(
                student_id=s.student_id,
                class_id=1,
                subject_id=1,
                period_id=1,
                model_version_id=model_version.model_version_id,
                bind=db.get_bind(),
            )
            predictions_generated.append((s, res))
            print(f"  Generated for {s.first_name:22}: PredID={res['prediction_id']}, Grade={res['projected_final_term_grade']}, Level={res['intervention_level']}")

        # 7. Post-persistence database audit
        print("\n[Step 7] Post-persistence verification...")
        preds = (
            db.query(DevelopmentCurrentTermPrediction)
            .filter_by(class_id=1, subject_id=1, source_period_id=1, model_version_id=2)
            .order_by(DevelopmentCurrentTermPrediction.predicted_period_grade.asc())
            .all()
        )
        print(f"  Total Persisted Predictions in Entervene_Demo: {len(preds)}")
        for p in preds:
            st = db.get(Student, p.student_id)
            print(f"    {st.first_name:22}: Grade={p.predicted_period_grade:5.2f} | Risk={p.intervention_level:15} | Basis={p.intervention_basis}")

        candidates = (
            db.query(Intervention)
            .filter_by(class_id=1, subject_id=1, academic_period_id=1)
            .order_by(Intervention.intervention_id.asc())
            .all()
        )
        print(f"\n  Total Intervention Candidates in Entervene_Demo: {len(candidates)}")
        for c in candidates:
            st = db.get(Student, c.student_id)
            diag = c.diagnosis_snapshot or {}
            print(f"    Candidate ID={c.intervention_id} for {st.first_name:20}: Status={c.status}")
            print(f"      Weakest Component: {diag.get('weakest_supported_components')}")
            print(f"      Lowest Supported Competencies: {len(diag.get('lowest_supported_competencies', []))}")
            for comp in diag.get("lowest_supported_competencies", []):
                print(f"        {comp.get('competency_code')} ({comp.get('percent')}%) - Score {comp.get('score')}/{comp.get('possible_score')}")
            print(f"      Manual Assessment Coverage Records: {len(diag.get('manual_assessment_coverage', []))}")
            for mac in diag.get("manual_assessment_coverage", []):
                print(f"        Activity: '{mac.get('title')}' -> Covered: {[cc.get('competency_code') for cc in mac.get('covered_competencies', [])]}")

    print("\n" + "=" * 80)
    print("TASK 8 CLEANUP AND PREDICTIONS APPLIED SUCCESSFULLY TO ENTERVENE_DEMO")
    print("=" * 80)

if __name__ == "__main__":
    main()
