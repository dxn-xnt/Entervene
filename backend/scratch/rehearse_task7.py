"""Rehearsal script for Task 7 Cleanup.

Runs on an isolated clone database: Entervene_Demo_Rehearsal.
Validates all constraints, foreign keys, readiness evaluator, and gradebook before touching Entervene_Demo.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.abspath("backend"))
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.student_record.StudentRecordService import teacher_student_gradebook


REHEARSAL_DB_URL = "postgresql://postgres:sphinxclub012@localhost:5432/Entervene_Demo_Rehearsal"
POSTGRES_DB_URL = "postgresql://postgres:sphinxclub012@localhost:5432/postgres"
PG_RESTORE_PATH = r"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe"
BACKUP_PATH = os.path.abspath("backend/backups/pre_task7_cleanup_20261020.dump")


def main():
    print("=" * 80)
    print("TASK 7 CLEANUP REHEARSAL ON ISOLATED CLONE")
    print("=" * 80)

    # 1. Create clean clone database
    print("\n[Step 1] Creating fresh isolated database 'Entervene_Demo_Rehearsal'...")
    pg_engine = create_engine(POSTGRES_DB_URL, isolation_level="AUTOCOMMIT")
    with pg_engine.connect() as conn:
        conn.execute(text('DROP DATABASE IF EXISTS "Entervene_Demo_Rehearsal" WITH (FORCE)'))
        conn.execute(text('CREATE DATABASE "Entervene_Demo_Rehearsal"'))
    print("Database Entervene_Demo_Rehearsal created.")

    # 2. Restore backup into clone
    print("\n[Step 2] Restoring pre-task 7 backup into Entervene_Demo_Rehearsal...")
    env = os.environ.copy()
    env["PGPASSWORD"] = "sphinxclub012"
    cmd = [
        PG_RESTORE_PATH,
        "-U", "postgres",
        "-h", "localhost",
        "-p", "5432",
        "-d", "Entervene_Demo_Rehearsal",
        "--clean",
        "--if-exists",
        "--no-owner",
        BACKUP_PATH,
    ]
    res = subprocess.run(cmd, env=env, capture_output=True, text=True)
    # pg_restore may return non-zero for harmless warnings during clean if-exists
    print(f"pg_restore completed with exit code: {res.returncode}")

    # 3. Connect to clone and verify pre-state
    print("\n[Step 3] Verifying initial clone state...")
    rehearsal_engine = create_engine(REHEARSAL_DB_URL)
    with Session(rehearsal_engine) as db:
        dbname = db.execute(text("SELECT current_database()")).scalar()
        assert dbname == "Entervene_Demo_Rehearsal", f"Safety abort: connected to {dbname}"
        st_count = db.execute(text("SELECT count(*) FROM student s JOIN student_class sc ON s.student_id = sc.student_id WHERE sc.class_id = 1")).scalar()
        comp_count = db.execute(text("SELECT count(*) FROM competency")).scalar()
        lesson_count = db.execute(text("SELECT count(*) FROM lesson")).scalar()
        pred_count = db.execute(text("SELECT count(*) FROM development_current_term_prediction")).scalar()
        inv_count = db.execute(text("SELECT count(*) FROM intervention")).scalar()
        sub_count = db.execute(text("SELECT count(*) FROM student_submission")).scalar()
        print(f"Clone Pre-State: Students={st_count}, Comps={comp_count}, Lessons={lesson_count}, Preds={pred_count}, Invs={inv_count}, Subs={sub_count}")
        assert st_count == 11, f"Expected 11 students, got {st_count}"
        assert comp_count == 4, f"Expected 4 competencies, got {comp_count}"
        assert lesson_count == 4, f"Expected 4 lessons, got {lesson_count}"
        assert pred_count == 45, f"Expected 45 predictions, got {pred_count}"
        assert inv_count == 4, f"Expected 4 interventions, got {inv_count}"
        assert sub_count == 102, f"Expected 102 submissions, got {sub_count}"

        # 4. Perform atomic cleanup transaction
        print("\n[Step 4] Executing atomic cleanup transaction on clone...")
        
        # 4a. Delete Finley's intervention-only classwork CW 12 (Targeted Mathematics Practice)
        print("  - Removing CW 12 (I5I-A Targeted Mathematics Practice)...")
        db.execute(text("DELETE FROM classwork_lesson WHERE classwork_id = 12"))
        # Deleting from classwork cascades CA 12, Sub 96, Quiz 1, QuizQuestion 1, Answer 1
        cw12_del = db.execute(text("DELETE FROM classwork WHERE classwork_id = 12"))
        print(f"    Classwork 12 deleted (rowcount={cw12_del.rowcount})")

        # 4b. Delete intervention support materials
        print("  - Removing intervention support materials...")
        ism_del = db.execute(text("DELETE FROM intervention_support_material"))
        print(f"    Intervention support materials deleted (rowcount={ism_del.rowcount})")

        # 4c. Delete interventions
        print("  - Removing intervention records...")
        inv_del = db.execute(text("DELETE FROM intervention"))
        print(f"    Interventions deleted (rowcount={inv_del.rowcount})")

        # 4d. Delete development current term predictions
        print("  - Removing historical development current term predictions...")
        pred_del = db.execute(text("DELETE FROM development_current_term_prediction"))
        print(f"    Predictions deleted (rowcount={pred_del.rowcount})")

        # 4e. Reset Term Examination (CW 10 / CA 10) submissions to pending/ungraded
        print("  - Resetting Term Examination (CA 10) submissions to pending/ungraded...")
        te_upd = db.execute(text("""
            UPDATE student_submission
            SET grade = NULL,
                status = 'pending',
                submitted_at = NULL,
                graded_at = NULL,
                graded_by_staff_id = NULL,
                feedback = NULL
            WHERE classwork_assignment_id = 10
        """))
        print(f"    Term Exam submissions reset (rowcount={te_upd.rowcount})")

        db.commit()
        print("Clone cleanup transaction committed successfully.")

    # 5. Verify post-cleanup state on clone
    print("\n[Step 5] Verifying post-cleanup state on clone...")
    with Session(rehearsal_engine) as db:
        st_count = db.execute(text("SELECT count(*) FROM student s JOIN student_class sc ON s.student_id = sc.student_id WHERE sc.class_id = 1")).scalar()
        comp_count = db.execute(text("SELECT count(*) FROM competency")).scalar()
        lesson_count = db.execute(text("SELECT count(*) FROM lesson")).scalar()
        pred_count = db.execute(text("SELECT count(*) FROM development_current_term_prediction")).scalar()
        inv_count = db.execute(text("SELECT count(*) FROM intervention")).scalar()
        ism_count = db.execute(text("SELECT count(*) FROM intervention_support_material")).scalar()
        cw12_exists = db.execute(text("SELECT count(*) FROM classwork WHERE classwork_id = 12")).scalar()
        cw10_exists = db.execute(text("SELECT count(*) FROM classwork WHERE classwork_id = 10")).scalar()
        te_subs_graded = db.execute(text("SELECT count(*) FROM student_submission WHERE classwork_assignment_id = 10 AND grade IS NOT NULL")).scalar()
        te_subs_pending = db.execute(text("SELECT count(*) FROM student_submission WHERE classwork_assignment_id = 10 AND status = 'pending'")).scalar()
        total_subs = db.execute(text("SELECT count(*) FROM student_submission")).scalar()
        graded_subs = db.execute(text("SELECT count(*) FROM student_submission WHERE status = 'graded' AND grade IS NOT NULL")).scalar()

        print(f"Post-State: Students={st_count}, Comps={comp_count}, Lessons={lesson_count}")
        print(f"Post-State: Predictions={pred_count}, Interventions={inv_count}, SupportMaterials={ism_count}")
        print(f"Post-State: CW 12 exists={cw12_exists}, CW 10 exists={cw10_exists}")
        print(f"Post-State: Term Exam Graded={te_subs_graded}, Term Exam Pending={te_subs_pending}")
        print(f"Post-State: Total Submissions={total_subs}, Graded Submissions={graded_subs}")

        assert st_count == 11, f"Expected 11 students, got {st_count}"
        assert comp_count == 4, f"Expected 4 competencies, got {comp_count}"
        assert lesson_count == 4, f"Expected 4 lessons, got {lesson_count}"
        assert pred_count == 0, f"Expected 0 predictions, got {pred_count}"
        assert inv_count == 0, f"Expected 0 interventions, got {inv_count}"
        assert ism_count == 0, f"Expected 0 support materials, got {ism_count}"
        assert cw12_exists == 0, f"Expected CW 12 to be deleted, got {cw12_exists}"
        assert cw10_exists == 1, f"Expected CW 10 to exist, got {cw10_exists}"
        assert te_subs_graded == 0, f"Expected 0 graded Term Exam subs, got {te_subs_graded}"
        assert te_subs_pending == 10, f"Expected 10 pending Term Exam subs, got {te_subs_pending}"
        assert total_subs == 101, f"Expected 101 submissions (102 - 1 for CW 12), got {total_subs}"
        assert graded_subs == 77, f"Expected 77 status='graded' submissions, got {graded_subs}"
        subs_with_grade = db.execute(text("SELECT count(*) FROM student_submission WHERE grade IS NOT NULL")).scalar()
        print(f"Post-State: Submissions with grade={subs_with_grade}")
        assert subs_with_grade == 90, f"Expected 90 submissions with grade IS NOT NULL, got {subs_with_grade}"

        # 6. Feature Builder & Readiness Evaluation across all 11 students
        print("\n[Step 6] Running Feature Builder & Readiness Evaluator on all 11 students in clone...")
        students = db.execute(text("""
            SELECT s.student_id, s.student_lrn, s.first_name, s.last_name
            FROM student s
            JOIN student_class sc ON s.student_id = sc.student_id
            WHERE sc.class_id = 1
            ORDER BY s.student_lrn
        """)).fetchall()

        for st in students:
            res = build_current_period_features_from_records(db, st.student_id, 1, 1, 1)
            feats = res["features"]
            ready = res["ready"]
            level = res["readiness_level"]
            reasons = res["readiness_reason_codes"]
            ww_cnt = feats["ww_available_activity_count"]
            pt_cnt = feats["pt_available_activity_count"]
            ww_ev = feats["ww_has_evidence"]
            pt_ev = feats["pt_has_evidence"]
            qa_ev = feats["qa_has_evidence"]
            weight = feats["observed_component_weight_sum"]
            exam_info = res["evidence_summary"]["examination"]
            st1_pct = exam_info["subtype_percentages"].get("SUMMATIVE_1")
            st2_pct = exam_info["subtype_percentages"].get("SUMMATIVE_2")
            term_pct = exam_info["subtype_percentages"].get("TERM_EXAM")

            print(f"Student: {st.first_name} {st.last_name} ({st.student_lrn})")
            print(f"  WW Count: {ww_cnt} (ev={ww_ev}) | PT Count: {pt_cnt} (ev={pt_ev}) | QA ev: {qa_ev}")
            print(f"  Summative 1: {st1_pct}% | Summative 2: {st2_pct}% | Term Exam: {term_pct}")
            print(f"  Observed Weight: {weight}% | Readiness: {level} (Ready={ready}) | Reasons: {reasons}")
            assert term_pct is None, f"Term Exam must be None for {st.first_name}"
            assert qa_ev == 0.0, f"QA evidence must be 0.0 for {st.first_name}"
            assert weight == 70.0, f"Observed weight must be 70.0% for {st.first_name}"
            assert level == "STANDARD_READY", f"Expected STANDARD_READY for {st.first_name}, got {level}"

        # 7. Verify Gradebook API response
        print("\n[Step 7] Testing teacher_student_gradebook service on clone...")
        gb = teacher_student_gradebook(db, "DEMO-T-001", 1, 1, 1)
        print(f"Gradebook returned {len(gb.studentGrades)} student rows.")
        for sg in gb.studentGrades[:3]:
            print(f"  {sg.name}: WW={sg.writtenWork}, PT={sg.performanceTask}, QA={sg.quarterlyAssessment}")
            # Ensure Term Exam (last item of quarterlyAssessment) is None
            assert sg.quarterlyAssessment[2] is None, f"Term Exam score must be None in gradebook for {sg.name}"

    print("\n" + "=" * 80)
    print("ALL REHEARSAL CHECKS PASSED PERFECTLY!")
    print("=" * 80)


if __name__ == "__main__":
    main()
