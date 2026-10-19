import os, sys, uuid
from datetime import datetime, timezone, date
from decimal import Decimal

os.environ['ENV_FILE'] = '.env.demo'
sys.path.insert(0, os.path.abspath('.'))

from app.core.Config import settings
from app.db.Session import SessionLocal
from app.models.people.Student import Student
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.academic.StudentCLass import StudentClass
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.ai.AIModelVersion import AIModelVersion
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction import DevelopmentCurrentTermPredictionService as pred_service
from app.services.prediction import DevelopmentCurrentTermRiskService as risk_service
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persist_service
from app.services.intervention.InterventionDiagnosisService import build_candidate_diagnosis
from app.services.intervention.InterventionCandidateService import sync_intervention_for_persisted_prediction
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention

NAMESPACE = uuid.UUID("85f54867-5180-462c-85bc-8a82beec53e8")
morgan_id = uuid.uuid5(NAMESPACE, "Morgan")
morgan_user_id = uuid.uuid5(NAMESPACE, "morgan_user")

db = SessionLocal()
try:
    print(f"Target DB: {settings.database_url}")
    print(f"Morgan Student UUID: {morgan_id}")
    print(f"Morgan User UUID: {morgan_user_id}")

    # Rehearsal in a transaction that will be ROLLED BACK
    # 1. Create Morgan UserAccount & Student
    from app.core.Security import hash_password
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

    morgan_class = StudentClass(
        student_id=morgan_id,
        class_id=1,
        academic_year_id=1,
        enrollment_status="enrolled",
    )
    db.add(morgan_class)
    db.flush()

    # 2. Check/create Quiz on CW 4 (DEMO - WW 4 - Algebraic Expressions)
    # CW 4: classwork_id = 4, classwork_assignment_id = 4
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
        # Add questions 1 and 3 to Quiz 4
        db.add(QuizQuestion(quiz_id=cw4_quiz.quiz_id, question_id=1, display_order=1))
        db.add(QuizQuestion(quiz_id=cw4_quiz.quiz_id, question_id=3, display_order=2))
        db.flush()
    print(f"CW 4 Quiz ID: {cw4_quiz.quiz_id}")
    qqs = db.query(QuizQuestion).filter(QuizQuestion.quiz_id == cw4_quiz.quiz_id).order_by(QuizQuestion.display_order).all()
    print(f"Quiz 4 Questions: {[(qq.quiz_question_id, qq.question_id) for qq in qqs]}")

    # 3. Create submissions for Morgan
    sub_time = datetime(2026, 10, 15, 10, 0, tzinfo=timezone.utc)
    # Sub 1: WW 1 (AsgID 1, 20 pts) -> 8.00 / 20.00
    sub_ww1 = StudentSubmission(
        classwork_assignment_id=1,
        student_id=morgan_id,
        status="graded",
        grade=Decimal("8.00"),
        submitted_at=sub_time,
        graded_at=sub_time,
    )
    # Sub 2: WW 4 (AsgID 4, 20 pts, Quiz) -> 10.00 / 20.00
    sub_ww4 = StudentSubmission(
        classwork_assignment_id=4,
        student_id=morgan_id,
        status="graded",
        grade=Decimal("10.00"),
        submitted_at=sub_time,
        graded_at=sub_time,
    )
    # Sub 3: PT 1 (AsgID 5, 40 pts) -> 26.00 / 40.00
    sub_pt1 = StudentSubmission(
        classwork_assignment_id=5,
        student_id=morgan_id,
        status="graded",
        grade=Decimal("26.00"),
        submitted_at=sub_time,
        graded_at=sub_time,
    )
    # Sub 4: PT 3 (AsgID 7, 40 pts) -> 26.00 / 40.00
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

    # 4. Create QuizAnswer for WW 4 (sub_ww4.submission_id)
    # Question 1 (10 pts): Correct (Option 1 'x') -> 10.00
    # Question 3 (10 pts): Incorrect (Option 7 'x = 8') -> 0.00
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

    # 5. Check Feature Builder & Readiness
    cutoff = datetime.now(timezone.utc)
    features_result = build_current_period_features_from_records(
        db, morgan_id, 1, 1, 1, cutoff_at=cutoff
    )
    print("\n--- Feature Builder Output ---")
    print("Ready:", features_result["ready"])
    print("Readiness Level:", features_result["readiness_level"])
    print("Readiness Reason Codes:", features_result["readiness_reason_codes"])
    print("Evidence Summary:", features_result["evidence_summary"])
    print("WW Earned:", features_result["features"]["ww_points_earned_so_far"], "WW Possible:", features_result["features"]["ww_points_possible_so_far"], "WW%:", features_result["features"]["ww_percent_so_far"])
    print("PT Earned:", features_result["features"]["pt_points_earned_so_far"], "PT Possible:", features_result["features"]["pt_points_possible_so_far"], "PT%:", features_result["features"]["pt_percent_so_far"])
    print("Observed Component Weight:", features_result["features"].get("observed_component_weight_sum"))

    # 6. Predict via Development Prediction Service
    pred = pred_service.predict_development_current_term(
        db, morgan_id, 1, 1, 1, cutoff_at=cutoff, model_name=CORRECTED_MODEL_NAME
    )
    print("\n--- Prediction Output ---")
    print("Status:", pred["status"])
    print("Projected Grade:", pred["projected_final_term_grade"])
    print("Domain Result:", pred["domain_result"])

    # 7. Intervention Assessment
    intervention_assessment = risk_service.assess_development_current_term_intervention(pred)
    print("\n--- Risk Assessment ---")
    print("Intervention Level:", intervention_assessment["intervention_level"])
    print("Triggered Reasons:", intervention_assessment["triggered_reasons"])

    # 8. Test Diagnosis Snapshot
    dummy_pred = DevelopmentCurrentTermPrediction(
        student_id=morgan_id,
        class_id=1,
        subject_id=1,
        source_period_id=1,
        target_period_id=1,
        model_version_id=2,
        revision=1,
        predicted_period_grade=Decimal(str(pred["projected_final_term_grade"])),
        intervention_level=intervention_assessment["intervention_level"],
        intervention_basis=intervention_assessment["intervention_basis"],
        evidence_snapshot={
            "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []},
            "generation_cutoff_at": cutoff.isoformat(),
            "model_features": [{"name": k, "value": v} for k, v in features_result["features"].items()],
            "projected_final_term_grade_raw": pred["projected_final_term_grade"],
        }
    )
    diagnosis = build_candidate_diagnosis(db, dummy_pred)
    print("\n--- Candidate Diagnosis Snapshot ---")
    print("Diagnosis Status:", diagnosis["diagnosis_status"])
    print("Components:", diagnosis["components"])
    print("Weakest Supported Components:", diagnosis["weakest_supported_components"])
    print("Lowest Supported Competencies:")
    for comp in diagnosis["lowest_supported_competencies"]:
        print(f"  CompID: {comp['competency_id']}, Code: {comp['competency_code']}")
        print(f"  Statement: {comp['competency_statement']}")
        print(f"  Score: {comp['score']}/{comp['possible_score']} ({comp['percent']}%)")
        print(f"  Supporting items count: {len(comp['supporting_scores'])}")
    print("Manual Assessment Coverage Count:", len(diagnosis["manual_assessment_coverage"]))

    # 9. Test Candidate Synchronization
    # Need to save dummy_pred to test sync_intervention_for_persisted_prediction
    dummy_pred.prediction_id = 999
    db.add(dummy_pred)
    db.flush()
    synced_inv = sync_intervention_for_persisted_prediction(
        db, dummy_pred,
        student_id=morgan_id,
        class_id=1,
        subject_id=1,
        academic_period_id=1,
    )
    print("\n--- Synced Intervention Candidate ---")
    if synced_inv:
        print(f"Candidate Created: Yes! Inv ID: {synced_inv.intervention_id}, Status: {synced_inv.status}")
        diag = synced_inv.diagnosis_snapshot
        print(f"Candidate Diagnosis Snapshot Version: {diag.get('snapshot_version')}")
        print(f"Weakest Components in Stored Diagnosis: {diag.get('weakest_supported_components')}")
        print(f"Lowest Competencies in Stored Diagnosis: {len(diag.get('lowest_supported_competencies', []))} items")
    else:
        print("Candidate Created: No!")

    print("\nSUCCESS: All rehearsal steps validated!")
finally:
    db.rollback()
    db.close()
    print("Rolled back isolated rehearsal transaction. Database is pristine.")
