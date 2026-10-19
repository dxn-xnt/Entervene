import os, sys, uuid
from datetime import datetime, timezone, date
from decimal import Decimal

os.environ['ENV_FILE'] = '.env.demo'
sys.path.insert(0, os.path.abspath('.'))

from app.core.Config import settings
from app.db.Session import SessionLocal
from app.core.Security import hash_password
from app.models.people.Student import Student
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.academic.StudentCLass import StudentClass
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term

NAMESPACE = uuid.UUID("85f54867-5180-462c-85bc-8a82beec53e8")
morgan_id = uuid.uuid5(NAMESPACE, "Morgan")
morgan_user_id = uuid.uuid5(NAMESPACE, "morgan_user")

db = SessionLocal()
try:
    print(f"Connecting to database: {settings.database_url}")
    assert "entervene_demo" in settings.database_url.lower(), "Must target Entervene_Demo!"

    pre_pred_count = db.query(DevelopmentCurrentTermPrediction).count()
    pre_inv_count = db.query(Intervention).count()
    print(f"Pre-persistence predictions count: {pre_pred_count}")
    print(f"Pre-persistence interventions count: {pre_inv_count}")

    # 1. Create or verify Morgan UserAccount & Student
    morgan_user = db.get(UserAccount, morgan_user_id)
    if not morgan_user:
        morgan_user = UserAccount(
            user_id=morgan_user_id,
            email="demo-morgan-striving@example.com",
            password_hash=hash_password("DemoMorgan!2026"),
            account_status="active",
            email_status="verified",
        )
        db.add(morgan_user)
        db.flush()
        db.add(UserRoles(user_id=morgan_user_id, role_id=3))

    morgan_student = db.get(Student, morgan_id)
    if not morgan_student:
        morgan_student = Student(
            student_id=morgan_id,
            student_lrn="990000000011",
            first_name="Demo Morgan",
            last_name="Striving",
            dob=date(2011, 4, 15),
            gender="Male",
            email="demo-morgan-striving@example.com",
            academic_level_id=1,
            prior_gwa=Decimal("86.50"),
            user_id=morgan_user_id,
        )
        db.add(morgan_student)
        db.flush()

    morgan_class = db.query(StudentClass).filter_by(student_id=morgan_id, class_id=1).first()
    if not morgan_class:
        morgan_class = StudentClass(
            student_id=morgan_id,
            class_id=1,
            academic_year_id=1,
            enrollment_status="enrolled",
        )
        db.add(morgan_class)
        db.flush()

    # 2. Check/create Quiz on CW 4 (DEMO - WW 4 - Algebraic Expressions)
    cw4_quiz = db.query(Quiz).filter(Quiz.classwork_id == 4).first()
    if not cw4_quiz:
        cw4_quiz = Quiz(
            classwork_id=4,
            total_items=2,
            duration_minutes=30,
            status="PUBLISHED",
        )
        db.add(cw4_quiz)
        db.flush()
        db.add(QuizQuestion(quiz_id=cw4_quiz.quiz_id, question_id=1, display_order=1))
        db.add(QuizQuestion(quiz_id=cw4_quiz.quiz_id, question_id=3, display_order=2))
        db.flush()
    print(f"CW 4 Quiz ID: {cw4_quiz.quiz_id}")

    qqs = db.query(QuizQuestion).filter(QuizQuestion.quiz_id == cw4_quiz.quiz_id).order_by(QuizQuestion.display_order).all()
    print(f"Quiz 4 Questions: {[(qq.quiz_question_id, qq.question_id) for qq in qqs]}")

    # 3. Create submissions for Morgan
    sub_time = datetime(2026, 10, 15, 10, 0, tzinfo=timezone.utc)
    # Check if Morgan already has submissions
    existing_subs = db.query(StudentSubmission).filter_by(student_id=morgan_id).all()
    if not existing_subs:
        # WW 1 (AsgID 1, 20 pts) -> 8.00 / 20.00
        sub_ww1 = StudentSubmission(
            classwork_assignment_id=1,
            student_id=morgan_id,
            status="graded",
            grade=Decimal("8.00"),
            submitted_at=sub_time,
            graded_at=sub_time,
        )
        # WW 4 (AsgID 4, 20 pts, Quiz) -> 10.00 / 20.00
        sub_ww4 = StudentSubmission(
            classwork_assignment_id=4,
            student_id=morgan_id,
            status="graded",
            grade=Decimal("10.00"),
            submitted_at=sub_time,
            graded_at=sub_time,
        )
        # PT 1 (AsgID 5, 40 pts) -> 26.00 / 40.00
        sub_pt1 = StudentSubmission(
            classwork_assignment_id=5,
            student_id=morgan_id,
            status="graded",
            grade=Decimal("26.00"),
            submitted_at=sub_time,
            graded_at=sub_time,
        )
        # PT 3 (AsgID 7, 40 pts) -> 26.00 / 40.00
        sub_pt3 = StudentSubmission(
            classwork_assignment_id=7,
            student_id=morgan_id,
            status="graded",
            grade=Decimal("26.00"),
            submitted_at=sub_time,
            graded_at=sub_time,
        )
        db.add_all([sub_ww1, sub_ww4, sub_pt1, sub_pt3])
        db.flush()

        # QuizAnswer for WW 4 (sub_ww4.submission_id)
        qa1 = QuizAnswer(
            submission_id=sub_ww4.submission_id,
            quiz_question_id=qqs[0].quiz_question_id,
            answer_text="x",
            is_correct=True,
            points_awarded=Decimal("10.00"),
        )
        qa2 = QuizAnswer(
            submission_id=sub_ww4.submission_id,
            quiz_question_id=qqs[1].quiz_question_id,
            answer_text="x = 8",
            is_correct=False,
            points_awarded=Decimal("0.00"),
        )
        db.add_all([qa1, qa2])
        db.flush()

    db.commit()
    print("Academic evidence committed successfully.")

    # 4. Generate and persist prediction via standard service
    model_version = db.query(AIModelVersion).filter_by(
        model_name=CORRECTED_MODEL_NAME,
        model_version_id=2
    ).first()
    assert model_version is not None, "Model version 2 not found!"

    print("\nCalling generate_and_persist_development_current_term for Morgan...")
    result = generate_and_persist_development_current_term(
        student_id=morgan_id,
        class_id=1,
        subject_id=1,
        period_id=1,
        model_version_id=model_version.model_version_id,
        bind=db.get_bind(),
    )
    print("Persistence Result:")
    for k, v in result.items():
        print(f"  {k}: {v}")

    # 5. Verify post-persistence database state
    post_pred_count = db.query(DevelopmentCurrentTermPrediction).count()
    post_inv_count = db.query(Intervention).count()
    print(f"\nPost-persistence predictions count: {post_pred_count} (was {pre_pred_count})")
    print(f"Post-persistence interventions count: {post_inv_count} (was {pre_inv_count})")

    # Inspect Morgan's persisted prediction
    persisted_pred = db.query(DevelopmentCurrentTermPrediction).filter_by(
        prediction_id=result["prediction_id"]
    ).first()
    print(f"\n--- Persisted Prediction (ID: {persisted_pred.prediction_id}) ---")
    print(f"Revision: {persisted_pred.revision}")
    print(f"Predicted Grade: {persisted_pred.predicted_period_grade}")
    print(f"Intervention Level: {persisted_pred.intervention_level}")
    print(f"Intervention Basis: {persisted_pred.intervention_basis}")
    snapshot = persisted_pred.evidence_snapshot
    print(f"Readiness: {snapshot.get('readiness')}")
    print(f"Projected Raw: {snapshot.get('projected_final_term_grade_raw')}")
    print(f"Intervention Reason Codes: {snapshot.get('intervention_reason_codes')}")

    # Inspect Morgan's intervention candidate
    morgan_inv = db.query(Intervention).filter_by(student_id=morgan_id).first()
    print(f"\n--- Morgan Intervention Record ---")
    if morgan_inv:
        print(f"Intervention ID: {morgan_inv.intervention_id}")
        print(f"Status: {morgan_inv.status}")
        print(f"Source Prediction ID: {morgan_inv.source_prediction_id}")
        diag = morgan_inv.diagnosis_snapshot
        print(f"Diagnosis Status: {diag.get('diagnosis_status')}")
        print(f"Components: {diag.get('components')}")
        print(f"Weakest Supported Components: {diag.get('weakest_supported_components')}")
        print(f"Lowest Supported Competencies:")
        for comp in diag.get("lowest_supported_competencies", []):
            print(f"  CompID: {comp['competency_id']}, Code: {comp['competency_code']}")
            print(f"  Statement: {comp['competency_statement']}")
            print(f"  Score: {comp['score']}/{comp['possible_score']} ({comp['percent']}%)")
            print(f"  Supporting items count: {len(comp['supporting_scores'])}")
        print(f"Manual Assessment Coverage Count: {len(diag.get('manual_assessment_coverage', []))}")
        print(f"Competency Detail Status: {diag.get('competency_detail_status')}")
        print(f"External Assessment Detail Status: {diag.get('external_assessment_detail_status')}")
    else:
        print("NO Intervention Record Found for Morgan!")

    # Verify other students' interventions are completely untouched
    print("\n--- Verifying Other Students Interventions ---")
    all_invs = db.query(Intervention).order_by(Intervention.intervention_id).all()
    for inv in all_invs:
        s = db.get(Student, inv.student_id)
        print(f"Inv ID {inv.intervention_id}: Student={s.first_name} {s.last_name}, Status={inv.status}, Reason={inv.resolution_reason}")

finally:
    db.close()
