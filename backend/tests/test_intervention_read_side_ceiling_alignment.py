"""Focused regression tests for Task 11: read-side alignment of progress, history & summaries."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention import RemediationPostGradingService as post_grading_service
from app.services.intervention.InterventionHistoryService import resolution_projection
from app.services.intervention.InterventionRemediationService import progress
from app.services.intervention.RemediationPostGradingService import (
    STATUS_AVAILABLE,
    STATUS_UNAVAILABLE,
)
from app.services.intervention.TeacherInterventionService import (
    get_teacher_active,
    get_teacher_candidate,
    get_teacher_resolved,
    list_teacher_active,
    list_teacher_candidates,
    list_teacher_resolved,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as current_term_scorer
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_INSUFFICIENT_EVIDENCE,
)
from tests.test_intervention_resolution_remediation_ceiling import (
    _prepare_approved_model,
    _sync,
)
from tests.test_remediation_post_grading_evaluator import _persist_prediction_at_cutoff
from tests.test_unremediated_prediction_baseline import baseline_ctx


def _ensure_teacher_scope(ctx) -> str:
    db = ctx["db"]
    staff_id = ctx["teacher"].staff_id
    if (
        db.query(StudentClass)
        .filter_by(
            student_id=ctx["student"].student_id,
            class_id=ctx["class"].class_id,
            enrollment_status="enrolled",
        )
        .first()
        is None
    ):
        db.add(
            StudentClass(
                student_id=ctx["student"].student_id,
                class_id=ctx["class"].class_id,
                academic_year_id=ctx["class"].academic_year_id,
                enrollment_status="enrolled",
            )
        )
    load = (
        db.query(SubjectLoad)
        .filter_by(
            staff_id=staff_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
        )
        .first()
    )
    if load is None:
        db.add(
            SubjectLoad(
                staff_id=staff_id,
                class_id=ctx["class"].class_id,
                subject_id=ctx["subject"].subject_id,
                academic_period_id=ctx["period"].academic_period_id,
                status="published",
                is_active_version=True,
            )
        )
    else:
        load.status = "published"
        load.is_active_version = True
    db.flush()
    return staff_id


def test_after_remediation_84_point_2_stays_active_with_completed_activity_distinct_from_resolution(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    staff_id = _ensure_teacher_scope(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=14, cap=85.0)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=84.2, cutoff_at=cutoff, revision=20)

    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 83.0,
    )

    synced = _sync(ctx, pred)
    db.commit()
    assert synced is not None and synced.status == "ACTIVE"

    prog = progress(db, synced)
    assert prog["status"] == "ACTIVE"
    assert prog["remediation_status"] == "GRADED"
    assert len(prog["completed_remediation"]) == 1
    assert prog["latest_projection"] == pytest.approx(84.2)
    assert prog["latest_raw_projection"] == pytest.approx(84.2)
    assert prog["latest_projection_status"] == STATUS_AVAILABLE
    assert prog["predicted_grade_ceiling"] == pytest.approx(85.0)
    assert prog["was_ceiling_applied"] is False
    assert "remains below 85" in prog["status_reason"].lower()
    assert "awaiting reconciliation" not in prog["status_reason"].lower()

    active_list = list_teacher_active(db, staff_id)
    assert active_list.total == 1
    summary = active_list.items[0]
    assert summary.status == "ACTIVE"
    assert summary.current_predicted_grade == pytest.approx(84.2)
    assert summary.current_raw_predicted_grade == pytest.approx(84.2)
    assert summary.current_prediction_status == STATUS_AVAILABLE
    assert summary.was_ceiling_applied is False

    active_detail = get_teacher_active(db, staff_id, synced.intervention_id)
    assert active_detail.current_predicted_grade == pytest.approx(84.2)
    assert active_detail.current_raw_predicted_grade == pytest.approx(84.2)


def test_raw_88_adjusted_85_resolves_and_history_remains_85_after_period_finalization(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    staff_id = _ensure_teacher_scope(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.0, cutoff_at=cutoff, revision=21)

    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 83.0,
    )

    resolved = _sync(ctx, pred)
    db.commit()
    assert resolved is not None and resolved.status == "RESOLVED"

    # Active period reads show adjusted 85.0 while preserving raw 88.0 separately
    assert resolution_projection(db, resolved) == pytest.approx(85.0)
    resolved_list = list_teacher_resolved(db, staff_id)
    resolved_item = next(item for item in resolved_list.items if item.intervention_id == resolved.intervention_id)
    assert resolved_item.current_predicted_grade == pytest.approx(85.0)
    assert resolved_item.current_raw_predicted_grade == pytest.approx(88.0)
    assert resolved_item.current_intervention_level == "NEEDS_MONITORING"
    assert resolved_item.was_ceiling_applied is True

    resolved_detail = get_teacher_resolved(db, staff_id, resolved.intervention_id)
    assert resolved_detail.resolution_projection == pytest.approx(85.0)
    assert resolved_detail.raw_resolution_projection == pytest.approx(88.0)
    assert resolved_detail.current_predicted_grade == pytest.approx(85.0)
    assert resolved_detail.current_raw_predicted_grade == pytest.approx(88.0)
    assert resolved_detail.current_intervention_level == "NEEDS_MONITORING"

    # Persisted raw AI prediction record is untouched
    db.refresh(pred)
    assert pred.predicted_period_grade == Decimal("88.00")
    assert pred.intervention_level == "NEEDS_MONITORING"
    assert pred.evidence_snapshot["projected_final_term_grade_raw"] == 88.0

    # Close and finalize period: history MUST still display 85.0 from frozen snapshot without live scoring
    def _must_not_score(_features, model_name=None):
        raise AssertionError("Finalized history must read resolution_ceiling_snapshot, not score live")

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", _must_not_score)
    ctx["period"].is_active = False
    db.add(
        StudentPeriodGrade(
            student_id=ctx["student"].student_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            is_finalized=True,
            final_period_grade=Decimal("85.00"),
        )
    )
    db.commit()

    assert resolution_projection(db, resolved) == pytest.approx(85.0)
    after_close_list = list_teacher_resolved(db, staff_id)
    after_close_item = next(item for item in after_close_list.items if item.intervention_id == resolved.intervention_id)
    assert after_close_item.current_predicted_grade == pytest.approx(85.0)
    assert after_close_item.current_raw_predicted_grade == pytest.approx(88.0)
    after_close_detail = get_teacher_resolved(db, staff_id, resolved.intervention_id)
    assert after_close_detail.resolution_projection == pytest.approx(85.0)
    assert after_close_detail.raw_resolution_projection == pytest.approx(88.0)


def test_lower_ceiling_80_keeps_active_and_displays_80_without_awaiting_reconciliation(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    staff_id = _ensure_teacher_scope(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 80.0,
    }
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.0, cutoff_at=cutoff, revision=22)

    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 78.0,
    )

    synced = _sync(ctx, pred)
    db.commit()
    assert synced is not None and synced.status == "ACTIVE"

    prog = progress(db, synced)
    assert prog["status"] == "ACTIVE"
    assert prog["remediation_status"] == "GRADED"
    assert len(prog["completed_remediation"]) == 1
    assert prog["latest_projection"] == pytest.approx(80.0)
    assert prog["latest_raw_projection"] == pytest.approx(88.0)
    assert prog["latest_projection_status"] == STATUS_AVAILABLE
    assert prog["was_ceiling_applied"] is True
    assert "remains below 85" in prog["status_reason"].lower()
    assert "awaiting reconciliation" not in prog["status_reason"].lower()

    active_list = list_teacher_active(db, staff_id)
    assert active_list.total == 1
    assert active_list.items[0].current_predicted_grade == pytest.approx(80.0)
    assert active_list.items[0].current_intervention_level == "MODERATE_RISK"

    active_detail = get_teacher_active(db, staff_id, synced.intervention_id)
    assert active_detail.current_predicted_grade == pytest.approx(80.0)
    assert active_detail.current_raw_predicted_grade == pytest.approx(88.0)
    assert active_detail.predicted_grade_ceiling == pytest.approx(80.0)
    assert active_detail.was_ceiling_applied is True
    # Must match adjusted 80.0 (MODERATE_RISK), never raw 88.0 (NEEDS_MONITORING / On Track)
    assert active_detail.current_intervention_level == "MODERATE_RISK"
    # Stored raw prediction risk classification remains unchanged
    db.refresh(pred)
    assert pred.intervention_level == "NEEDS_MONITORING"


def test_regular_coursework_justifies_87_point_4_displayed_without_restricting_legitimate_gains(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    staff_id = _ensure_teacher_scope(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)

    # Add a new regular written work quiz with a high score
    regular_cw = Classwork(
        title="Regular Quiz 2",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("20"),
        is_published=True,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=staff_id,
    )
    db.add(regular_cw)
    db.flush()
    regular_asgn = ClassworkAssignment(
        classwork_id=regular_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=staff_id,
        is_published=True,
    )
    db.add(regular_asgn)
    db.flush()
    db.add(
        StudentSubmission(
            student_id=ctx["student"].student_id,
            classwork_assignment_id=regular_asgn.classwork_assignment_id,
            status="graded",
            grade=Decimal("20"),
            attempt_count=1,
            submitted_at=datetime.now(timezone.utc),
            graded_at=datetime.now(timezone.utc),
        )
    )
    db.flush()

    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=89.2, cutoff_at=cutoff, revision=23)

    # Unremediated baseline (including the new regular quiz, excluding this intervention) is 87.4
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 87.4,
    )

    # Before resolution: ACTIVE reads display 87.4 (never capped down to 85)
    prog = progress(db, intervention)
    assert prog["latest_projection"] == pytest.approx(87.4)
    assert prog["latest_raw_projection"] == pytest.approx(89.2)
    assert prog["effective_grade_ceiling"] == pytest.approx(87.4)

    active_detail = get_teacher_active(db, staff_id, intervention.intervention_id)
    assert active_detail.current_predicted_grade == pytest.approx(87.4)
    assert active_detail.current_raw_predicted_grade == pytest.approx(89.2)
    assert active_detail.current_intervention_level == "NEEDS_MONITORING"

    # After resolution: RESOLVED reads also display 87.4
    resolved = _sync(ctx, pred)
    db.commit()
    assert resolved is not None and resolved.status == "RESOLVED"
    assert resolution_projection(db, resolved) == pytest.approx(87.4)
    resolved_detail = get_teacher_resolved(db, staff_id, resolved.intervention_id)
    assert resolved_detail.resolution_projection == pytest.approx(87.4)
    assert resolved_detail.raw_resolution_projection == pytest.approx(89.2)
    assert resolved_detail.current_predicted_grade == pytest.approx(87.4)
    assert resolved_detail.current_intervention_level == "NEEDS_MONITORING"


def test_unavailable_evaluation_shows_accurate_unavailable_state_without_misleading_progress(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    staff_id = _ensure_teacher_scope(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.0, cutoff_at=cutoff, revision=24)

    real_prepare = post_grading_service.prepare_development_current_term

    def _fail_unremediated(db_session, **kwargs):
        if kwargs.get("exclude_intervention_id") is not None:
            return (
                {
                    "status": STATUS_INSUFFICIENT_EVIDENCE,
                    "readiness_reason_codes": ["MIN_WRITTEN_WORK_NOT_MET"],
                },
                None,
            )
        return real_prepare(db_session, **kwargs)

    monkeypatch.setattr(post_grading_service, "prepare_development_current_term", _fail_unremediated)

    synced = _sync(ctx, pred)
    db.commit()
    assert synced is not None and synced.status == "ACTIVE"

    prog = progress(db, synced)
    assert prog["status"] == "ACTIVE"
    assert prog["remediation_status"] == "GRADED"
    assert prog["latest_projection"] is None
    assert prog["latest_projection_status"] == STATUS_UNAVAILABLE
    assert "UNREMEDIATED_BASELINE_UNAVAILABLE" in prog["latest_projection_unavailable_reasons"]
    assert prog["latest_raw_projection"] == pytest.approx(88.0)
    assert prog["status_reason"] == "Latest valid projection is unavailable."

    active_list = list_teacher_active(db, staff_id)
    assert active_list.total == 1
    assert active_list.items[0].current_predicted_grade is None
    assert active_list.items[0].current_prediction_status == STATUS_UNAVAILABLE
    assert active_list.items[0].current_raw_predicted_grade == pytest.approx(88.0)
    # Unavailable evaluation must report INTERVENTION_NOT_ASSESSED (Not Assessed), never On Track
    assert active_list.items[0].current_intervention_level == "INTERVENTION_NOT_ASSESSED"
    # Stored raw prediction risk classification remains unchanged
    db.refresh(pred)
    assert pred.intervention_level == "NEEDS_MONITORING"


def test_legacy_candidate_and_practice_only_preserve_existing_read_behavior(baseline_ctx):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    staff_id = _ensure_teacher_scope(ctx)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=84.2, cutoff_at=cutoff, revision=25)

    # 1. Legacy ACTIVE plan (no predicted_grade_ceiling)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
    }
    db.commit()
    legacy_prog = progress(db, intervention)
    assert legacy_prog["latest_projection"] == pytest.approx(84.2)
    assert legacy_prog["latest_raw_projection"] == pytest.approx(84.2)
    assert legacy_prog["was_ceiling_applied"] is False
    legacy_detail = get_teacher_active(db, staff_id, intervention.intervention_id)
    assert legacy_detail.current_predicted_grade == pytest.approx(84.2)
    assert legacy_detail.current_intervention_level == "MODERATE_RISK"
    assert legacy_detail.was_ceiling_applied is False

    # 2. PRACTICE_ONLY ACTIVE plan (even if predicted_grade_ceiling was somehow present)
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "PRACTICE_ONLY",
        "predicted_grade_ceiling": 80.0,
    }
    db.commit()
    practice_prog = progress(db, intervention)
    assert practice_prog["latest_projection"] == pytest.approx(84.2)
    assert practice_prog["was_ceiling_applied"] is False
    practice_detail = get_teacher_active(db, staff_id, intervention.intervention_id)
    assert practice_detail.current_predicted_grade == pytest.approx(84.2)
    assert practice_detail.current_intervention_level == "MODERATE_RISK"
    assert practice_detail.was_ceiling_applied is False

    # 3. CANDIDATE row preserves raw RF evaluation and activation eligibility
    intervention.status = "CANDIDATE"
    intervention.activated_at = None
    intervention.activated_by_staff_id = None
    intervention.remediation_plan = None
    db.commit()
    candidates = list_teacher_candidates(db, staff_id)
    assert candidates.total == 1
    cand_item = candidates.items[0]
    assert cand_item.current_predicted_grade == pytest.approx(84.2)
    assert cand_item.current_raw_predicted_grade == pytest.approx(84.2)
    assert cand_item.current_intervention_level == "MODERATE_RISK"
    assert cand_item.candidate_activation_eligible is True
    cand_detail = get_teacher_candidate(db, staff_id, intervention.intervention_id)
    assert cand_detail.current_predicted_grade == pytest.approx(84.2)
    assert cand_detail.current_intervention_level == "MODERATE_RISK"
    assert cand_detail.candidate_activation_eligible is True


def test_risk_level_maps_ceiling_adjusted_high_risk_and_legitimate_low_risk(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    staff_id = _ensure_teacher_scope(ctx)
    intervention = ctx["current_intervention"]
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)

    # Case A: Raw 88.0 capped to 72.0 (ceiling 72.0, baseline 70.0) -> HIGH_RISK
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 72.0,
    }
    cutoff_a = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred_a = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.0, cutoff_at=cutoff_a, revision=26)
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 70.0,
    )
    high_risk_detail = get_teacher_active(db, staff_id, intervention.intervention_id)
    assert high_risk_detail.current_predicted_grade == pytest.approx(72.0)
    assert high_risk_detail.current_intervention_level == "HIGH_RISK"
    assert pred_a.intervention_level == "NEEDS_MONITORING"

    # Case B: Regular coursework pushes baseline to 91.2 (raw 92.4, ceiling 85.0) -> LOW_RISK preserved
    intervention.remediation_plan = {
        **intervention.remediation_plan,
        "predicted_grade_ceiling": 85.0,
    }
    cutoff_b = datetime.now(timezone.utc) + timedelta(seconds=2)
    pred_b = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=92.4, cutoff_at=cutoff_b, revision=27)
    pred_b.intervention_level = "LOW_RISK"
    db.commit()
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 91.2,
    )
    low_risk_detail = get_teacher_active(db, staff_id, intervention.intervention_id)
    assert low_risk_detail.current_predicted_grade == pytest.approx(91.2)
    assert low_risk_detail.current_intervention_level == "LOW_RISK"

