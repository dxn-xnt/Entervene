"""Apply Task 7 Database Cleanup to Entervene_Demo.

Safely purges historical predictions, interventions, and Finley's intervention-only practice (CW 12).
Safely resets Term Examination submissions (CA 10) to pending/ungraded.
Preserves all 11 students, 4 competencies, 4 lessons, curriculum mappings, and valid WW/PT/Summative scores.
"""

import os
import sys

sys.path.insert(0, os.path.abspath("backend"))
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.student_record.StudentRecordService import teacher_student_gradebook


def main():
    print("=" * 80)
    print("APPLYING TASK 7 CLEANUP TO ENTERVENE_DEMO")
    print("=" * 80)

    demo_env = dotenv_values("backend/.env.demo")
    db_url = demo_env.get("DATABASE_URL")

    # Strict Database Guard
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
        pred_count = db.execute(text("SELECT count(*) FROM development_current_term_prediction")).scalar()
        inv_count = db.execute(text("SELECT count(*) FROM intervention")).scalar()
        sub_count = db.execute(text("SELECT count(*) FROM student_submission")).scalar()

        print(f"  Students in Class 1: {st_count} (Expected: 11)")
        print(f"  Competencies: {comp_count} (Expected: 4)")
        print(f"  Lessons: {lesson_count} (Expected: 4)")
        print(f"  Historical Predictions: {pred_count} (Expected: 45)")
        print(f"  Historical Interventions: {inv_count} (Expected: 4)")
        print(f"  Total Submissions: {sub_count} (Expected: 102)")

        assert st_count == 11, f"Expected 11 students, got {st_count}"
        assert comp_count == 4, f"Expected 4 competencies, got {comp_count}"
        assert lesson_count == 4, f"Expected 4 lessons, got {lesson_count}"
        assert pred_count == 45, f"Expected 45 predictions, got {pred_count}"
        assert inv_count == 4, f"Expected 4 interventions, got {inv_count}"
        assert sub_count == 102, f"Expected 102 submissions, got {sub_count}"

        # 2. Execute atomic cleanup transaction
        print("\n[Step 2] Executing atomic cleanup transaction...")

        # 2a. Remove CW 12 (Targeted Mathematics Practice)
        print("  - Removing CW 12 (I5I-A Targeted Mathematics Practice) and associations...")
        db.execute(text("DELETE FROM classwork_lesson WHERE classwork_id = 12"))
        cw12_del = db.execute(text("DELETE FROM classwork WHERE classwork_id = 12"))
        print(f"    Classwork 12 deleted (rowcount={cw12_del.rowcount})")

        # 2b. Remove intervention support materials
        print("  - Removing intervention support materials...")
        ism_del = db.execute(text("DELETE FROM intervention_support_material"))
        print(f"    Intervention support materials deleted (rowcount={ism_del.rowcount})")

        # 2c. Remove interventions
        print("  - Removing historical interventions...")
        inv_del = db.execute(text("DELETE FROM intervention"))
        print(f"    Interventions deleted (rowcount={inv_del.rowcount})")

        # 2d. Remove historical predictions
        print("  - Removing historical development current term predictions...")
        pred_del = db.execute(text("DELETE FROM development_current_term_prediction"))
        print(f"    Predictions deleted (rowcount={pred_del.rowcount})")

        # 2e. Reset Term Examination (CA 10) submissions to pending/ungraded
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
        print(f"    Term Exam submissions reset to pending/ungraded (rowcount={te_upd.rowcount})")

        db.commit()
        print("\nAtomic cleanup committed successfully.")

    # 3. Post-cleanup verification in Entervene_Demo
    print("\n[Step 3] Verifying persistent post-cleanup state in Entervene_Demo...")
    with Session(engine) as db:
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
        subs_with_grade = db.execute(text("SELECT count(*) FROM student_submission WHERE grade IS NOT NULL")).scalar()

        print(f"  Students in Class 1: {st_count} (Expected: 11)")
        print(f"  Competencies: {comp_count} (Expected: 4)")
        print(f"  Lessons: {lesson_count} (Expected: 4)")
        print(f"  Predictions: {pred_count} (Expected: 0)")
        print(f"  Interventions: {inv_count} (Expected: 0)")
        print(f"  Support Materials: {ism_count} (Expected: 0)")
        print(f"  CW 12 exists: {cw12_exists} (Expected: 0)")
        print(f"  CW 10 (Term Exam) exists: {cw10_exists} (Expected: 1)")
        print(f"  Term Exam Graded: {te_subs_graded} (Expected: 0)")
        print(f"  Term Exam Pending: {te_subs_pending} (Expected: 10)")
        print(f"  Total Submissions: {total_subs} (Expected: 101)")
        print(f"  Submissions with Grade: {subs_with_grade} (Expected: 90)")

        assert st_count == 11
        assert comp_count == 4
        assert lesson_count == 4
        assert pred_count == 0
        assert inv_count == 0
        assert ism_count == 0
        assert cw12_exists == 0
        assert cw10_exists == 1
        assert te_subs_graded == 0
        assert te_subs_pending == 10
        assert total_subs == 101
        assert subs_with_grade == 90

        # 4. Feature Builder & Readiness Evaluation
        print("\n[Step 4] Running Feature Builder & Readiness Evaluator across all 11 students...")
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

            print(f"  {st.first_name} {st.last_name} ({st.student_lrn}):")
            print(f"    WW: {ww_cnt} (ev={ww_ev}) | PT: {pt_cnt} (ev={pt_ev}) | QA ev: {qa_ev} | Weight: {weight}%")
            print(f"    ST1: {st1_pct}% | ST2: {st2_pct}% | Term Exam: {term_pct}")
            print(f"    Readiness: {level} (Ready={ready}) | Reasons: {reasons}")

            assert term_pct is None
            assert qa_ev == 0.0
            assert weight == 70.0
            assert level == "STANDARD_READY"
            assert ready is True

        # 5. Gradebook Service Verification
        print("\n[Step 5] Testing teacher_student_gradebook service in Entervene_Demo...")
        gb = teacher_student_gradebook(db, "DEMO-T-001", 1, 1, 1)
        print(f"  Gradebook returned {len(gb.studentGrades)} student rows.")
        for sg in gb.studentGrades[:3]:
            print(f"    {sg.name}: WW={sg.writtenWork}, PT={sg.performanceTask}, QA={sg.quarterlyAssessment}")
            assert sg.quarterlyAssessment[2] is None, f"Term Exam score must be None in gradebook for {sg.name}"

    print("\n" + "=" * 80)
    print("TASK 7 DATABASE CLEANUP COMPLETED AND VERIFIED!")
    print("=" * 80)


if __name__ == "__main__":
    main()
