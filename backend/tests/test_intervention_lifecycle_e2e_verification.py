"""Task 5 — End-to-End Intervention Lifecycle & Prediction Refresh Verification."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.classwork.RemediationReadingPrerequisite import (
    RemediationReadingPrerequisite,
)
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.notifications.Notification import Notification
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Activity import BulkScoreItem, BulkScoreUpdateRequest
from app.schemas.Quiz import (
    QuizAnswerIn,
    QuizSubmitRequest,
    TeacherGradeQuizSubmissionRequest,
    TeacherQuizAnswerGradeItem,
)
from app.schemas.Submission import GradeRequest
from app.services.activity.ActivityService import bulk_update_activity_scores
from app.services.intervention.RemediationPrerequisiteService import (
    evaluate_remediation_prerequisite,
)
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate,
    continue_teacher_active_intervention,
    resolve_teacher_active_intervention,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_current_period_features_from_records,
)
from app.services.quiz.QuizAnalysisService import grade_teacher_quiz_submission
from app.services.quiz.QuizAttemptService import (
    start_student_quiz_attempt,
    submit_student_quiz_attempt,
)
from app.services.submission.SubmissionService import grade_student_submission
from tests.test_current_period_live_feature_builder import (  # noqa: F401
    add_activity,
    current_period_context,
)
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_intervention_candidate_sync import _setup


def _bootstrap_scope(ctx):
    db = ctx["db"]
    if not db.query(Role).filter_by(role_id=1).first():
        db.add(Role(role_id=1, role_name="teacher"))
    if not db.query(Role).filter_by(role_id=2).first():
        db.add(Role(role_id=2, role_name="admin"))
    db.flush()
    if not db.query(UserRoles).filter_by(user_id=ctx["staff"].user_id, role_id=1).first():
        db.add(UserRoles(user_id=ctx["staff"].user_id, role_id=1))
    if not db.query(StudentClass).filter_by(
        student_id=ctx["student"].student_id,
        academic_year_id=ctx["class"].academic_year_id,
    ).first():
        db.add(StudentClass(
            student_id=ctx["student"].student_id,
            class_id=ctx["class"].class_id,
            academic_year_id=ctx["class"].academic_year_id,
            enrollment_status="enrolled",
        ))
    load = db.query(SubjectLoad).filter_by(
        staff_id=ctx["staff"].staff_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    ).first()
    if load is None:
        db.add(SubjectLoad(
            staff_id=ctx["staff"].staff_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            status="published",
            is_active_version=True,
        ))
    else:
        load.status = "published"
        load.is_active_version = True
    db.commit()


def _create_mc_quiz(
    ctx,
    *,
    title: str,
    max_attempts: int = 3,
    intervention_id: int | None = None,
    recipient_student_id=None,
    category: str = "WRITTEN_WORK",
    total_points: int = 10,
    original_exam_assignment_id: int | None = None,
    exam_subtype: str | None = None,
):
    db = ctx["db"]
    cw = Classwork(
        title=title,
        classwork_type="QUIZ",
        classwork_category=category,
        exam_subtype=exam_subtype,
        is_graded=True,
        total_points=Decimal(str(total_points)),
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
        show_scores=True,
    )
    db.add(cw)
    db.flush()
    asgn = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
        due_date=datetime.now(timezone.utc) + timedelta(days=5),
        max_attempts=max_attempts,
        recipient_student_id=recipient_student_id,
        source_intervention_id=intervention_id,
        remediation_request_id=uuid4() if intervention_id is not None else None,
        original_exam_assignment_id=original_exam_assignment_id,
    )
    db.add(asgn)
    db.flush()
    quiz = Quiz(
        classwork_id=cw.classwork_id,
        status="PUBLISHED",
        total_items=2,
        duration_minutes=30,
    )
    db.add(quiz)
    db.flush()
    db.add(QuizSetting(
        classwork_id=cw.classwork_id,
        max_attempts=max_attempts,
        show_correct_answers=True,
        summary_release_mode="IMMEDIATE",
    ))
    q1 = Question(
        question_text="Q1",
        question_type="MULTIPLE_CHOICE",
        points=Decimal(str(total_points * 7 // 10)),
    )
    q2 = Question(
        question_text="Q2",
        question_type="MULTIPLE_CHOICE",
        points=Decimal(str(total_points - (total_points * 7 // 10))),
    )
    db.add_all([q1, q2])
    db.flush()
    q1_ok = QuestionOption(question_id=q1.question_id, option_text="Right 1", is_correct=True, option_order=1)
    q1_bad = QuestionOption(question_id=q1.question_id, option_text="Wrong 1", is_correct=False, option_order=2)
    q2_ok = QuestionOption(question_id=q2.question_id, option_text="Right 2", is_correct=True, option_order=1)
    q2_bad = QuestionOption(question_id=q2.question_id, option_text="Wrong 2", is_correct=False, option_order=2)
    db.add_all([q1_ok, q1_bad, q2_ok, q2_bad])
    db.flush()
    qq1 = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q1.question_id, display_order=1)
    qq2 = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q2.question_id, display_order=2)
    db.add_all([qq1, qq2])
    if intervention_id is not None:
        reading_cw = Classwork(
            title=f"Reading for {title}",
            classwork_type="READING",
            is_graded=False,
            total_points=None,
            subject_id=ctx["subject"].subject_id,
            created_by_staff_id=ctx["staff"].staff_id,
            is_published=True,
        )
        db.add(reading_cw)
        db.flush()
        reading_asgn = ClassworkAssignment(
            classwork_id=reading_cw.classwork_id,
            class_id=ctx["class"].class_id,
            academic_period_id=ctx["period"].academic_period_id,
            assigned_by_staff_id=ctx["staff"].staff_id,
            is_published=True,
        )
        db.add(reading_asgn)
        db.flush()
        db.add(RemediationReadingPrerequisite(
            remediation_assignment_id=asgn.classwork_assignment_id,
            reading_classwork_id=reading_cw.classwork_id,
            reading_assignment_id=reading_asgn.classwork_assignment_id,
            display_order=1,
        ))
        db.add(InterventionReadingReview(
            intervention_id=intervention_id,
            reading_assignment_id=reading_asgn.classwork_assignment_id,
            student_id=recipient_student_id or ctx["student"].student_id,
            review_cycle=1,
        ))
    db.commit()
    return cw, asgn, {
        "qq1": qq1.quiz_question_id,
        "qq2": qq2.quiz_question_id,
        "q1_ok": q1_ok.option_id,
        "q1_bad": q1_bad.option_id,
        "q2_ok": q2_ok.option_id,
        "q2_bad": q2_bad.option_id,
    }


def _score_from_features(features: dict) -> float:
    """Deterministic linear proxy so predictions move visibly with WW/PT/QA changes."""
    return round(
        0.5 * float(features["ww_percent_so_far"]) + 0.5 * float(features["pt_percent_so_far"]),
        2,
    )


def test_scenario_1_2_3_5_6_full_intervention_lifecycle_and_regular_limits(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    db = ctx["db"]
    _bootstrap_scope(ctx)

    # Scenario 1: Prediction -> Candidate (HIGH_RISK below target 85) -> ACTIVE
    model_id = _setup(ctx, monkeypatch, [70.0, 70.0])
    first = _run(ctx, model_id)
    assert first["intervention_level"] == "HIGH_RISK"
    candidate = db.query(Intervention).filter_by(source_prediction_id=first["prediction_id"]).one()
    assert candidate.status == "CANDIDATE"

    activate_teacher_candidate(db, ctx["staff"].staff_id, candidate.intervention_id)
    db.expire_all()
    active = db.get(Intervention, candidate.intervention_id)
    assert active is not None and active.status == "ACTIVE"

    # Scenario 2a: Remediation quiz stops after passing on Attempt 2
    _, pass_asgn, pass_q = _create_mc_quiz(
        ctx,
        title="Remediation Quiz Pass",
        max_attempts=3,
        intervention_id=active.intervention_id,
        recipient_student_id=ctx["student"].student_id,
    )
    # Attempt 1: 3/10 (30% < 85% -> fail)
    start_student_quiz_attempt(db, ctx["student"], pass_asgn.classwork_assignment_id)
    submit_student_quiz_attempt(
        db,
        ctx["student"],
        pass_asgn.classwork_assignment_id,
        QuizSubmitRequest(answers=[
            QuizAnswerIn(quiz_question_id=pass_q["qq1"], selected_option_id=pass_q["q1_bad"]),
            QuizAnswerIn(quiz_question_id=pass_q["qq2"], selected_option_id=pass_q["q2_ok"]),
        ]),
    )
    # Attempt 2: 10/10 (100% >= 85% -> pass!)
    start_student_quiz_attempt(db, ctx["student"], pass_asgn.classwork_assignment_id)
    submit_student_quiz_attempt(
        db,
        ctx["student"],
        pass_asgn.classwork_assignment_id,
        QuizSubmitRequest(answers=[
            QuizAnswerIn(quiz_question_id=pass_q["qq1"], selected_option_id=pass_q["q1_ok"]),
            QuizAnswerIn(quiz_question_id=pass_q["qq2"], selected_option_id=pass_q["q2_ok"]),
        ]),
    )
    # Attempt 3 must be blocked after pass
    with pytest.raises(HTTPException) as exc:
        start_student_quiz_attempt(db, ctx["student"], pass_asgn.classwork_assignment_id)
    assert exc.value.status_code == 403
    assert db.query(StudentSubmission).filter_by(
        classwork_assignment_id=pass_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
    ).count() == 2

    # Scenario 2b: Remediation quiz failing all 3 attempts -> locked + Needs Teacher Review + notification
    _, fail_asgn, fail_q = _create_mc_quiz(
        ctx,
        title="Remediation Quiz 3 Fails",
        max_attempts=3,
        intervention_id=active.intervention_id,
        recipient_student_id=ctx["student"].student_id,
    )
    for _ in range(3):
        start_student_quiz_attempt(db, ctx["student"], fail_asgn.classwork_assignment_id)
        submit_student_quiz_attempt(
            db,
            ctx["student"],
            fail_asgn.classwork_assignment_id,
            QuizSubmitRequest(answers=[
                QuizAnswerIn(quiz_question_id=fail_q["qq1"], selected_option_id=fail_q["q1_bad"]),
                QuizAnswerIn(quiz_question_id=fail_q["qq2"], selected_option_id=fail_q["q2_bad"]),
            ]),
        )
    with pytest.raises(HTTPException) as exc:
        start_student_quiz_attempt(db, ctx["student"], fail_asgn.classwork_assignment_id)
    assert exc.value.status_code == 403
    assert "Needs Teacher Review" in str(exc.value.detail)
    assert db.query(StudentSubmission).filter_by(
        classwork_assignment_id=fail_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
    ).count() == 3
    review_notifs = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_needs_teacher_review",
    ).all()
    assert len(review_notifs) == 1

    # Scenario 3: Regular classwork quiz retains teacher-configured max_attempts=5 (not capped to 3)
    _, reg_asgn, reg_q = _create_mc_quiz(
        ctx,
        title="Regular Practice Quiz",
        max_attempts=5,
        intervention_id=None,
    )
    for attempt_idx in range(1, 6):
        start_student_quiz_attempt(db, ctx["student"], reg_asgn.classwork_assignment_id)
        resp = submit_student_quiz_attempt(
            db,
            ctx["student"],
            reg_asgn.classwork_assignment_id,
            QuizSubmitRequest(answers=[
                QuizAnswerIn(quiz_question_id=reg_q["qq1"], selected_option_id=reg_q["q1_bad"]),
                QuizAnswerIn(quiz_question_id=reg_q["qq2"], selected_option_id=reg_q["q2_ok"]),
            ]),
        )
        assert resp.attempt_count == attempt_idx
        assert resp.max_attempts == 5
    with pytest.raises(HTTPException) as exc:
        start_student_quiz_attempt(db, ctx["student"], reg_asgn.classwork_assignment_id)
    assert exc.value.status_code == 403

    # Add one unfinished remediation assignment to verify Scenario 5 & 6 unfinished work handling
    _, unfinished_asgn, _ = _create_mc_quiz(
        ctx,
        title="Unfinished Remediation Quiz",
        max_attempts=3,
        intervention_id=active.intervention_id,
        recipient_student_id=ctx["student"].student_id,
    )
    start_student_quiz_attempt(db, ctx["student"], unfinished_asgn.classwork_assignment_id)

    # Scenario 5: New prediction reaches target (>= 85) -> ACTIVE stays ACTIVE + single notification
    grades = iter([89.0, 89.0, 89.0, 89.0])
    monkeypatch.setattr(
        scorer,
        "score_development_current_term",
        lambda _features, model_name=None: next(grades),
    )
    add_activity(ctx, "WRITTEN_WORK", 10, 10, title="WW Boost")
    db.commit()
    improved = _run(ctx, model_id)
    assert improved["projected_final_term_grade"] == 89.0

    db.expire_all()
    active = db.get(Intervention, active.intervention_id)
    assert active.status == "ACTIVE"
    rec_notifs = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolution_recommended",
    ).all()
    assert len(rec_notifs) == 1

    # Teacher chooses Continue Support -> remains ACTIVE, pending unfinished quiz stays allowed
    continued = continue_teacher_active_intervention(db, ctx["staff"].staff_id, active.intervention_id)
    assert continued.status == "ACTIVE"
    assert evaluate_remediation_prerequisite(db, unfinished_asgn, ctx["student"]).allowed is True

    # Teacher later confirms Resolve Intervention -> transitions to RESOLVED
    resolved = resolve_teacher_active_intervention(db, ctx["staff"].staff_id, active.intervention_id)
    assert resolved.status == "RESOLVED"
    assert resolved.resolution_reason == "IMPROVED_PREDICTION"

    # Scenario 6: Completed work stays reviewable; unfinished work blocked; history preserved
    assert evaluate_remediation_prerequisite(
        db, pass_asgn, ctx["student"], allow_completed_resolved_review=True,
    ).allowed is True
    unfinished_decision = evaluate_remediation_prerequisite(db, unfinished_asgn, ctx["student"])
    assert unfinished_decision.allowed is False
    assert unfinished_decision.code == "INTERVENTION_NOT_ACTIVE"
    assert db.query(StudentSubmission).filter_by(
        classwork_assignment_id=fail_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
    ).count() == 3


def test_scenario_4_remediation_quiz_retake_lower_attempt_2_refreshes_prediction(
    current_period_context, monkeypatch,
):
    """Scenario 4a: Remediation WW quiz Attempt 1 = 7/10 (eff 4->7), Attempt 2 = 3/10 (eff 7->4) MUST refresh prediction."""
    ctx = current_period_context
    db = ctx["db"]
    _bootstrap_scope(ctx)

    model_id = _setup(ctx, monkeypatch, [70.0])
    # Dynamic deterministic scorer driven by actual WW/PT feature percentages
    monkeypatch.setattr(
        scorer,
        "score_development_current_term",
        lambda features, model_name=None: _score_from_features(features),
    )

    # Add an original WW assignment with low score 4/10
    orig_asgn = add_activity(ctx, "WRITTEN_WORK", 4, 10, title="WW Low Original")
    db.commit()
    baseline = _run(ctx, model_id)
    baseline_grade = baseline["projected_final_term_grade"]
    baseline_rev = baseline["revision"]

    candidate = db.query(Intervention).filter_by(source_prediction_id=baseline["prediction_id"]).one()
    activate_teacher_candidate(db, ctx["staff"].staff_id, candidate.intervention_id)
    db.expire_all()
    active = db.get(Intervention, candidate.intervention_id)

    # Link a 10-point remediation WW quiz to orig_asgn (cap = 75% -> 7.5/10)
    _, rem_asgn, rem_q = _create_mc_quiz(
        ctx,
        title="WW Remediation Quiz",
        max_attempts=3,
        intervention_id=active.intervention_id,
        recipient_student_id=ctx["student"].student_id,
        category="WRITTEN_WORK",
        total_points=10,
    )
    db.add(RemediationAssignmentLink(
        student_id=ctx["student"].student_id,
        original_assignment_id=orig_asgn.classwork_assignment_id,
        remediation_assignment_id=rem_asgn.classwork_assignment_id,
        source_intervention_id=active.intervention_id,
        component="WRITTEN_WORK",
        score_adjustment_cap=Decimal("75.00"),
        created_by_staff_id=ctx["staff"].staff_id,
    ))
    db.commit()

    # Attempt 1: 7/10 (70% < 85% target, effective score rises 4 -> 7)
    start_student_quiz_attempt(db, ctx["student"], rem_asgn.classwork_assignment_id)
    submit_student_quiz_attempt(
        db,
        ctx["student"],
        rem_asgn.classwork_assignment_id,
        QuizSubmitRequest(answers=[
            QuizAnswerIn(quiz_question_id=rem_q["qq1"], selected_option_id=rem_q["q1_ok"]),
            QuizAnswerIn(quiz_question_id=rem_q["qq2"], selected_option_id=rem_q["q2_bad"]),
        ]),
    )
    db.expire_all()
    after_att1 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert after_att1.revision == baseline_rev + 1
    assert float(after_att1.predicted_period_grade) > baseline_grade

    # Start Attempt 2 -> should NOT spuriously refresh before submission
    start_student_quiz_attempt(db, ctx["student"], rem_asgn.classwork_assignment_id)
    db.expire_all()
    after_start2 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert after_start2.revision == after_att1.revision

    # Submit Attempt 2: 3/10 (LOWER than Attempt 1's 7/10 AND <= Original 4/10 -> effective drops 7 -> 4)
    submit_student_quiz_attempt(
        db,
        ctx["student"],
        rem_asgn.classwork_assignment_id,
        QuizSubmitRequest(answers=[
            QuizAnswerIn(quiz_question_id=rem_q["qq1"], selected_option_id=rem_q["q1_bad"]),
            QuizAnswerIn(quiz_question_id=rem_q["qq2"], selected_option_id=rem_q["q2_ok"]),
        ]),
    )
    db.expire_all()
    after_att2 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert after_att2.revision == after_att1.revision + 1
    assert float(after_att2.predicted_period_grade) == pytest.approx(baseline_grade, abs=0.01)


def test_scenario_4_non_quiz_and_bulk_and_manual_quiz_retakes_lower_attempt_2_refresh_prediction(
    current_period_context, monkeypatch,
):
    """Scenario 4b/4c/4d/4e: Non-quiz SubmissionService, ActivityService bulk grading, manual QuizAnalysisService, and same-timestamp tie-breaking all refresh prediction when Attempt 2 < Attempt 1."""
    ctx = current_period_context
    db = ctx["db"]
    _bootstrap_scope(ctx)

    model_id = _setup(ctx, monkeypatch, [70.0])
    monkeypatch.setattr(
        scorer,
        "score_development_current_term",
        lambda features, model_name=None: _score_from_features(features),
    )

    orig_pt = add_activity(ctx, "PERFORMANCE_TASK", 4, 10, title="PT Low Original")
    db.commit()
    baseline = _run(ctx, model_id)
    baseline_grade = baseline["projected_final_term_grade"]

    candidate = db.query(Intervention).filter_by(source_prediction_id=baseline["prediction_id"]).one()
    activate_teacher_candidate(db, ctx["staff"].staff_id, candidate.intervention_id)
    db.expire_all()
    active = db.get(Intervention, candidate.intervention_id)

    # Create a remediation ASSIGNMENT linked to orig_pt (cap 75% -> 7.5/10)
    rem_cw = Classwork(
        title="PT Remediation Assignment",
        classwork_type="ASSIGNMENT",
        classwork_category="PERFORMANCE_TASK",
        is_graded=True,
        total_points=Decimal("10"),
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
        show_scores=True,
    )
    db.add(rem_cw)
    db.flush()
    rem_asgn = ClassworkAssignment(
        classwork_id=rem_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
        due_date=datetime.now(timezone.utc) + timedelta(days=5),
        max_attempts=3,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=active.intervention_id,
        remediation_request_id=uuid4(),
    )
    db.add(rem_asgn)
    db.flush()
    db.add(RemediationAssignmentLink(
        student_id=ctx["student"].student_id,
        original_assignment_id=orig_pt.classwork_assignment_id,
        remediation_assignment_id=rem_asgn.classwork_assignment_id,
        source_intervention_id=active.intervention_id,
        component="PERFORMANCE_TASK",
        score_adjustment_cap=Decimal("75.00"),
        created_by_staff_id=ctx["staff"].staff_id,
    ))
    db.commit()

    # Attempt 1 via SubmissionService: graded 7/10 -> effective rises 4 -> 7
    att1 = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_asgn.classwork_assignment_id,
        status="submitted",
        submitted_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        attempt_count=1,
    )
    db.add(att1)
    db.commit()
    grade_student_submission(att1.submission_id, GradeRequest(grade=7.0, feedback="Good try"), ctx["staff"].staff_id, db)
    db.expire_all()
    p1 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert float(p1.predicted_period_grade) > baseline_grade

    # Attempt 2 via SubmissionService: graded 3/10 (lower than Attempt 1) -> effective drops 7 -> 4
    att2 = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_asgn.classwork_assignment_id,
        status="submitted",
        submitted_at=datetime.now(timezone.utc),
        attempt_count=2,
    )
    db.add(att2)
    db.commit()
    grade_student_submission(att2.submission_id, GradeRequest(grade=3.0, feedback="Lower attempt 2"), ctx["staff"].staff_id, db)
    db.expire_all()
    p2 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert p2.revision == p1.revision + 1
    assert float(p2.predicted_period_grade) == pytest.approx(baseline_grade, abs=0.01)

    # Attempt 3 graded via ActivityService.bulk_update_activity_scores (first raise to 7, then clear/drop via re-grade)
    rem_act_cw = Classwork(
        title="PT Bulk Activity",
        classwork_type="ACTIVITY",
        classwork_category="PERFORMANCE_TASK",
        activity_mode="ONLINE",
        is_graded=True,
        total_points=Decimal("10"),
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
        show_scores=True,
    )
    orig_pt2 = add_activity(ctx, "PERFORMANCE_TASK", 4, 10, title="PT Low Original 2")
    db.add(rem_act_cw)
    db.flush()
    rem_act_asgn = ClassworkAssignment(
        classwork_id=rem_act_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
        max_attempts=3,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=active.intervention_id,
        remediation_request_id=uuid4(),
    )
    db.add(rem_act_asgn)
    db.flush()
    db.add(RemediationAssignmentLink(
        student_id=ctx["student"].student_id,
        original_assignment_id=orig_pt2.classwork_assignment_id,
        remediation_assignment_id=rem_act_asgn.classwork_assignment_id,
        source_intervention_id=active.intervention_id,
        component="PERFORMANCE_TASK",
        score_adjustment_cap=Decimal("75.00"),
        created_by_staff_id=ctx["staff"].staff_id,
    ))
    act_att1 = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_act_asgn.classwork_assignment_id,
        status="submitted",
        submitted_at=datetime.now(timezone.utc) - timedelta(minutes=2),
        attempt_count=1,
    )
    db.add(act_att1)
    db.commit()

    p_before_bulk = _run(ctx, model_id)
    bulk_update_activity_scores(
        db,
        ctx["staff"].staff_id,
        rem_act_cw.classwork_id,
        BulkScoreUpdateRequest(
            class_id=ctx["class"].class_id,
            scores=[BulkScoreItem(student_id=ctx["student"].student_id, score=7.0)],
        ),
    )
    db.expire_all()
    p_bulk1 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert float(p_bulk1.predicted_period_grade) > p_before_bulk["projected_final_term_grade"]

    act_att2 = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_act_asgn.classwork_assignment_id,
        status="submitted",
        submitted_at=datetime.now(timezone.utc),
        attempt_count=2,
    )
    db.add(act_att2)
    db.commit()
    bulk_update_activity_scores(
        db,
        ctx["staff"].staff_id,
        rem_act_cw.classwork_id,
        BulkScoreUpdateRequest(
            class_id=ctx["class"].class_id,
            scores=[BulkScoreItem(student_id=ctx["student"].student_id, score=2.0)],
        ),
    )
    db.expire_all()
    p_bulk2 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert p_bulk2.revision == p_bulk1.revision + 1
    assert float(p_bulk2.predicted_period_grade) == pytest.approx(p_before_bulk["projected_final_term_grade"], abs=0.01)

    # Scenario 4d: Manual quiz grading via QuizAnalysisService on Attempt 2 < Attempt 1
    orig_ww3 = add_activity(ctx, "WRITTEN_WORK", 4, 10, title="WW Low Original 3")
    _, man_asgn, man_q = _create_mc_quiz(
        ctx,
        title="Manual Graded Rem Quiz",
        max_attempts=3,
        intervention_id=active.intervention_id,
        recipient_student_id=ctx["student"].student_id,
        category="WRITTEN_WORK",
        total_points=10,
    )
    db.add(RemediationAssignmentLink(
        student_id=ctx["student"].student_id,
        original_assignment_id=orig_ww3.classwork_assignment_id,
        remediation_assignment_id=man_asgn.classwork_assignment_id,
        source_intervention_id=active.intervention_id,
        component="WRITTEN_WORK",
        score_adjustment_cap=Decimal("75.00"),
        created_by_staff_id=ctx["staff"].staff_id,
    ))
    same_ts = datetime.now(timezone.utc)
    mq_att1 = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=man_asgn.classwork_assignment_id,
        status="graded",
        grade=Decimal("7"),
        submitted_at=same_ts,
        graded_at=same_ts,
        attempt_count=1,
    )
    mq_att2 = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=man_asgn.classwork_assignment_id,
        status="submitted",
        grade=None,
        submitted_at=same_ts,
        attempt_count=2,
    )
    db.add_all([mq_att1, mq_att2])
    db.commit()
    p_before_manual = _run(ctx, model_id)

    grade_teacher_quiz_submission(
        db,
        ctx["staff"].staff_id,
        mq_att2.submission_id,
        TeacherGradeQuizSubmissionRequest(
            answers=[
                TeacherQuizAnswerGradeItem(quiz_question_id=man_q["qq1"], points_awarded=2.0),
                TeacherQuizAnswerGradeItem(quiz_question_id=man_q["qq2"], points_awarded=0.0),
            ],
            override_total_grade=2.0,
        ),
    )
    db.expire_all()
    p_after_manual = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert p_after_manual.revision == p_before_manual["revision"] + 1
    assert float(p_after_manual.predicted_period_grade) < p_before_manual["projected_final_term_grade"]

    # Scenario 4f: Same-timestamp multi-attempt tie-breaking does NOT trigger UNRESOLVED_EVIDENCE
    mq_att2.graded_at = same_ts
    db.commit()
    built = build_current_period_features_from_records(
        db,
        ctx["student"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period"].academic_period_id,
    )
    assert built["ready"] is True
    assert "UNRESOLVED_EVIDENCE" not in built["readiness_reason_codes"]


def test_scenario_4e_remediation_exam_retake_lower_attempt_2_refreshes_prediction(
    current_period_context, monkeypatch,
):
    """Scenario 4e: Remediation Exam Attempt 1 = 70/100 (eff 40->70), Attempt 2 = 30/100 (eff 70->40) MUST refresh prediction."""
    ctx = current_period_context
    db = ctx["db"]
    _bootstrap_scope(ctx)

    model_id = _setup(ctx, monkeypatch, [70.0])
    monkeypatch.setattr(
        scorer,
        "score_development_current_term",
        lambda features, model_name=None: round(
            0.35 * float(features["ww_percent_so_far"])
            + 0.35 * float(features["pt_percent_so_far"])
            + 0.30 * float(features["qa_percent_so_far"]),
            2,
        ),
    )

    # Complete exam observations (Summative 1, Summative 2, Term Exam = 40/100)
    add_activity(ctx, "EXAMS", 80, 100, exam_subtype="SUMMATIVE_1", title="Summative 1")
    add_activity(ctx, "EXAMS", 80, 100, exam_subtype="SUMMATIVE_2", title="Summative 2")
    orig_exam = add_activity(ctx, "EXAMS", 40, 100, exam_subtype="TERM_EXAM", title="Term Exam")
    db.commit()

    baseline = _run(ctx, model_id)
    baseline_grade = baseline["projected_final_term_grade"]
    candidate = db.query(Intervention).filter_by(source_prediction_id=baseline["prediction_id"]).one()
    activate_teacher_candidate(db, ctx["staff"].staff_id, candidate.intervention_id)
    db.expire_all()
    active = db.get(Intervention, candidate.intervention_id)

    _, rem_exam_asgn, rem_exam_q = _create_mc_quiz(
        ctx,
        title="Remedial Term Exam",
        max_attempts=3,
        intervention_id=active.intervention_id,
        recipient_student_id=ctx["student"].student_id,
        category="EXAMS",
        total_points=100,
        original_exam_assignment_id=orig_exam.classwork_assignment_id,
        exam_subtype="TERM_EXAM",
    )

    # Attempt 1: 70/100 (raises effective exam 40 -> 70)
    start_student_quiz_attempt(db, ctx["student"], rem_exam_asgn.classwork_assignment_id)
    submit_student_quiz_attempt(
        db,
        ctx["student"],
        rem_exam_asgn.classwork_assignment_id,
        QuizSubmitRequest(answers=[
            QuizAnswerIn(quiz_question_id=rem_exam_q["qq1"], selected_option_id=rem_exam_q["q1_ok"]),
            QuizAnswerIn(quiz_question_id=rem_exam_q["qq2"], selected_option_id=rem_exam_q["q2_bad"]),
        ]),
    )
    db.expire_all()
    p_att1 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert float(p_att1.predicted_period_grade) > baseline_grade

    # Attempt 2: 30/100 (drops effective exam 70 -> 40!)
    start_student_quiz_attempt(db, ctx["student"], rem_exam_asgn.classwork_assignment_id)
    submit_student_quiz_attempt(
        db,
        ctx["student"],
        rem_exam_asgn.classwork_assignment_id,
        QuizSubmitRequest(answers=[
            QuizAnswerIn(quiz_question_id=rem_exam_q["qq1"], selected_option_id=rem_exam_q["q1_bad"]),
            QuizAnswerIn(quiz_question_id=rem_exam_q["qq2"], selected_option_id=rem_exam_q["q2_ok"]),
        ]),
    )
    db.expire_all()
    p_att2 = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter_by(student_id=ctx["student"].student_id)
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    assert p_att2.revision == p_att1.revision + 1
    assert float(p_att2.predicted_period_grade) == pytest.approx(baseline_grade, abs=0.01)

