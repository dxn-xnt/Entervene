"""Apply Task 10 Academic Evidence Completion to Entervene_Demo.

Safely:
1. Verifies .env.demo and Entervene_Demo target.
2. Verifies pre-flight backup file exists.
3. Reuses 6 existing pending submissions and inserts 4 missing submissions for Jordan & Morgan.
4. Inserts valid QuizAnswers mapped to quiz questions and competencies.
5. Verifies all 11 students have 9 of 9 graded published assessments.
6. Recalculates gradebook via teacher_student_gradebook.
7. Generates revision 2 development predictions for Jordan and Morgan using Model Version 2.
8. Reconciles Morgan's intervention candidate through normal backend synchronization.
"""

import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Setup environment strictly to .env.demo
backend_dir = Path(r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend")
demo_env = dotenv_values(backend_dir / ".env.demo")
db_url = demo_env.get("DATABASE_URL")
if not db_url or "Entervene_Demo" not in db_url:
    raise RuntimeError(f"Safety abort: Refusing to run on unexpected database: {db_url}")

# Verify backup exists
backup_file = backend_dir / "backups" / "entervene_demo_pre_task10.sql"
if not backup_file.is_file() or backup_file.stat().st_size == 0:
    raise RuntimeError(f"Safety abort: Pre-flight backup file missing or empty: {backup_file}")

print(f"Verified target database: {db_url}")
print(f"Verified pre-flight backup: {backup_file} ({backup_file.stat().st_size} bytes)")

sys.path.insert(0, str(backend_dir))
os.environ["ENV_FILE"] = str(backend_dir / ".env.demo")

from app.models.people.Student import Student
from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.Classwork import Classwork
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term
from app.services.student_record.StudentRecordService import teacher_student_gradebook

engine = create_engine(db_url)
db = Session(bind=engine)

try:
    print("\n" + "=" * 80)
    print("STEP 1: VERIFY STUDENTS & TARGET ASSIGNMENTS")
    print("=" * 80)

    jordan = db.query(Student).filter(Student.first_name.ilike("%Jordan%")).first()
    morgan = db.query(Student).filter(Student.first_name.ilike("%Morgan%")).first()
    assert jordan and morgan, "Jordan or Morgan not found!"
    print(f"Demo Jordan Starting (LRN: {jordan.student_lrn}, UUID: {jordan.student_id})")
    print(f"Demo Morgan Striving (LRN: {morgan.student_lrn}, UUID: {morgan.student_id})")

    # Verify existing graded counts
    j_subs = db.query(StudentSubmission).filter_by(student_id=jordan.student_id).all()
    m_subs = db.query(StudentSubmission).filter_by(student_id=morgan.student_id).all()
    print(f"Pre-migration Jordan submissions: {len(j_subs)} ({sum(1 for s in j_subs if s.status == 'graded')} graded)")
    print(f"Pre-migration Morgan submissions: {len(m_subs)} ({sum(1 for s in m_subs if s.status == 'graded')} graded)")

    print("\n" + "=" * 80)
    print("STEP 2: COMPLETE ACADEMIC RECORDS FOR JORDAN")
    print("=" * 80)

    # CW 3 (CA 3): Insert missing submission (15.0 / 20 = 75%)
    sub_j_cw3 = db.query(StudentSubmission).filter_by(
        student_id=jordan.student_id, classwork_assignment_id=3
    ).first()
    if not sub_j_cw3:
        sub_j_cw3 = StudentSubmission(
            classwork_assignment_id=3,
            student_id=jordan.student_id,
            status="graded",
            grade=Decimal("15.00"),
            submitted_at=datetime(2026, 9, 9, 16, 0, tzinfo=timezone.utc),
            graded_at=datetime(2026, 9, 9, 16, 30, tzinfo=timezone.utc),
        )
        db.add(sub_j_cw3)
        db.flush()
        print(f"  Inserted Jordan CW 3 (WW 3): Sub {sub_j_cw3.submission_id} -> 15.00/20.00")
    else:
        sub_j_cw3.status = "graded"
        sub_j_cw3.grade = Decimal("15.00")
        print(f"  Updated Jordan CW 3 (WW 3): Sub {sub_j_cw3.submission_id} -> 15.00/20.00")

    # CW 4 (CA 4): Update pending Sub 98 (14.0 / 20 = 70%) & insert QuizAnswers
    sub_j_cw4 = db.query(StudentSubmission).filter_by(
        student_id=jordan.student_id, classwork_assignment_id=4
    ).first()
    assert sub_j_cw4, "Expected Jordan CW 4 submission!"
    sub_j_cw4.status = "graded"
    sub_j_cw4.grade = Decimal("14.00")
    sub_j_cw4.submitted_at = datetime(2026, 9, 12, 16, 0, tzinfo=timezone.utc)
    sub_j_cw4.graded_at = datetime(2026, 9, 12, 16, 30, tzinfo=timezone.utc)
    print(f"  Updated Jordan CW 4 (WW 4): Sub {sub_j_cw4.submission_id} -> 14.00/20.00")

    # QuizAnswers for Quiz ID 9 (qq_id 16 & 17)
    existing_j_qas = db.query(QuizAnswer).filter_by(submission_id=sub_j_cw4.submission_id).all()
    if not existing_j_qas:
        qa_j_1 = QuizAnswer(
            submission_id=sub_j_cw4.submission_id,
            quiz_question_id=16,
            answer_text="x",
            is_correct=True,
            points_awarded=Decimal("10.00"),
        )
        qa_j_2 = QuizAnswer(
            submission_id=sub_j_cw4.submission_id,
            quiz_question_id=17,
            answer_text="x = 4",
            is_correct=False,
            points_awarded=Decimal("4.00"),
        )
        db.add_all([qa_j_1, qa_j_2])
        print(f"  Inserted QuizAnswers for Jordan CW 4 (10.00 + 4.00 = 14.00)")

    # CW 6 (CA 6): Update pending Sub 123 (30.0 / 40 = 75%)
    sub_j_cw6 = db.query(StudentSubmission).filter_by(
        student_id=jordan.student_id, classwork_assignment_id=6
    ).first()
    assert sub_j_cw6, "Expected Jordan CW 6 submission!"
    sub_j_cw6.status = "graded"
    sub_j_cw6.grade = Decimal("30.00")
    sub_j_cw6.submitted_at = datetime(2026, 9, 11, 16, 0, tzinfo=timezone.utc)
    sub_j_cw6.graded_at = datetime(2026, 9, 11, 16, 30, tzinfo=timezone.utc)
    print(f"  Updated Jordan CW 6 (PT 2): Sub {sub_j_cw6.submission_id} -> 30.00/40.00")

    # CW 8 (CA 8): Update pending Sub 121 (22.0 / 30 = 73.3%)
    sub_j_cw8 = db.query(StudentSubmission).filter_by(
        student_id=jordan.student_id, classwork_assignment_id=8
    ).first()
    assert sub_j_cw8, "Expected Jordan CW 8 submission!"
    sub_j_cw8.status = "graded"
    sub_j_cw8.grade = Decimal("22.00")
    sub_j_cw8.submitted_at = datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc)
    sub_j_cw8.graded_at = datetime(2026, 9, 8, 16, 30, tzinfo=timezone.utc)
    print(f"  Updated Jordan CW 8 (ST 1): Sub {sub_j_cw8.submission_id} -> 22.00/30.00")

    # CW 9 (CA 9): Update pending Sub 119 (23.0 / 30 = 76.7%)
    sub_j_cw9 = db.query(StudentSubmission).filter_by(
        student_id=jordan.student_id, classwork_assignment_id=9
    ).first()
    assert sub_j_cw9, "Expected Jordan CW 9 submission!"
    sub_j_cw9.status = "graded"
    sub_j_cw9.grade = Decimal("23.00")
    sub_j_cw9.submitted_at = datetime(2026, 9, 15, 16, 0, tzinfo=timezone.utc)
    sub_j_cw9.graded_at = datetime(2026, 9, 15, 16, 30, tzinfo=timezone.utc)
    print(f"  Updated Jordan CW 9 (ST 2): Sub {sub_j_cw9.submission_id} -> 23.00/30.00")

    print("\n" + "=" * 80)
    print("STEP 3: COMPLETE ACADEMIC RECORDS FOR MORGAN")
    print("=" * 80)

    # CW 2 (CA 2): Insert missing submission (9.0 / 20 = 45%) & insert QuizAnswers
    sub_m_cw2 = db.query(StudentSubmission).filter_by(
        student_id=morgan.student_id, classwork_assignment_id=2
    ).first()
    if not sub_m_cw2:
        sub_m_cw2 = StudentSubmission(
            classwork_assignment_id=2,
            student_id=morgan.student_id,
            status="graded",
            grade=Decimal("9.00"),
            submitted_at=datetime(2026, 9, 6, 16, 0, tzinfo=timezone.utc),
            graded_at=datetime(2026, 9, 6, 16, 30, tzinfo=timezone.utc),
        )
        db.add(sub_m_cw2)
        db.flush()
        print(f"  Inserted Morgan CW 2 (WW 2): Sub {sub_m_cw2.submission_id} -> 9.00/20.00")
    else:
        sub_m_cw2.status = "graded"
        sub_m_cw2.grade = Decimal("9.00")
        print(f"  Updated Morgan CW 2 (WW 2): Sub {sub_m_cw2.submission_id} -> 9.00/20.00")

    # QuizAnswers for Quiz ID 3 (qq_id 4 & 5)
    existing_m_qas = db.query(QuizAnswer).filter_by(submission_id=sub_m_cw2.submission_id).all()
    if not existing_m_qas:
        qa_m_1 = QuizAnswer(
            submission_id=sub_m_cw2.submission_id,
            quiz_question_id=4,
            answer_text="y",
            is_correct=True,
            points_awarded=Decimal("9.00"),
        )
        qa_m_2 = QuizAnswer(
            submission_id=sub_m_cw2.submission_id,
            quiz_question_id=5,
            answer_text="x = 10",
            is_correct=False,
            points_awarded=Decimal("0.00"),
        )
        db.add_all([qa_m_1, qa_m_2])
        print(f"  Inserted QuizAnswers for Morgan CW 2 (9.00 + 0.00 = 9.00)")

    # CW 3 (CA 3): Insert missing submission (10.0 / 20 = 50%)
    sub_m_cw3 = db.query(StudentSubmission).filter_by(
        student_id=morgan.student_id, classwork_assignment_id=3
    ).first()
    if not sub_m_cw3:
        sub_m_cw3 = StudentSubmission(
            classwork_assignment_id=3,
            student_id=morgan.student_id,
            status="graded",
            grade=Decimal("10.00"),
            submitted_at=datetime(2026, 9, 9, 16, 0, tzinfo=timezone.utc),
            graded_at=datetime(2026, 9, 9, 16, 30, tzinfo=timezone.utc),
        )
        db.add(sub_m_cw3)
        db.flush()
        print(f"  Inserted Morgan CW 3 (WW 3): Sub {sub_m_cw3.submission_id} -> 10.00/20.00")
    else:
        sub_m_cw3.status = "graded"
        sub_m_cw3.grade = Decimal("10.00")
        print(f"  Updated Morgan CW 3 (WW 3): Sub {sub_m_cw3.submission_id} -> 10.00/20.00")

    # CW 6 (CA 6): Update pending Sub 124 (24.0 / 40 = 60%)
    sub_m_cw6 = db.query(StudentSubmission).filter_by(
        student_id=morgan.student_id, classwork_assignment_id=6
    ).first()
    assert sub_m_cw6, "Expected Morgan CW 6 submission!"
    sub_m_cw6.status = "graded"
    sub_m_cw6.grade = Decimal("24.00")
    sub_m_cw6.submitted_at = datetime(2026, 9, 11, 16, 0, tzinfo=timezone.utc)
    sub_m_cw6.graded_at = datetime(2026, 9, 11, 16, 30, tzinfo=timezone.utc)
    print(f"  Updated Morgan CW 6 (PT 2): Sub {sub_m_cw6.submission_id} -> 24.00/40.00")

    # CW 8 (CA 8): Update pending Sub 122 (18.0 / 30 = 60%)
    sub_m_cw8 = db.query(StudentSubmission).filter_by(
        student_id=morgan.student_id, classwork_assignment_id=8
    ).first()
    assert sub_m_cw8, "Expected Morgan CW 8 submission!"
    sub_m_cw8.status = "graded"
    sub_m_cw8.grade = Decimal("18.00")
    sub_m_cw8.submitted_at = datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc)
    sub_m_cw8.graded_at = datetime(2026, 9, 8, 16, 30, tzinfo=timezone.utc)
    print(f"  Updated Morgan CW 8 (ST 1): Sub {sub_m_cw8.submission_id} -> 18.00/30.00")

    # CW 9 (CA 9): Update pending Sub 120 (19.0 / 30 = 63.3%)
    sub_m_cw9 = db.query(StudentSubmission).filter_by(
        student_id=morgan.student_id, classwork_assignment_id=9
    ).first()
    assert sub_m_cw9, "Expected Morgan CW 9 submission!"
    sub_m_cw9.status = "graded"
    sub_m_cw9.grade = Decimal("19.00")
    sub_m_cw9.submitted_at = datetime(2026, 9, 15, 16, 0, tzinfo=timezone.utc)
    sub_m_cw9.graded_at = datetime(2026, 9, 15, 16, 30, tzinfo=timezone.utc)
    print(f"  Updated Morgan CW 9 (ST 2): Sub {sub_m_cw9.submission_id} -> 19.00/30.00")

    # Commit all academic evidence changes
    db.commit()
    print("\nAcademic evidence committed successfully to Entervene_Demo.")

    print("\n" + "=" * 80)
    print("STEP 4: VERIFY CLASS-WIDE ASSESSMENT COMPLETENESS (ALL 11 STUDENTS)")
    print("=" * 80)

    enrolled_students = (
        db.query(Student)
        .join(StudentClass, Student.student_id == StudentClass.student_id)
        .filter(StudentClass.class_id == 1, StudentClass.enrollment_status == "enrolled")
        .order_by(Student.last_name)
        .all()
    )
    assert len(enrolled_students) == 11, f"Expected 11 students, got {len(enrolled_students)}"

    for s in enrolled_students:
        subs = (
            db.query(StudentSubmission)
            .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
            .filter(
                StudentSubmission.student_id == s.student_id,
                ClassworkAssignment.class_id == 1,
                ClassworkAssignment.is_published.is_(True),
            )
            .all()
        )
        scored_count = sum(1 for sub in subs if sub.grade is not None)
        print(f"  {s.first_name + ' ' + s.last_name:<24}: {scored_count}/9 published assessments scored")
        assert scored_count == 9, f"Student {s.first_name} does not have 9 scored assessments!"

    print("\n" + "=" * 80)
    print("STEP 5: RECALCULATE GRADEBOOK")
    print("=" * 80)

    book = teacher_student_gradebook(db, staff_id="DEMO-T-001", class_id=1, subject_id=1, academic_period_id=1)
    print(f"{'Student Name':<24} | {'WW %':<8} | {'PT %':<8} | {'Exams %':<8} | {'Initial':<8} | {'Transmuted':<10}")
    print("-" * 75)
    for row in book.studentGrades:
        ww_str = f"{row.ps_written:.1f}%" if row.ps_written is not None else "None"
        pt_str = f"{row.ps_performance:.1f}%" if row.ps_performance is not None else "None"
        ex_str = f"{row.ps_exams:.1f}%" if row.ps_exams is not None else "None"
        init_str = f"{row.initial_grade:.2f}" if row.initial_grade is not None else "None"
        trans_str = f"{row.transmuted_grade}" if row.transmuted_grade is not None else "None"
        print(f"{row.name:<24} | {ww_str:<8} | {pt_str:<8} | {ex_str:<8} | {init_str:<8} | {trans_str:<10}")

    print("\n" + "=" * 80)
    print("STEP 6: GENERATE NEW PREDICTIONS FOR JORDAN AND MORGAN")
    print("=" * 80)

    model_version = db.query(AIModelVersion).filter_by(
        model_name=CORRECTED_MODEL_NAME,
        model_version_id=2
    ).first()
    assert model_version is not None, "Model version 2 not found!"

    # Regenerate for Jordan
    pred_res_j = generate_and_persist_development_current_term(
        student_id=jordan.student_id,
        class_id=1,
        subject_id=1,
        period_id=1,
        model_version_id=model_version.model_version_id,
        bind=engine,
    )
    print(f"Jordan Prediction: Persisted={pred_res_j['persisted']}, Rev={pred_res_j['revision']}, Grade={pred_res_j['projected_final_term_grade']}, Level={pred_res_j['intervention_level']}")

    # Regenerate for Morgan
    pred_res_m = generate_and_persist_development_current_term(
        student_id=morgan.student_id,
        class_id=1,
        subject_id=1,
        period_id=1,
        model_version_id=model_version.model_version_id,
        bind=engine,
    )
    print(f"Morgan Prediction: Persisted={pred_res_m['persisted']}, Rev={pred_res_m['revision']}, Grade={pred_res_m['projected_final_term_grade']}, Level={pred_res_m['intervention_level']}")

    print("\n" + "=" * 80)
    print("STEP 7: POST-MIGRATION AUDIT (ALL 11 PREDICTIONS & INTERVENTIONS)")
    print("=" * 80)

    all_preds = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(class_id=1, subject_id=1, target_period_id=1, model_version_id=2)
        .order_by(DevelopmentCurrentTermPrediction.predicted_period_grade.asc())
        .all()
    )
    print(f"Total Persisted Predictions in Entervene_Demo: {len(all_preds)}")
    for p in all_preds:
        st = db.get(Student, p.student_id)
        print(f"  {st.first_name + ' ' + st.last_name:<24}: Rev {p.revision} | Grade={p.predicted_period_grade:5.2f} | Risk={p.intervention_level:15} | Basis={p.intervention_basis}")

    candidates = (
        db.query(Intervention)
        .filter_by(class_id=1, subject_id=1, academic_period_id=1)
        .order_by(Intervention.intervention_id.asc())
        .all()
    )
    print(f"\nTotal Intervention Records in Entervene_Demo: {len(candidates)}")
    for c in candidates:
        st = db.get(Student, c.student_id)
        print(f"  Candidate ID {c.intervention_id}: {st.first_name + ' ' + st.last_name} | Status: {c.status}")
        diag = c.diagnosis or {}
        cts = diag.get("competency_targets", [])
        print(f"    Competency Targets ({len(cts)}):")
        for ct in cts:
            print(f"      - {ct.get('code')}: {ct.get('name')} | Avg Score: {ct.get('average_score')}")

    print("\n" + "=" * 80)
    print("TASK 10 DATA PERSISTENCE COMPLETED SUCCESSFULLY!")
    print("=" * 80)

finally:
    db.close()
