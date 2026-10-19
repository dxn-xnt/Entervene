import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from dotenv import dotenv_values
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

demo_env = dotenv_values(r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend\.env.demo")
db_url = demo_env.get("DATABASE_URL")
assert db_url and "Entervene_Demo" in db_url, f"Safety check failed: db_url is {db_url}"
print(f"Rehearsing on: {db_url}")

sys.path.insert(0, r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend")
os.environ["ENV_FILE"] = r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend\.env.demo"

from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term
from app.services.student_record.StudentRecordService import teacher_student_gradebook

engine = create_engine(db_url)
connection = engine.connect()
transaction = connection.begin()
db = Session(bind=connection)

try:
    jordan = db.query(Student).filter(Student.first_name.ilike("%Jordan%")).first()
    morgan = db.query(Student).filter(Student.first_name.ilike("%Morgan%")).first()
    assert jordan and morgan, "Jordan or Morgan not found!"
    print(f"Found Jordan (ID: {jordan.student_id}) and Morgan (ID: {morgan.student_id})")

    # 1. Update/Insert for Jordan
    # CW 3 (CA 3): Insert missing submission
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

    # CW 4 (CA 4): Update pending Sub 98
    sub_j_cw4 = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == jordan.student_id,
        StudentSubmission.classwork_assignment_id == 4,
    ).first()
    assert sub_j_cw4, "Jordan CW 4 submission not found!"
    sub_j_cw4.status = "graded"
    sub_j_cw4.grade = Decimal("14.00")
    sub_j_cw4.submitted_at = datetime(2026, 9, 12, 16, 0, tzinfo=timezone.utc)
    sub_j_cw4.graded_at = datetime(2026, 9, 12, 16, 30, tzinfo=timezone.utc)

    # Insert QuizAnswers for Jordan on CW 4 (Quiz ID 9: qq_id 16, 17)
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

    # CW 6 (CA 6): Update pending Sub 123
    sub_j_cw6 = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == jordan.student_id,
        StudentSubmission.classwork_assignment_id == 6,
    ).first()
    assert sub_j_cw6, "Jordan CW 6 submission not found!"
    sub_j_cw6.status = "graded"
    sub_j_cw6.grade = Decimal("30.00")
    sub_j_cw6.submitted_at = datetime(2026, 9, 11, 16, 0, tzinfo=timezone.utc)
    sub_j_cw6.graded_at = datetime(2026, 9, 11, 16, 30, tzinfo=timezone.utc)

    # CW 8 (CA 8): Update pending Sub 121
    sub_j_cw8 = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == jordan.student_id,
        StudentSubmission.classwork_assignment_id == 8,
    ).first()
    assert sub_j_cw8, "Jordan CW 8 submission not found!"
    sub_j_cw8.status = "graded"
    sub_j_cw8.grade = Decimal("22.00")
    sub_j_cw8.submitted_at = datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc)
    sub_j_cw8.graded_at = datetime(2026, 9, 8, 16, 30, tzinfo=timezone.utc)

    # CW 9 (CA 9): Update pending Sub 119
    sub_j_cw9 = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == jordan.student_id,
        StudentSubmission.classwork_assignment_id == 9,
    ).first()
    assert sub_j_cw9, "Jordan CW 9 submission not found!"
    sub_j_cw9.status = "graded"
    sub_j_cw9.grade = Decimal("23.00")
    sub_j_cw9.submitted_at = datetime(2026, 9, 15, 16, 0, tzinfo=timezone.utc)
    sub_j_cw9.graded_at = datetime(2026, 9, 15, 16, 30, tzinfo=timezone.utc)

    # 2. Update/Insert for Morgan
    # CW 2 (CA 2): Insert missing submission
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

    # Insert QuizAnswers for Morgan on CW 2 (Quiz ID 3: qq_id 4, 5)
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

    # CW 3 (CA 3): Insert missing submission
    sub_m_cw3 = StudentSubmission(
        classwork_assignment_id=3,
        student_id=morgan.student_id,
        status="graded",
        grade=Decimal("10.00"),
        submitted_at=datetime(2026, 9, 9, 16, 0, tzinfo=timezone.utc),
        graded_at=datetime(2026, 9, 9, 16, 30, tzinfo=timezone.utc),
    )
    db.add(sub_m_cw3)

    # CW 6 (CA 6): Update pending Sub 124
    sub_m_cw6 = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == morgan.student_id,
        StudentSubmission.classwork_assignment_id == 6,
    ).first()
    assert sub_m_cw6, "Morgan CW 6 submission not found!"
    sub_m_cw6.status = "graded"
    sub_m_cw6.grade = Decimal("24.00")
    sub_m_cw6.submitted_at = datetime(2026, 9, 11, 16, 0, tzinfo=timezone.utc)
    sub_m_cw6.graded_at = datetime(2026, 9, 11, 16, 30, tzinfo=timezone.utc)

    # CW 8 (CA 8): Update pending Sub 122
    sub_m_cw8 = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == morgan.student_id,
        StudentSubmission.classwork_assignment_id == 8,
    ).first()
    assert sub_m_cw8, "Morgan CW 8 submission not found!"
    sub_m_cw8.status = "graded"
    sub_m_cw8.grade = Decimal("18.00")
    sub_m_cw8.submitted_at = datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc)
    sub_m_cw8.graded_at = datetime(2026, 9, 8, 16, 30, tzinfo=timezone.utc)

    # CW 9 (CA 9): Update pending Sub 120
    sub_m_cw9 = db.query(StudentSubmission).filter(
        StudentSubmission.student_id == morgan.student_id,
        StudentSubmission.classwork_assignment_id == 9,
    ).first()
    assert sub_m_cw9, "Morgan CW 9 submission not found!"
    sub_m_cw9.status = "graded"
    sub_m_cw9.grade = Decimal("19.00")
    sub_m_cw9.submitted_at = datetime(2026, 9, 15, 16, 0, tzinfo=timezone.utc)
    sub_m_cw9.graded_at = datetime(2026, 9, 15, 16, 30, tzinfo=timezone.utc)

    db.flush()
    print("All 10 submissions successfully updated/inserted in transaction.")

    # 3. Test Gradebook calculation
    gradebook = teacher_student_gradebook(db, staff_id="DEMO-T-001", class_id=1, subject_id=1, academic_period_id=1)
    print("\n=== REHEARSED GRADEBOOK FOR 11 STUDENTS ===")
    for row in gradebook.studentGrades:
        if "Jordan" in row.name or "Morgan" in row.name:
            print(f"{row.name:<24} | WW: {row.ps_written:.1f}% | PT: {row.ps_performance:.1f}% | QA: {row.ps_exams:.1f}% | Initial: {row.initial_grade:.2f} | Transmuted: {row.transmuted_grade}")

    # 4. Test Prediction generation using core service inside transaction
    print("\n=== GENERATING PREDICTIONS IN TRANSACTION ===")
    from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction_service
    from app.services.prediction import DevelopmentCurrentTermRiskService as intervention_service

    pred_jordan = prediction_service.predict_development_current_term(
        db, jordan.student_id, 1, 1, 1, model_name=CORRECTED_MODEL_NAME
    )
    inv_jordan_assess = intervention_service.assess_development_current_term_intervention(pred_jordan)
    print(f"Jordan Prediction Result: Grade={pred_jordan.get('projected_final_term_grade')}, Risk={inv_jordan_assess.get('intervention_level')}, Basis={inv_jordan_assess.get('intervention_basis')}")

    pred_morgan = prediction_service.predict_development_current_term(
        db, morgan.student_id, 1, 1, 1, model_name=CORRECTED_MODEL_NAME
    )
    inv_morgan_assess = intervention_service.assess_development_current_term_intervention(pred_morgan)
    print(f"Morgan Prediction Result: Grade={pred_morgan.get('projected_final_term_grade')}, Risk={inv_morgan_assess.get('intervention_level')}, Basis={inv_morgan_assess.get('intervention_basis')}")

    # Inspect features in prediction
    for name, pred in [("Jordan", pred_jordan), ("Morgan", pred_morgan)]:
        print(f"\n{name} Rehearsed Features:")
        feats = pred.get("features", {})
        for k in ["ww_percent_so_far", "pt_percent_so_far", "qa_percent_so_far", "overall_partial_percent", "ww_available_activity_count", "pt_available_activity_count", "overall_available_activity_count"]:
            print(f"  {k}: {feats.get(k)}")

    # 5. Check Intervention Candidate status
    inv_morgan = db.query(Intervention).filter(Intervention.student_id == morgan.student_id).first()
    if inv_morgan:
        print(f"Morgan Intervention Candidate: ID={inv_morgan.intervention_id}, Status={inv_morgan.status}, Type={inv_morgan.intervention_type}")
        print(f"Diagnosis competency targets: {len(inv_morgan.diagnosis.get('competency_targets', []))}")
        for ct in inv_morgan.diagnosis.get("competency_targets", []):
            print(f"  Target: {ct.get('code')} - {ct.get('name')} | score: {ct.get('average_score')}")

    inv_jordan = db.query(Intervention).filter(Intervention.student_id == jordan.student_id).first()
    print(f"Jordan Intervention Candidate: {inv_jordan.intervention_id if inv_jordan else 'None (Correct, >= 85)'}")

    print("\nSUCCESS: All steps executed cleanly. Rolling back transaction for safety.")
finally:
    transaction.rollback()
    connection.close()
    print("Rollback complete. Zero permanent changes made.")
