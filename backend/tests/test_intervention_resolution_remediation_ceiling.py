"""Focused integration tests for Task 10: remediation ceiling in intervention resolution & notifications."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.models.intervention.Intervention import Intervention
from app.models.notifications.Notification import Notification
from app.services.intervention import RemediationPostGradingService as post_grading_service
from app.services.intervention.InterventionCandidateService import (
    IMPROVED_PREDICTION,
    sync_intervention_for_persisted_prediction,
)
from app.services.intervention.InterventionReconciliationService import (
    reconcile_open_interventions_for_template_threshold_change,
)
from app.services.intervention.RemediationPostGradingService import (
    STATUS_AVAILABLE,
    evaluate_actual_remediation_prediction,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as current_term_scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_INSUFFICIENT_EVIDENCE,
)
from tests.test_remediation_post_grading_evaluator import _persist_prediction_at_cutoff
from tests.test_unremediated_prediction_baseline import baseline_ctx


def _prepare_approved_model(ctx) -> AIModelVersion:
    db = ctx["db"]
    # Ensure teacher has active teacher role and published load so lifecycle notifications stage.
    teacher_role = db.query(Role).filter(Role.role_name == "teacher").first()
    if teacher_role is None:
        teacher_role = Role(role_id=1, role_name="teacher")
        db.add(teacher_role)
        db.flush()
    if (
        db.query(UserRoles)
        .filter_by(user_id=ctx["teacher"].user_id, role_id=teacher_role.role_id)
        .first()
        is None
    ):
        db.add(UserRoles(user_id=ctx["teacher"].user_id, role_id=teacher_role.role_id))
    load = db.query(SubjectLoad).filter_by(staff_id=ctx["teacher"].staff_id).first()
    if load is not None:
        load.status = "published"
    model = db.query(AIModelVersion).first()
    model.model_name = CORRECTED_MODEL_NAME
    model.model_purpose = ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
    model.lifecycle_status = "DEVELOPMENT"
    model.is_active = False
    model.production_validated = False
    model.independent_three_term_validation = False
    model.registry_metadata_json = {
        "feature_schema_version": "v3",
        "feature_schema_sha256": "schema-sha-abc",
        "artifact_sha256": "artifact-sha-xyz",
    }
    db.flush()
    return model


def _sync(ctx, pred: DevelopmentCurrentTermPrediction):
    return sync_intervention_for_persisted_prediction(
        ctx["db"],
        pred,
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    )


def _resolved_notifications(ctx) -> list[Notification]:
    return (
        ctx["db"]
        .query(Notification)
        .filter(Notification.notification_type == "intervention_resolved")
        .order_by(Notification.notification_id)
        .all()
    )


def test_83_to_84_point_2_stays_active_with_no_resolution_notification(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
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

    result = _sync(ctx, pred)
    db.commit()

    assert result is not None
    assert result.status == "ACTIVE"
    assert result.resolution_reason is None
    assert "resolution_ceiling_snapshot" not in (result.remediation_plan or {})
    assert _resolved_notifications(ctx) == []


def test_raw_88_adjusted_85_resolves_saves_immutable_snapshot_and_notifies_adjusted_grade(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
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
    db.refresh(resolved)
    db.refresh(pred)

    assert resolved.status == "RESOLVED"
    assert resolved.resolution_reason == IMPROVED_PREDICTION
    assert resolved.resolved_at is not None
    # Raw prediction row remains untouched
    assert pred.predicted_period_grade == Decimal("88.00")
    assert pred.evidence_snapshot["projected_final_term_grade_raw"] == 88.0

    # Snapshot saved accurately in remediation_plan
    snap = resolved.remediation_plan["resolution_ceiling_snapshot"]
    assert snap["prediction_id"] == pred.prediction_id
    assert snap["raw_predicted_grade"] == 88.0
    assert snap["unremediated_baseline_grade"] == 83.0
    assert snap["selected_grade_ceiling"] == 85.0
    assert snap["effective_grade_ceiling"] == 85.0
    assert snap["remediation_adjusted_predicted_grade"] == 85.0
    assert snap["was_ceiling_applied"] is True

    # Notification uses remediation-adjusted wording & grade (85), not raw 88
    notices = _resolved_notifications(ctx)
    assert len(notices) == 1
    assert "remediation-adjusted" in notices[0].body.lower()
    assert "85" in notices[0].body
    assert "88" not in notices[0].body

    # Re-syncing does not duplicate notifications or alter resolved intervention/snapshot
    _sync(ctx, pred)
    db.commit()
    assert len(_resolved_notifications(ctx)) == 1
    assert db.get(Intervention, resolved.intervention_id).remediation_plan["resolution_ceiling_snapshot"] == snap

    # After period closes, frozen snapshot remains reliably readable without live RF inference
    ctx["period"].is_active = False
    db.commit()
    after_closure = evaluate_actual_remediation_prediction(db, resolved, pred)
    assert after_closure.status == STATUS_AVAILABLE
    assert after_closure.remediation_adjusted_predicted_grade == 85.0
    assert after_closure.raw_predicted_grade == 88.0


def test_ceiling_80_with_passing_85_stays_active_and_resolves_on_threshold_reconciliation(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 80.0,
    }
    # Multiple remediation attempts (WW1 + PT1 + Exam) push raw RF to 91.5, but ceiling is 80
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)
    ctx["add_ww_pt_remediation"](intervention, ctx["pt1"], remediation_score=50, cap=85.0)
    ctx["add_exam_remediation"](intervention, ctx["sum1"], remediation_score=30)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=91.5, cutoff_at=cutoff, revision=22)

    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 78.0,
    )

    # Adjusted is 80.0 < 85.0 passing threshold -> stays ACTIVE despite raw 91.5 and 3 attempts!
    still_active = _sync(ctx, pred)
    db.commit()
    assert still_active.status == "ACTIVE"
    assert _resolved_notifications(ctx) == []

    # Lowering subject passing threshold to 80 and running template reconciliation resolves cleanly once
    template = db.query(GradingTemplate).first()
    template.passing_threshold = Decimal("80.00")
    db.flush()
    reconciled = reconcile_open_interventions_for_template_threshold_change(
        db,
        academic_year_id=ctx["period"].academic_year_id,
        grading_template_id=template.grading_template_id,
    )
    db.commit()
    assert reconciled == {"affected": 1, "resolved": 1}
    db.refresh(intervention)
    assert intervention.status == "RESOLVED"
    assert intervention.remediation_plan["resolution_ceiling_snapshot"]["remediation_adjusted_predicted_grade"] == 80.0
    notices = _resolved_notifications(ctx)
    assert len(notices) == 1
    assert "80" in notices[0].body
    assert "91.5" not in notices[0].body


def test_new_regular_quiz_raises_legitimate_unremediated_baseline_to_87_point_4_and_resolves_above_85(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)
    ctx["add_regular"]("WW 3 Regular", category="WRITTEN_WORK", cw_type="QUIZ", total_points=40, score=40)
    ctx["add_regular"]("PT 3 Regular", category="PERFORMANCE_TASK", cw_type="ACTIVITY", total_points=100, score=100)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=89.2, cutoff_at=cutoff, revision=23)

    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 87.4,
    )

    resolved = _sync(ctx, pred)
    db.commit()

    assert resolved.status == "RESOLVED"
    snap = resolved.remediation_plan["resolution_ceiling_snapshot"]
    assert snap["unremediated_baseline_grade"] == 87.4
    assert snap["effective_grade_ceiling"] == 87.4
    assert snap["remediation_adjusted_predicted_grade"] == 87.4
    assert snap["raw_predicted_grade"] == 89.2
    notices = _resolved_notifications(ctx)
    assert len(notices) == 1
    assert "87.4" in notices[0].body


def test_unavailable_baseline_does_not_auto_resolve_and_recovers_on_retry(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
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

    orig_prepare = post_grading_service.prepare_development_current_term

    def flaky_prepare(*args, **kwargs):
        if kwargs.get("exclude_intervention_id") is not None:
            return (
                {
                    "status": STATUS_INSUFFICIENT_EVIDENCE,
                    "readiness_reason_codes": ["INSUFFICIENT_AVAILABLE_ACTIVITIES"],
                },
                None,
            )
        return orig_prepare(*args, **kwargs)

    monkeypatch.setattr(post_grading_service, "prepare_development_current_term", flaky_prepare)

    # Unavailable baseline -> fail-closed: stays ACTIVE, no notification, no snapshot
    blocked = _sync(ctx, pred)
    db.commit()
    assert blocked.status == "ACTIVE"
    assert _resolved_notifications(ctx) == []
    assert "resolution_ceiling_snapshot" not in (blocked.remediation_plan or {})

    # Restore baseline preparation -> retry safely resolves once
    monkeypatch.setattr(post_grading_service, "prepare_development_current_term", orig_prepare)
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 83.0,
    )
    resolved = _sync(ctx, pred)
    db.commit()
    assert resolved.status == "RESOLVED"
    assert resolved.remediation_plan["resolution_ceiling_snapshot"]["remediation_adjusted_predicted_grade"] == 85.0
    assert len(_resolved_notifications(ctx)) == 1


def test_legacy_plan_and_candidate_preserve_existing_resolution_behavior(baseline_ctx):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _prepare_approved_model(ctx)
    intervention = ctx["current_intervention"]

    # Legacy ACTIVE plan without predicted_grade_ceiling
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "score_adjustment_cap": 80.0,
    }
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.0, cutoff_at=cutoff, revision=25)

    resolved = _sync(ctx, pred)
    db.commit()

    assert resolved.status == "RESOLVED"
    assert "resolution_ceiling_snapshot" not in (resolved.remediation_plan or {})
    notices = _resolved_notifications(ctx)
    assert len(notices) == 1
    assert "prediction improved to 88" in notices[0].body
