"""Focused tests for Task 9: shared read-only post-grading remediation prediction evaluator."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention import RemediationPostGradingService as post_grading_service
from app.services.intervention.RemediationPostGradingService import (
    STATUS_AVAILABLE,
    STATUS_UNAVAILABLE,
    evaluate_actual_remediation_prediction,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as current_term_scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_DEVELOPMENT_PREDICTION_AVAILABLE,
    STATUS_INSUFFICIENT_EVIDENCE,
    prepare_development_current_term,
)
from tests.test_unremediated_prediction_baseline import baseline_ctx


def _configure_model_version(ctx) -> AIModelVersion:
    db = ctx["db"]
    model = db.query(AIModelVersion).first()
    model.model_name = CORRECTED_MODEL_NAME
    model.registry_metadata_json = {
        "feature_schema_version": "v3",
        "feature_schema_sha256": "schema-sha-abc",
        "artifact_sha256": "artifact-sha-xyz",
    }
    db.flush()
    return model


def _persist_prediction_at_cutoff(
    ctx,
    *,
    model: AIModelVersion,
    raw_grade: float,
    cutoff_at: datetime,
    revision: int,
    readiness_status: str = "READY",
) -> DevelopmentCurrentTermPrediction:
    db = ctx["db"]
    pred_meta, prepared = prepare_development_current_term(
        db,
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
        cutoff_at=cutoff_at,
        model_name=model.model_name,
    )
    assert pred_meta["status"] == STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert prepared is not None
    model_features = [{"name": k, "value": v} for k, v in prepared["features"].items()]
    row = DevelopmentCurrentTermPrediction(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
        target_period_id=ctx["period"].academic_period_id,
        model_version_id=model.model_version_id,
        revision=revision,
        predicted_period_grade=Decimal(f"{raw_grade:.2f}"),
        intervention_level="MODERATE_RISK" if raw_grade < 85 else "NEEDS_MONITORING",
        intervention_basis="RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE",
        evidence_snapshot={
            "generation_cutoff_at": cutoff_at.isoformat(),
            "model_version_id": model.model_version_id,
            "feature_schema_sha256": "schema-sha-abc",
            "artifact_sha256": "artifact-sha-xyz",
            "projected_final_term_grade_raw": raw_grade,
            "readiness": {"status": readiness_status, "level": "HIGH_EVIDENCE", "reason_codes": []},
            "model_features": model_features,
        },
    )
    db.add(row)
    db.commit()
    return row


def test_83_to_84_point_2_uses_committed_score_and_remains_below_passing(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _configure_model_version(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }

    # Student completes WW1 remediation with partial score 14/20 (NOT hypothetical max 17/20)
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=14, cap=85.0)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=84.2, cutoff_at=cutoff, revision=10)

    # Unremediated baseline (WW1=10/20) scores 83.0
    scored_ww_earned = []

    def scorer(features, model_name=None):
        assert model_name == model.model_name
        scored_ww_earned.append(features["ww_points_earned_so_far"])
        return 83.0

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", scorer)

    res = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res.status == STATUS_AVAILABLE
    assert res.raw_predicted_grade == 84.2
    assert res.unremediated_baseline_grade == 83.0
    assert res.selected_grade_ceiling == 85.0
    assert res.effective_grade_ceiling == 85.0
    assert res.remediation_adjusted_predicted_grade == 84.2
    assert res.remediation_adjusted_predicted_grade < 85.0
    assert res.was_ceiling_applied is False
    assert res.is_legacy_uncapped is False
    # Confirmed unremediated baseline scored WW1=10 + WW2=12 = 22.0 (not 14 + 12 = 26.0)
    assert scored_ww_earned == [22.0]
    assert not db.new and not db.dirty and not db.deleted


def test_raw_88_capped_at_85_for_both_ww_pt_and_examination_without_mutating_prediction(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _configure_model_version(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)
    cutoff_1 = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred_ww = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.0, cutoff_at=cutoff_1, revision=11)

    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 83.0,
    )

    res_ww = evaluate_actual_remediation_prediction(db, intervention, pred_ww)
    assert res_ww.status == STATUS_AVAILABLE
    assert res_ww.raw_predicted_grade == 88.0
    assert res_ww.remediation_adjusted_predicted_grade == 85.0
    assert res_ww.unremediated_baseline_grade == 83.0
    assert res_ww.selected_grade_ceiling == 85.0
    assert res_ww.effective_grade_ceiling == 85.0
    assert res_ww.was_ceiling_applied is True
    # Persisted prediction row remains completely untouched
    db.refresh(pred_ww)
    assert pred_ww.predicted_period_grade == Decimal("88.00")
    assert pred_ww.evidence_snapshot["projected_final_term_grade_raw"] == 88.0

    # Also verify EXAMINATION remediation follows the exact same 85 ceiling rule
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "EXAMINATION",
        "original_exam_assignment_id": ctx["sum1"].classwork_assignment_id,
        "target_assignment_ids": [ctx["sum1"].classwork_assignment_id],
        "predicted_grade_ceiling": 85.0,
    }
    ctx["add_exam_remediation"](intervention, ctx["sum1"], remediation_score=30)
    cutoff_2 = datetime.now(timezone.utc) + timedelta(seconds=2)
    pred_exam = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.5, cutoff_at=cutoff_2, revision=12)

    res_exam = evaluate_actual_remediation_prediction(db, intervention, pred_exam)
    assert res_exam.status == STATUS_AVAILABLE
    assert res_exam.raw_predicted_grade == 88.5
    assert res_exam.remediation_adjusted_predicted_grade == 85.0
    assert res_exam.was_ceiling_applied is True


def test_regular_coursework_raises_legitimate_baseline_to_87_point_4_and_is_preserved(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _configure_model_version(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }

    # Student completes remediation AND also scores perfectly on new regular coursework
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)
    ctx["add_regular"]("WW 3 Regular", category="WRITTEN_WORK", cw_type="QUIZ", total_points=40, score=40)
    ctx["add_regular"]("PT 3 Regular", category="PERFORMANCE_TASK", cw_type="ACTIVITY", total_points=100, score=100)
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=89.2, cutoff_at=cutoff, revision=13)

    # Unremediated baseline (including WW3=40/40 and PT3=100/100, excluding WW1 remediation) -> 87.4
    seen = []

    def scorer(features, model_name=None):
        seen.append((features["ww_points_earned_so_far"], features["pt_points_earned_so_far"]))
        return 87.4

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", scorer)

    res = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res.status == STATUS_AVAILABLE
    assert seen == [(62.0, 175.0)]  # WW1(10)+WW2(12)+WW3(40)=62, PT1(35)+PT2(40)+PT3(100)=175
    assert res.unremediated_baseline_grade == 87.4
    assert res.selected_grade_ceiling == 85.0
    assert res.effective_grade_ceiling == 87.4
    assert res.remediation_adjusted_predicted_grade == 87.4
    assert res.raw_predicted_grade == 89.2
    assert res.was_ceiling_applied is True


def test_multiple_remediation_attempts_cannot_bypass_ceiling_and_cutoff_prevents_future_leakage(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _configure_model_version(ctx)
    intervention = ctx["current_intervention"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [ctx["ww1"].classwork_assignment_id, ctx["ww2"].classwork_assignment_id],
        "score_adjustment_cap": 85.0,
        "predicted_grade_ceiling": 85.0,
    }

    # Three remediation attempts inside the same intervention (WW1, PT1, Exam)
    ctx["add_ww_pt_remediation"](intervention, ctx["ww1"], remediation_score=20, cap=85.0)
    ctx["add_ww_pt_remediation"](intervention, ctx["pt1"], remediation_score=50, cap=85.0)
    ctx["add_exam_remediation"](intervention, ctx["sum1"], remediation_score=30)
    cutoff_t1 = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred_t1 = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=91.5, cutoff_at=cutoff_t1, revision=14)

    # Add a brand-new high-scoring regular quiz AFTER cutoff_t1 -> must NOT leak backward into pred_t1!
    future_asgn = ctx["add_regular"]("WW Future", category="WRITTEN_WORK", cw_type="QUIZ", total_points=50, score=50)
    future_sub = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=future_asgn.classwork_assignment_id,
    ).one()
    future_time = cutoff_t1 + timedelta(hours=2)
    future_sub.submitted_at = future_time
    future_sub.graded_at = future_time
    db.commit()

    def feature_scorer(features, model_name=None):
        # Verify WW Future (50 pts) is excluded at cutoff_t1 and all 3 remediations are excluded
        assert features["ww_points_earned_so_far"] == 22.0   # WW1(10) + WW2(12)
        assert features["pt_points_earned_so_far"] == 75.0   # PT1(35) + PT2(40)
        return 81.8

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", feature_scorer)

    res = evaluate_actual_remediation_prediction(db, intervention, pred_t1)
    assert res.status == STATUS_AVAILABLE
    assert res.raw_predicted_grade == 91.5
    assert res.unremediated_baseline_grade == 81.8
    assert res.effective_grade_ceiling == 85.0
    assert res.remediation_adjusted_predicted_grade == 85.0
    assert res.was_ceiling_applied is True


def test_legacy_plan_practice_only_and_candidate_pass_through_safely(baseline_ctx):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _configure_model_version(ctx)
    intervention = ctx["current_intervention"]

    cutoff = datetime.now(timezone.utc) + timedelta(seconds=1)
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.0, cutoff_at=cutoff, revision=15)

    # 1. Legacy plan (no predicted_grade_ceiling key)
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "score_adjustment_cap": 80.0,
    }
    res_legacy = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res_legacy.status == STATUS_AVAILABLE
    assert res_legacy.is_legacy_uncapped is True
    assert res_legacy.raw_predicted_grade == 88.0
    assert res_legacy.remediation_adjusted_predicted_grade == 88.0
    assert res_legacy.selected_grade_ceiling is None
    assert res_legacy.was_ceiling_applied is False

    # 2. PRACTICE_ONLY plan
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "PRACTICE_ONLY",
        "predicted_grade_ceiling": None,
    }
    res_practice = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res_practice.status == STATUS_AVAILABLE
    assert res_practice.is_legacy_uncapped is True
    assert res_practice.remediation_adjusted_predicted_grade == 88.0


def test_unavailable_baseline_model_mismatch_missing_cutoff_and_evidence_drift_fail_explicitly(
    baseline_ctx,
    monkeypatch,
):
    ctx = baseline_ctx
    db = ctx["db"]
    model = _configure_model_version(ctx)
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
    pred = _persist_prediction_at_cutoff(ctx, model=model, raw_grade=88.0, cutoff_at=cutoff, revision=16)

    # 1. Missing generation_cutoff_at -> explicit UNAVAILABLE
    orig_snapshot = dict(pred.evidence_snapshot)
    pred.evidence_snapshot = {k: v for k, v in orig_snapshot.items() if k != "generation_cutoff_at"}
    res_no_cutoff = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res_no_cutoff.status == STATUS_UNAVAILABLE
    assert res_no_cutoff.remediation_adjusted_predicted_grade is None
    assert "GENERATION_CUTOFF_MISSING" in res_no_cutoff.unavailable_reason_codes

    # 2. Model artifact hash mismatch -> explicit UNAVAILABLE
    pred.evidence_snapshot = {**orig_snapshot, "artifact_sha256": "different-artifact-sha"}
    res_hash = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res_hash.status == STATUS_UNAVAILABLE
    assert "MODEL_VERSION_ARTIFACT_MISMATCH" in res_hash.unavailable_reason_codes

    # 3. Model version ID mismatch -> explicit UNAVAILABLE
    pred.evidence_snapshot = {**orig_snapshot, "model_version_id": model.model_version_id + 999}
    res_ver = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res_ver.status == STATUS_UNAVAILABLE
    assert "MODEL_VERSION_MISMATCH" in res_ver.unavailable_reason_codes

    # Restore valid snapshot
    pred.evidence_snapshot = dict(orig_snapshot)

    # 4. Corrupt ceiling > 85 -> explicit UNAVAILABLE (fail-closed)
    intervention.remediation_plan = {**intervention.remediation_plan, "predicted_grade_ceiling": 95.0}
    res_bad_ceil = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res_bad_ceil.status == STATUS_UNAVAILABLE
    assert "INVALID_PREDICTED_GRADE_CEILING" in res_bad_ceil.unavailable_reason_codes
    intervention.remediation_plan = {**intervention.remediation_plan, "predicted_grade_ceiling": 85.0}

    # 5. Unremediated baseline unavailable -> explicit UNAVAILABLE (never substitutes baseline)
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
    res_unavail = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res_unavail.status == STATUS_UNAVAILABLE
    assert res_unavail.remediation_adjusted_predicted_grade is None
    assert "UNREMEDIATED_BASELINE_UNAVAILABLE" in res_unavail.unavailable_reason_codes
    assert "INSUFFICIENT_AVAILABLE_ACTIVITIES" in res_unavail.unavailable_reason_codes
    monkeypatch.setattr(post_grading_service, "prepare_development_current_term", orig_prepare)

    # 6. Historical evidence drift (regular score mutated retroactively) -> explicit UNAVAILABLE
    ww2_sub = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=ctx["ww2"].classwork_assignment_id,
    ).one()
    ww2_sub.grade = Decimal("19")
    db.flush()
    res_drift = evaluate_actual_remediation_prediction(db, intervention, pred)
    assert res_drift.status == STATUS_UNAVAILABLE
    assert "HISTORICAL_EVIDENCE_DRIFT" in res_drift.unavailable_reason_codes
    db.rollback()
