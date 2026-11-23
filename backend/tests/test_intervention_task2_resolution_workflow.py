"""Task 2 verification tests: Verified remediation auto-resolution, attribution, notifications,
frozen Practice & Remediation history, and teacher-scope Practice progression auth.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.PracticeAssessments import teacher_practice_router
from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.intervention.PracticeAssessment import PracticeAssessment
from app.models.intervention.PracticeAttempt import PracticeAttempt
from app.models.intervention.PracticeQuestion import PracticeQuestion
from app.models.intervention.PracticeQuestionOption import PracticeQuestionOption
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Submission import GradeRequest
from app.services.intervention.PracticeAssessmentService import (
    start_or_resume_attempt,
    submit_attempt,
)
from app.schemas.PracticeAssessment import (
    PracticeAttemptAnswerSubmission,
    PracticeAttemptSubmitRequest,
)
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate,
    continue_teacher_active_intervention,
    get_teacher_active,
    get_teacher_resolved,
    resolve_teacher_active_intervention,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_current_period_features_from_records,
)
from app.services.submission.SubmissionService import grade_student_submission
from tests.test_current_period_live_feature_builder import (  # noqa: F401
    add_activity,
    current_period_context,
)
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_intervention_candidate_sync import _setup
from tests.test_intervention_lifecycle_e2e_verification import _bootstrap_scope


def _setup_active_ww_remediation_scenario(ctx, monkeypatch, *, passing_threshold: str = "85.00", cap: str = "75.00"):
    """Create an ACTIVE intervention with an original low WW activity and a linked graded remediation assignment."""
    db = ctx["db"]
    _bootstrap_scope(ctx)
    ctx["template"].passing_threshold = Decimal(passing_threshold)
    db.commit()

    # Deterministic linear scorer driven by actual WW/PT percentages
    def linear_scorer(features, model_name=None):
        return round(
            0.5 * float(features["ww_percent_so_far"]) + 0.5 * float(features["pt_percent_so_far"]),
            2,
        )

    model_id = _setup(ctx, monkeypatch, [70.0])
    monkeypatch.setattr(scorer, "score_development_current_term", linear_scorer)

    # Boost PT so WW effective score improvements push the linear projection cleanly over 85.0
    add_activity(ctx, "PERFORMANCE_TASK", 10, 10, title="PT Strong")
    add_activity(ctx, "PERFORMANCE_TASK", 10, 10, title="PT Strong 2")
    orig_ww = add_activity(ctx, "WRITTEN_WORK", 2, 10, title="WW Original Low")
    db.commit()

    baseline = _run(ctx, model_id)
    assert baseline["projected_final_term_grade"] < float(passing_threshold)

    candidate = db.query(Intervention).filter_by(source_prediction_id=baseline["prediction_id"]).one()
    activate_teacher_candidate(db, ctx["staff"].staff_id, candidate.intervention_id)
    db.expire_all()
    active = db.get(Intervention, candidate.intervention_id)
    assert active is not None and active.status == "ACTIVE"

    rem_cw = Classwork(
        title="WW Focused Remediation",
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
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
    link = RemediationAssignmentLink(
        student_id=ctx["student"].student_id,
        original_assignment_id=orig_ww.classwork_assignment_id,
        remediation_assignment_id=rem_asgn.classwork_assignment_id,
        source_intervention_id=active.intervention_id,
        component="WRITTEN_WORK",
        score_adjustment_cap=Decimal(cap),
        created_by_staff_id=ctx["staff"].staff_id,
    )
    db.add(link)
    db.commit()
    return {
        "model_id": model_id,
        "active": active,
        "orig_ww": orig_ww,
        "rem_cw": rem_cw,
        "rem_asgn": rem_asgn,
        "link": link,
        "baseline": baseline,
    }


def _submit_and_grade_attempt(ctx, assignment_id: int, attempt_number: int, grade: float):
    db = ctx["db"]
    sub = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=assignment_id,
        status="submitted",
        submitted_at=datetime.now(timezone.utc),
        attempt_count=attempt_number,
    )
    db.add(sub)
    db.commit()
    grade_student_submission(
        sub.submission_id,
        GradeRequest(grade=grade, feedback=f"Attempt {attempt_number} graded"),
        ctx["staff"].staff_id,
        db,
    )
    db.expire_all()
    return db.get(StudentSubmission, sub.submission_id)


def test_auto_resolves_immediately_after_attempt_1_even_below_remediation_cap(
    current_period_context, monkeypatch,
):
    """Attempt 1 scores 7/10 (< 75% cap, NOT passing remediation ceiling), yet lifts prediction >= 85 -> auto-resolves immediately."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="75.00")
    active = setup["active"]
    rem_asgn = setup["rem_asgn"]

    # Configure scorer so WW percent rise from orig=2/10 to eff=7/10 pushes prediction to 85.40 >= 85
    def calibrated_scorer(features, model_name=None):
        return round(78.0 + 0.12 * float(features["ww_percent_so_far"]), 2)

    monkeypatch.setattr(scorer, "score_development_current_term", calibrated_scorer)
    # Re-baseline prediction below 85 with calibrated_scorer
    add_activity(ctx, "WRITTEN_WORK", 5, 10, title="WW Baseline Anchor")
    db.commit()
    pre = _run(ctx, setup["model_id"])
    assert pre["projected_final_term_grade"] < 85.0

    # Attempt 1: 7/10 (below 75% cap of 7.5/10, does not pass remediation ceiling, but raises effective 2 -> 7)
    _submit_and_grade_attempt(ctx, rem_asgn.classwork_assignment_id, 1, 7.0)

    db.expire_all()
    row = db.get(Intervention, active.intervention_id)
    assert row is not None
    assert row.status == "RESOLVED"
    assert row.resolution_reason == "REMEDIATION_IMPROVED_PREDICTION"
    assert row.resolved_at is not None

    # Teacher notification: direct link to resolved intervention, student, subject, prediction, verified reason
    resolved_notifs = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolved",
    ).all()
    assert len(resolved_notifs) == 1
    notif = resolved_notifs[0]
    assert notif.action_url == f"/teacher/interventions?view=resolved&resolved={active.intervention_id}"
    assert ctx["student"].first_name in notif.body
    assert ctx["subject"].subject_name in notif.body
    assert "remediation" in notif.body.lower()

    # Re-running unchanged prediction must NOT duplicate resolution or notification
    _run(ctx, setup["model_id"])
    assert db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolved",
    ).count() == 1

    # Attempting manual resolve on already-resolved intervention fails cleanly with 409
    with pytest.raises(HTTPException) as exc:
        resolve_teacher_active_intervention(db, ctx["staff"].staff_id, active.intervention_id)
    assert exc.value.status_code == 409


def test_auto_resolves_after_attempt_2_and_attempt_3(current_period_context, monkeypatch):
    """Attempt 1 stays < 85 -> remains ACTIVE; Attempt 2 crosses 85 -> auto-resolves immediately without needing Attempt 3."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="80.00")
    active = setup["active"]
    rem_asgn = setup["rem_asgn"]

    add_activity(ctx, "WRITTEN_WORK", 5, 10, title="WW Anchor")
    db.commit()
    base_ww_earned = float(
        build_current_period_features_from_records(
            db, ctx["student"].student_id, ctx["class"].class_id,
            ctx["subject"].subject_id, ctx["period"].academic_period_id,
        )["features"]["ww_points_earned_so_far"]
    )

    # Calibrated: orig(2) -> 81.0, att1(4, +2pts) -> 82.6 (<85), att2(8, +6pts) -> 85.8 (>=85)
    def calibrated_scorer(features, model_name=None):
        return round(81.0 + 0.8 * (float(features["ww_points_earned_so_far"]) - base_ww_earned), 2)

    monkeypatch.setattr(scorer, "score_development_current_term", calibrated_scorer)
    pre = _run(ctx, setup["model_id"])
    assert pre["projected_final_term_grade"] == pytest.approx(81.0)

    # Attempt 1: 4/10 -> rises to 82.6 (< 85) -> stays ACTIVE
    _submit_and_grade_attempt(ctx, rem_asgn.classwork_assignment_id, 1, 4.0)
    db.expire_all()
    assert db.get(Intervention, active.intervention_id).status == "ACTIVE"

    # Attempt 2: 8/10 -> rises to 85.8 (>= 85) -> auto-resolves immediately on Attempt 2!
    _submit_and_grade_attempt(ctx, rem_asgn.classwork_assignment_id, 2, 8.0)
    db.expire_all()
    row = db.get(Intervention, active.intervention_id)
    assert row.status == "RESOLVED"
    assert row.resolution_reason == "REMEDIATION_IMPROVED_PREDICTION"

    detail = get_teacher_resolved(db, ctx["staff"].staff_id, active.intervention_id)
    assert len(detail.targeted_activities) == 1
    act = detail.targeted_activities[0]
    assert act.component == "WRITTEN_WORK"
    assert act.exam_subtype is None
    assert act.attempt_count == 2
    assert act.max_attempts == 3
    assert act.grade == 8.0
    assert act.effective_grade == 8.0
    assert act.score_adjustment_cap == 80.0
    assert len(act.attempt_history) == 2


def test_auto_resolves_after_attempt_3(current_period_context, monkeypatch):
    """Attempts 1 and 2 stay < 85; Attempt 3 lifts prediction >= 85 -> auto-resolves on Attempt 3."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="80.00")
    active = setup["active"]
    rem_asgn = setup["rem_asgn"]

    add_activity(ctx, "WRITTEN_WORK", 5, 10, title="WW Anchor")
    db.commit()
    base_ww_earned = float(
        build_current_period_features_from_records(
            db, ctx["student"].student_id, ctx["class"].class_id,
            ctx["subject"].subject_id, ctx["period"].academic_period_id,
        )["features"]["ww_points_earned_so_far"]
    )

    # Calibrated: orig(2) -> 81.0, att1(3) -> 81.8, att2(5) -> 83.4, att3(9, capped 8) -> 85.8 (>=85)
    def calibrated_scorer(features, model_name=None):
        return round(81.0 + 0.8 * (float(features["ww_points_earned_so_far"]) - base_ww_earned), 2)

    monkeypatch.setattr(scorer, "score_development_current_term", calibrated_scorer)
    assert _run(ctx, setup["model_id"])["projected_final_term_grade"] == pytest.approx(81.0)

    _submit_and_grade_attempt(ctx, rem_asgn.classwork_assignment_id, 1, 3.0)
    assert db.get(Intervention, active.intervention_id).status == "ACTIVE"

    _submit_and_grade_attempt(ctx, rem_asgn.classwork_assignment_id, 2, 5.0)
    assert db.get(Intervention, active.intervention_id).status == "ACTIVE"

    _submit_and_grade_attempt(ctx, rem_asgn.classwork_assignment_id, 3, 9.0)  # capped at 8.0/10
    db.expire_all()
    row = db.get(Intervention, active.intervention_id)
    assert row.status == "RESOLVED"
    assert row.resolution_reason == "REMEDIATION_IMPROVED_PREDICTION"

    detail = get_teacher_resolved(db, ctx["staff"].staff_id, active.intervention_id)
    act = detail.targeted_activities[0]
    assert act.attempt_count == 3
    assert act.grade == 9.0
    assert act.effective_grade == 8.0
    assert act.score_adjustment_cap == 80.0


def test_regular_classwork_improvement_retains_manual_approval_even_with_prior_completed_remediation(
    current_period_context, monkeypatch,
):
    """Having an earlier completed remediation does NOT prove remediation caused the later 85+ jump from regular classwork."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="75.00")
    active = setup["active"]
    rem_asgn = setup["rem_asgn"]

    def calibrated_scorer(features, model_name=None):
        return round(77.5 + 0.11 * float(features["ww_percent_so_far"]), 2)

    monkeypatch.setattr(scorer, "score_development_current_term", calibrated_scorer)
    add_activity(ctx, "WRITTEN_WORK", 5, 10, title="WW Anchor")
    db.commit()
    assert _run(ctx, setup["model_id"])["projected_final_term_grade"] < 85.0

    # Student completes remediation attempt 1 (4/10 -> prediction still < 85)
    _submit_and_grade_attempt(ctx, rem_asgn.classwork_assignment_id, 1, 4.0)
    db.expire_all()
    assert db.get(Intervention, active.intervention_id).status == "ACTIVE"

    # Now a REGULAR classwork with high score pushes prediction >= 85!
    add_activity(ctx, "WRITTEN_WORK", 30, 30, title="Regular WW High Score")
    db.commit()
    latest = _run(ctx, setup["model_id"])
    assert latest["projected_final_term_grade"] >= 85.0

    # Must RETAIN ACTIVE + "Resolution Recommended" (NOT auto-resolve!)
    db.expire_all()
    row = db.get(Intervention, active.intervention_id)
    assert row.status == "ACTIVE"
    assert row.resolved_at is None

    active_detail = get_teacher_active(db, ctx["staff"].staff_id, active.intervention_id)
    assert active_detail.resolution_recommended is True
    assert active_detail.can_confirm_resolution is True
    assert active_detail.resolution_recommendation_detail is not None

    # One teacher notification pointing directly to active intervention
    rec_notifs = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolution_recommended",
    ).all()
    assert len(rec_notifs) == 1
    assert rec_notifs[0].action_url == f"/teacher/interventions?view=active&active={active.intervention_id}"

    # Re-running unchanged prediction must NOT duplicate notification
    _run(ctx, setup["model_id"])
    assert db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolution_recommended",
    ).count() == 1

    # Teacher clicks Continue Support -> stays ACTIVE, no duplicate notification for same revision
    continued = continue_teacher_active_intervention(db, ctx["staff"].staff_id, active.intervention_id)
    assert continued.status == "ACTIVE"
    assert continued.resolution_recommended is False
    assert continued.can_confirm_resolution is True

    # A NEW regular classwork produces a NEW prediction revision still >= 85 -> MUST notify teacher again!
    add_activity(ctx, "WRITTEN_WORK", 20, 20, title="Regular WW Boost 2")
    db.commit()
    latest2 = _run(ctx, setup["model_id"])
    assert latest2["revision"] > latest["revision"]
    rec_notifs_after = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolution_recommended",
    ).all()
    assert len(rec_notifs_after) == 2

    # Teacher confirms manual resolution -> transitions to RESOLVED with IMPROVED_PREDICTION
    resolved = resolve_teacher_active_intervention(db, ctx["staff"].staff_id, active.intervention_id)
    assert resolved.status == "RESOLVED"
    assert resolved.resolution_reason == "IMPROVED_PREDICTION"
    assert resolved.resolution_review is not None
    assert resolved.resolution_review.resolution_mode == "TEACHER_CONFIRMED"


def test_mixed_remediation_and_regular_change_retains_manual_approval(
    current_period_context, monkeypatch,
):
    """When BOTH a remediation score AND a regular classwork grade change before prediction refresh, retain manual review."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="75.00")
    active = setup["active"]
    rem_asgn = setup["rem_asgn"]

    def calibrated_scorer(features, model_name=None):
        return round(78.0 + 0.12 * float(features["ww_percent_so_far"]), 2)

    monkeypatch.setattr(scorer, "score_development_current_term", calibrated_scorer)
    add_activity(ctx, "WRITTEN_WORK", 5, 10, title="WW Anchor")
    db.commit()
    assert _run(ctx, setup["model_id"])["projected_final_term_grade"] < 85.0

    # Both a remediation graded submission AND a regular classwork are added before prediction runs
    db.add(StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_asgn.classwork_assignment_id,
        status="graded",
        grade=Decimal("7.5"),
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
    ))
    add_activity(ctx, "WRITTEN_WORK", 10, 10, title="Simultaneous Regular WW")
    db.commit()

    mixed = _run(ctx, setup["model_id"])
    assert mixed["projected_final_term_grade"] >= 85.0

    db.expire_all()
    row = db.get(Intervention, active.intervention_id)
    assert row.status == "ACTIVE"
    active_detail = get_teacher_active(db, ctx["staff"].staff_id, active.intervention_id)
    assert active_detail.resolution_recommended is True


def test_uncertain_attribution_without_remediation_gain_retains_manual_approval(
    current_period_context, monkeypatch,
):
    """If prediction crosses 85 without verifiable remediation effective gain, retain manual review."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="75.00")
    active = setup["active"]

    # Force a regular PT score edit (non-remediation) to trigger revision while scorer jumps to 86.0
    values = iter([86.0])
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _f, model_name=None: next(values))
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10, title="Regular PT")
    db.commit()
    res = _run(ctx, setup["model_id"])
    assert res["projected_final_term_grade"] == 86.0

    db.expire_all()
    assert db.get(Intervention, active.intervention_id).status == "ACTIVE"


def test_resolved_history_preserves_frozen_practice_and_remediation_across_later_edits(
    current_period_context, monkeypatch,
):
    """Practice Assessment History & Remediation History are frozen at resolution and unaffected by later edits or pending retakes."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="75.00")
    active = setup["active"]
    rem_asgn = setup["rem_asgn"]
    rem_cw = setup["rem_cw"]

    # Configure optional Practice Assessment with REQUIRE_ATTEMPT ("Allow Progress Below Passing")
    pa = PracticeAssessment(
        intervention_id=active.intervention_id,
        title="Lines Practice Check",
        status="PUBLISHED",
        gatekeeper_policy="REQUIRE_ATTEMPT",
        passing_percentage=Decimal("75.00"),
        created_by_staff_id=ctx["staff"].staff_id,
    )
    db.add(pa)
    db.flush()
    q1 = PracticeQuestion(
        practice_assessment_id=pa.practice_assessment_id,
        question_text="Q1",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("1.00"),
        display_order=1,
    )
    q2 = PracticeQuestion(
        practice_assessment_id=pa.practice_assessment_id,
        question_text="Q2",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("2.00"),
        display_order=2,
    )
    db.add_all([q1, q2])
    db.flush()
    q1_ok = PracticeQuestionOption(practice_question_id=q1.practice_question_id, option_text="A", is_correct=True, option_order=1)
    q1_bad = PracticeQuestionOption(practice_question_id=q1.practice_question_id, option_text="B", is_correct=False, option_order=2)
    q2_ok = PracticeQuestionOption(practice_question_id=q2.practice_question_id, option_text="C", is_correct=True, option_order=1)
    q2_bad = PracticeQuestionOption(practice_question_id=q2.practice_question_id, option_text="D", is_correct=False, option_order=2)
    db.add_all([q1_ok, q1_bad, q2_ok, q2_bad])
    db.commit()

    # Student completes Practice Attempt #1 with 1/3 (33.33%, Below Passing)
    att_start = start_or_resume_attempt(db, ctx["student"].student_id, active.intervention_id)
    submit_attempt(
        db,
        ctx["student"].student_id,
        active.intervention_id,
        att_start.attempt_id,
        PracticeAttemptSubmitRequest(answers=[
            PracticeAttemptAnswerSubmission(practice_question_id=q1.practice_question_id, selected_option_id=q1_ok.option_id),
            PracticeAttemptAnswerSubmission(practice_question_id=q2.practice_question_id, selected_option_id=q2_bad.option_id),
        ]),
    )
    # Student completes Practice Attempt #2 with 3/3 (100.00%, Passed)
    att_start2 = start_or_resume_attempt(db, ctx["student"].student_id, active.intervention_id)
    submit_attempt(
        db,
        ctx["student"].student_id,
        active.intervention_id,
        att_start2.attempt_id,
        PracticeAttemptSubmitRequest(answers=[
            PracticeAttemptAnswerSubmission(practice_question_id=q1.practice_question_id, selected_option_id=q1_ok.option_id),
            PracticeAttemptAnswerSubmission(practice_question_id=q2.practice_question_id, selected_option_id=q2_ok.option_id),
        ]),
    )

    # Student grades Remediation Attempt #1 = 7/10 (eff 2->7) AND opens a pending Attempt #2 before manual resolve
    def calibrated_scorer(features, model_name=None):
        return round(77.5 + 0.11 * float(features["ww_percent_so_far"]), 2)

    monkeypatch.setattr(scorer, "score_development_current_term", calibrated_scorer)
    add_activity(ctx, "WRITTEN_WORK", 5, 10, title="WW Anchor")
    db.commit()
    assert _run(ctx, setup["model_id"])["projected_final_term_grade"] < 85.0

    _submit_and_grade_attempt(ctx, rem_asgn.classwork_assignment_id, 1, 7.0)
    # Add pending attempt 2 on remediation
    db.add(StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_asgn.classwork_assignment_id,
        status="pending",
        grade=None,
        attempt_count=1,
    ))
    # Regular boost pushes prediction >= 85 -> teacher manually resolves
    add_activity(ctx, "WRITTEN_WORK", 30, 30, title="Regular Boost")
    db.commit()
    assert _run(ctx, setup["model_id"])["projected_final_term_grade"] >= 85.0

    resolved = resolve_teacher_active_intervention(db, ctx["staff"].staff_id, active.intervention_id)
    assert resolved.status == "RESOLVED"

    # Verify Practice Assessment History preserves ALL attempts, scores, percentages, pass/fail, and dates
    assert resolved.practice_assessment is not None
    assert resolved.practice_assessment.title == "Lines Practice Check"
    assert resolved.practice_assessment.gatekeeper_policy == "REQUIRE_ATTEMPT"
    assert resolved.practice_assessment.passing_percentage == 75.0
    assert resolved.practice_assessment.practice_passed is True
    assert len(resolved.practice_assessment.attempts) == 2
    p_att1, p_att2 = resolved.practice_assessment.attempts
    assert p_att1.attempt_number == 1
    assert p_att1.total_score == 1.0
    assert p_att1.max_score == 3.0
    assert p_att1.score_percentage == pytest.approx(33.33, abs=0.01)
    assert p_att1.is_passed is False
    assert p_att1.completed_at is not None
    assert p_att2.attempt_number == 2
    assert p_att2.total_score == 3.0
    assert p_att2.max_score == 3.0
    assert p_att2.score_percentage == pytest.approx(100.0, abs=0.01)
    assert p_att2.is_passed is True
    assert p_att2.completed_at is not None

    # Verify Targeted Support History ignores pending attempt #2 for latest graded score & labels WRITTEN_WORK properly
    assert len(resolved.targeted_activities) == 1
    act = resolved.targeted_activities[0]
    assert act.component == "WRITTEN_WORK"
    assert act.exam_subtype is None
    assert act.grade == 7.0
    assert act.effective_grade == 7.0
    assert act.original_grade == 2.0
    assert act.score_adjustment_cap == 75.0

    # Now MUTATE live PracticeAssessment and Classwork after resolution -> frozen resolved view MUST NOT change!
    pa_row = db.get(PracticeAssessment, pa.practice_assessment_id)
    pa_row.title = "Mutated After Resolution"
    pa_row.gatekeeper_policy = "OPTIONAL"
    pa_row.passing_percentage = Decimal("50.00")
    cw_row = db.get(Classwork, rem_cw.classwork_id)
    cw_row.title = "Mutated Remediation Title"
    db.commit()

    resolved_after_mutation = get_teacher_resolved(db, ctx["staff"].staff_id, active.intervention_id)
    assert resolved_after_mutation.practice_assessment is not None
    assert resolved_after_mutation.practice_assessment.title == "Lines Practice Check"
    assert resolved_after_mutation.practice_assessment.gatekeeper_policy == "REQUIRE_ATTEMPT"
    assert resolved_after_mutation.practice_assessment.passing_percentage == 75.0
    assert resolved_after_mutation.targeted_activities[0].title == "WW Focused Remediation"


def test_practice_progression_endpoint_enforces_teacher_scope_authorization(
    current_period_context, monkeypatch,
):
    """Unauthorized teachers receive 403 on GET .../practice-assessment/progression; assigned teacher receives 200."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch)
    active = setup["active"]

    outsider_user = UserAccount(user_id=uuid4(), email="outsider-prog@example.test")
    outsider_staff = AcademicStaff(
        staff_id="T-OUTSIDER-PROG",
        first_name="Outsider",
        last_name="Teacher",
        user_id=outsider_user.user_id,
    )
    db.add_all([outsider_user, outsider_staff])
    db.flush()
    db.add(UserRoles(user_id=outsider_user.user_id, role_id=1))
    db.commit()

    def _build_client(user_id, staff_id):
        app = FastAPI()
        app.include_router(
            teacher_practice_router,
            prefix="/api/v1/teacher/interventions/{intervention_id}/practice-assessment",
        )
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_staff_id] = lambda: staff_id
        app.dependency_overrides[get_current_user] = lambda: {
            "sub": str(user_id),
            "role": "teacher",
            "staff_id": staff_id,
        }
        return TestClient(app)

    outsider_client = _build_client(outsider_user.user_id, outsider_staff.staff_id)
    resp_outsider = outsider_client.get(
        f"/api/v1/teacher/interventions/{active.intervention_id}/practice-assessment/progression"
    )
    assert resp_outsider.status_code == 403

    owner_client = _build_client(ctx["staff"].user_id, ctx["staff"].staff_id)
    resp_owner = owner_client.get(
        f"/api/v1/teacher/interventions/{active.intervention_id}/practice-assessment/progression"
    )
    assert resp_owner.status_code == 200
    assert resp_owner.json()["intervention_id"] == active.intervention_id


def test_legacy_resolved_record_without_snapshot_loads_safely(
    current_period_context, monkeypatch,
):
    """Previously resolved interventions without resolution_history_snapshot reconstruct history safely."""
    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="75.00")
    active = setup["active"]
    rem_asgn = setup["rem_asgn"]

    # Record a graded remediation attempt and manually mark legacy RESOLVED without snapshot
    db.add(StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=rem_asgn.classwork_assignment_id,
        status="graded",
        grade=Decimal("9.00"),
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
    ))
    row = db.get(Intervention, active.intervention_id)
    row.remediation_plan = {"grade_treatment": "WRITTEN_WORK", "score_adjustment_cap": 75.0}
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    db.commit()

    detail = get_teacher_resolved(db, ctx["staff"].staff_id, active.intervention_id)
    assert detail.status == "RESOLVED"
    assert detail.practice_assessment is None
    assert detail.resolution_review is None
    assert len(detail.targeted_activities) == 1
    act = detail.targeted_activities[0]
    assert act.component == "WRITTEN_WORK"
    assert act.grade == 9.0
    assert act.effective_grade == 7.5
    assert act.score_adjustment_cap == 75.0


def test_optional_ungraded_practice_never_affects_prediction_or_resolution(
    current_period_context, monkeypatch,
):
    """Submitting and passing an optional ungraded Practice Assessment does NOT change predictions or resolve the intervention."""
    from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction

    ctx = current_period_context
    db = ctx["db"]
    setup = _setup_active_ww_remediation_scenario(ctx, monkeypatch, passing_threshold="85.00", cap="75.00")
    active = setup["active"]

    pa = PracticeAssessment(
        intervention_id=active.intervention_id,
        title="Ungraded Practice Check",
        status="PUBLISHED",
        gatekeeper_policy="OPTIONAL",
        passing_percentage=Decimal("75.00"),
        created_by_staff_id=ctx["staff"].staff_id,
    )
    db.add(pa)
    db.flush()
    q1 = PracticeQuestion(
        practice_assessment_id=pa.practice_assessment_id,
        question_text="2 + 2 = ?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("10.00"),
        display_order=1,
    )
    db.add(q1)
    db.flush()
    opt_ok = PracticeQuestionOption(practice_question_id=q1.practice_question_id, option_text="4", is_correct=True, option_order=1)
    opt_bad = PracticeQuestionOption(practice_question_id=q1.practice_question_id, option_text="5", is_correct=False, option_order=2)
    db.add_all([opt_ok, opt_bad])
    db.commit()

    pred_count_before = db.query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=ctx["student"].student_id,
    ).count()

    started = start_or_resume_attempt(db, ctx["student"].student_id, active.intervention_id)
    feedback = submit_attempt(
        db,
        ctx["student"].student_id,
        active.intervention_id,
        started.attempt_id,
        PracticeAttemptSubmitRequest(answers=[
            PracticeAttemptAnswerSubmission(practice_question_id=q1.practice_question_id, selected_option_id=opt_ok.option_id),
        ]),
    )
    assert feedback.is_passed is True
    assert float(feedback.score_percentage) == 100.0

    # Re-run prediction: material evidence MUST be unchanged, prediction count unchanged, intervention still ACTIVE, no resolution notifications
    rerun = _run(ctx, setup["model_id"])
    assert rerun.get("unchanged") is True
    db.expire_all()
    assert db.query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=ctx["student"].student_id,
    ).count() == pred_count_before
    assert db.get(Intervention, active.intervention_id).status == "ACTIVE"
    assert db.query(Notification).filter(
        Notification.user_id == ctx["staff"].user_id,
        Notification.notification_type.in_(("intervention_resolved", "intervention_resolution_recommended")),
    ).count() == 0


def test_auto_graded_remediation_quiz_attempt_1_triggers_automatic_resolution(
    current_period_context, monkeypatch,
):
    """End-to-end auto-graded remediation quiz via QuizAttemptService auto-resolves on Attempt 1 when prediction hits 85+."""
    from app.schemas.Quiz import QuizAnswerIn, QuizSubmitRequest
    from app.services.quiz.QuizAttemptService import start_student_quiz_attempt, submit_student_quiz_attempt
    from tests.test_intervention_lifecycle_e2e_verification import _create_mc_quiz

    ctx = current_period_context
    db = ctx["db"]
    _bootstrap_scope(ctx)
    ctx["template"].passing_threshold = Decimal("85.00")
    db.commit()

    model_id = _setup(ctx, monkeypatch, [70.0])
    orig_ww = add_activity(ctx, "WRITTEN_WORK", 2, 10, title="WW Quiz Original Low")
    db.commit()

    base_ww_earned = float(
        build_current_period_features_from_records(
            db, ctx["student"].student_id, ctx["class"].class_id,
            ctx["subject"].subject_id, ctx["period"].academic_period_id,
        )["features"]["ww_points_earned_so_far"]
    )
    monkeypatch.setattr(
        scorer,
        "score_development_current_term",
        lambda features, model_name=None: round(81.0 + 0.9 * (float(features["ww_points_earned_so_far"]) - base_ww_earned), 2),
    )

    baseline = _run(ctx, model_id)
    assert baseline["projected_final_term_grade"] == pytest.approx(81.0)
    candidate = db.query(Intervention).filter_by(source_prediction_id=baseline["prediction_id"]).one()
    activate_teacher_candidate(db, ctx["staff"].staff_id, candidate.intervention_id)
    db.expire_all()
    active = db.get(Intervention, candidate.intervention_id)

    _, quiz_asgn, quiz_q = _create_mc_quiz(
        ctx,
        title="WW Auto-Graded Remediation Quiz",
        max_attempts=3,
        intervention_id=active.intervention_id,
        recipient_student_id=ctx["student"].student_id,
        category="WRITTEN_WORK",
        total_points=10,
    )
    db.add(RemediationAssignmentLink(
        student_id=ctx["student"].student_id,
        original_assignment_id=orig_ww.classwork_assignment_id,
        remediation_assignment_id=quiz_asgn.classwork_assignment_id,
        source_intervention_id=active.intervention_id,
        component="WRITTEN_WORK",
        score_adjustment_cap=Decimal("75.00"),
        created_by_staff_id=ctx["staff"].staff_id,
    ))
    db.commit()

    # Attempt 1: 7/10 (< 75% cap, effective 2 -> 7, +5pts -> pred 85.5 >= 85) -> auto-resolves!
    start_student_quiz_attempt(db, ctx["student"], quiz_asgn.classwork_assignment_id)
    submit_student_quiz_attempt(
        db,
        ctx["student"],
        quiz_asgn.classwork_assignment_id,
        QuizSubmitRequest(answers=[
            QuizAnswerIn(quiz_question_id=quiz_q["qq1"], selected_option_id=quiz_q["q1_ok"]),
            QuizAnswerIn(quiz_question_id=quiz_q["qq2"], selected_option_id=quiz_q["q2_bad"]),
        ]),
    )

    db.expire_all()
    row = db.get(Intervention, active.intervention_id)
    assert row.status == "RESOLVED"
    assert row.resolution_reason == "REMEDIATION_IMPROVED_PREDICTION"
    notifs = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolved",
    ).all()
    assert len(notifs) == 1
    assert notifs[0].action_url == f"/teacher/interventions?view=resolved&resolved={active.intervention_id}"


