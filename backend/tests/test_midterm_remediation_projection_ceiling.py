"""Focused tests for Task 5: 85 remediation predicted-grade ceiling in MidtermRemediationProjectionService."""

from __future__ import annotations

import pytest

from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.SubjectGradeProjection import AIMidtermWhatIfRead
from app.services.grading import MidtermRemediationProjectionService as midterm_service
from app.services.grading.MidtermRemediationProjectionService import calculate_ai_midterm_what_if
from app.services.prediction import DevelopmentCurrentTermScoringService as current_term_scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_INSUFFICIENT_EVIDENCE,
)
from tests.test_unremediated_prediction_baseline import baseline_ctx


def _scope_kwargs(ctx):
    return dict(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        model_version_id=1,
        model_name=CORRECTED_MODEL_NAME,
    )


def test_84_to_89_capped_at_85_while_preserving_raw_rf_output(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    # No graded remediation exists yet -> unremediated features equal live baseline features,
    # so RF scorer is invoked once for baseline (84.0) and once for hypothetical WW1 max (89.0).
    outputs = iter((84.0, 89.0))
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: next(outputs),
    )

    subs_before = [
        (r.submission_id, r.grade)
        for r in db.query(StudentSubmission).order_by(StudentSubmission.submission_id).all()
    ]

    result = calculate_ai_midterm_what_if(
        db,
        **_scope_kwargs(ctx),
        target_projections=[{
            "assignment_id": ctx["ww1"].classwork_assignment_id,
            "component": "WRITTEN_WORK",
            "applied": True,
            "maximum_hypothetical_effective_score": 17.0,
        }],
        predicted_grade_ceiling=85,
        exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )

    # Validates cleanly against strict extra="forbid" Pydantic read schema
    parsed = AIMidtermWhatIfRead.model_validate(result)
    assert parsed.status == "AVAILABLE"
    assert parsed.baseline_predicted_term_grade == 84.0
    assert parsed.unremediated_baseline_predicted_term_grade == 84.0
    assert parsed.selected_grade_ceiling == 85.0
    assert parsed.effective_grade_ceiling == 85.0
    assert parsed.baseline_remediation_adjusted_predicted_term_grade == 84.0
    assert parsed.baseline_was_ceiling_applied is False

    assert len(parsed.target_estimates) == 1
    est = parsed.target_estimates[0]
    assert est.hypothetical_predicted_term_grade == 89.0
    assert est.raw_hypothetical_predicted_term_grade == 89.0
    assert est.remediation_adjusted_predicted_term_grade == 85.0
    assert est.applied_grade_ceiling == 85.0
    assert est.was_ceiling_applied is True
    assert est.estimated_difference_from_baseline == 5.0
    assert est.capped_estimated_difference_from_baseline == 1.0
    assert est.capped_step_estimated_difference == 1.0

    # Strictly read-only
    assert not db.new and not db.dirty and not db.deleted
    assert [
        (r.submission_id, r.grade)
        for r in db.query(StudentSubmission).order_by(StudentSubmission.submission_id).all()
    ] == subs_before


def test_regular_coursework_allows_legitimate_prediction_above_85(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]

    def feature_scorer(features, model_name=None):
        return round(25.0 + float(features["overall_partial_percent"]) * 0.75, 4)

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", feature_scorer)

    # Remediation 1 on WW1 raises effective WW1 from 10 -> 17
    ctx["add_ww_pt_remediation"](ctx["current_intervention"], ctx["ww1"], remediation_score=20, cap=85.0)
    # Student earns perfect scores on NEW regular quizzes/tasks -> unremediated rises > 85
    ctx["add_regular"]("WW 3 Regular", category="WRITTEN_WORK", cw_type="QUIZ", total_points=40, score=40)
    ctx["add_regular"]("PT 3 Regular", category="PERFORMANCE_TASK", cw_type="ACTIVITY", total_points=100, score=100)
    db.commit()

    result = calculate_ai_midterm_what_if(
        db,
        **_scope_kwargs(ctx),
        target_projections=[{
            "assignment_id": ctx["pt1"].classwork_assignment_id,
            "component": "PERFORMANCE_TASK",
            "applied": True,
            "maximum_hypothetical_effective_score": 42.5,
        }],
        predicted_grade_ceiling=85,
        exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )

    assert result["status"] == "AVAILABLE"
    unremediated = result["unremediated_baseline_predicted_term_grade"]
    live_raw = result["baseline_predicted_term_grade"]
    est = result["target_estimates"][0]

    # Unremediated baseline legitimately exceeds 85 from regular assessments alone
    assert unremediated > 85.0
    assert live_raw > unremediated
    assert result["selected_grade_ceiling"] == 85.0
    assert result["effective_grade_ceiling"] == unremediated
    assert result["baseline_remediation_adjusted_predicted_term_grade"] == unremediated
    assert result["baseline_was_ceiling_applied"] is True

    # Further remediation target cannot inflate above the legitimate unremediated baseline,
    # while raw RF prediction remains unmodified
    assert est["raw_hypothetical_predicted_term_grade"] > live_raw
    assert est["hypothetical_predicted_term_grade"] == est["raw_hypothetical_predicted_term_grade"]
    assert est["remediation_adjusted_predicted_term_grade"] == unremediated
    assert est["remediation_adjusted_predicted_term_grade"] > 85.0
    assert est["applied_grade_ceiling"] == unremediated
    assert est["was_ceiling_applied"] is True
    assert est["capped_estimated_difference_from_baseline"] == 0.0


def test_multiple_remediation_activities_cannot_bypass_85_ceiling(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]

    def feature_scorer(features, model_name=None):
        # Maps pre-remediation (70.5%) -> 82.925, post-Activity-1 (75.0%) -> 86.75, +Activity 2/3 -> 89+/91+
        return round(23.0 + float(features["overall_partial_percent"]) * 0.85, 4)

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", feature_scorer)

    # Activity 1 already graded on PT1 (35 -> 42.5/50) pushing live raw > 85 while unremediated < 85
    ctx["add_ww_pt_remediation"](ctx["current_intervention"], ctx["pt1"], remediation_score=50, cap=85.0)
    db.commit()

    # Now preview Activity 2 (WW1) and Activity 3 (WW2) cumulatively under the same intervention ceiling 85
    result = calculate_ai_midterm_what_if(
        db,
        **_scope_kwargs(ctx),
        target_projections=[
            {
                "assignment_id": ctx["ww1"].classwork_assignment_id,
                "component": "WRITTEN_WORK",
                "applied": True,
                "maximum_hypothetical_effective_score": 17.0,
            },
            {
                "assignment_id": ctx["ww2"].classwork_assignment_id,
                "component": "WRITTEN_WORK",
                "applied": True,
                "maximum_hypothetical_effective_score": 17.0,
            },
        ],
        predicted_grade_ceiling=85,
        exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )

    assert result["status"] == "AVAILABLE"
    assert result["unremediated_baseline_predicted_term_grade"] < 85.0
    assert result["baseline_predicted_term_grade"] > 85.0
    assert result["effective_grade_ceiling"] == 85.0
    assert result["baseline_remediation_adjusted_predicted_term_grade"] == 85.0
    assert result["baseline_was_ceiling_applied"] is True

    est_1, est_2 = result["target_estimates"]
    assert est_1["raw_hypothetical_predicted_term_grade"] > result["baseline_predicted_term_grade"]
    assert est_2["raw_hypothetical_predicted_term_grade"] > est_1["raw_hypothetical_predicted_term_grade"]
    # Neither Activity 2 nor cumulative Activity 2 + Activity 3 can leak past 85
    assert est_1["remediation_adjusted_predicted_term_grade"] == 85.0
    assert est_2["remediation_adjusted_predicted_term_grade"] == 85.0
    assert est_1["was_ceiling_applied"] is True
    assert est_2["was_ceiling_applied"] is True
    assert est_1["capped_step_estimated_difference"] == 0.0
    assert est_2["capped_step_estimated_difference"] == 0.0


def test_examination_remediation_enforces_same_85_ceiling(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]

    def feature_scorer(features, model_name=None):
        # Maps pre-remediation (70.5%) -> 84.81, post-Exam (73.0%) -> 86.86
        return round(27.0 + float(features["overall_partial_percent"]) * 0.82, 4)

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", feature_scorer)

    result = calculate_ai_midterm_what_if(
        db,
        **_scope_kwargs(ctx),
        target_projections=[{
            "assignment_id": ctx["sum1"].classwork_assignment_id,
            "component": "EXAMINATION",
            "applied": True,
            "maximum_hypothetical_effective_score": 30.0,
        }],
        predicted_grade_ceiling=85,
        exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )

    assert result["status"] == "AVAILABLE"
    assert result["unremediated_baseline_predicted_term_grade"] < 85.0
    est = result["target_estimates"][0]
    assert est["raw_hypothetical_predicted_term_grade"] > 85.0
    assert est["hypothetical_predicted_term_grade"] == est["raw_hypothetical_predicted_term_grade"]
    assert est["remediation_adjusted_predicted_term_grade"] == 85.0
    assert est["applied_grade_ceiling"] == 85.0
    assert est["was_ceiling_applied"] is True


def test_unavailable_unremediated_baseline_is_explicit_and_never_substituted(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]

    # Case 1: ceiling supplied without exclude_intervention_id -> explicit UNAVAILABLE
    missing_scope = calculate_ai_midterm_what_if(
        db,
        **_scope_kwargs(ctx),
        target_projections=[{
            "assignment_id": ctx["ww1"].classwork_assignment_id,
            "component": "WRITTEN_WORK",
            "applied": True,
            "maximum_hypothetical_effective_score": 17.0,
        }],
        predicted_grade_ceiling=85,
        exclude_intervention_id=None,
    )
    parsed_missing = AIMidtermWhatIfRead.model_validate(missing_scope)
    assert parsed_missing.status == "UNAVAILABLE"
    assert parsed_missing.unremediated_baseline_predicted_term_grade is None
    assert parsed_missing.target_estimates == []
    assert any(r.code == "UNREMEDIATED_BASELINE_UNAVAILABLE" for r in parsed_missing.unavailable_reasons)

    # Case 2: live baseline succeeds, unremediated baseline returns STATUS_INSUFFICIENT_EVIDENCE
    orig_prepare = midterm_service.prepare_development_current_term

    def flaky_prepare(*args, **kwargs):
        if kwargs.get("exclude_intervention_id") is not None:
            return (
                {
                    "status": STATUS_INSUFFICIENT_EVIDENCE,
                    "projected_final_term_grade": None,
                    "readiness_reason_codes": ["INSUFFICIENT_AVAILABLE_ACTIVITIES"],
                    "readiness_result": {"ready": False, "readiness_level": "INSUFFICIENT_EVIDENCE"},
                },
                None,
            )
        return orig_prepare(*args, **kwargs)

    monkeypatch.setattr(midterm_service, "prepare_development_current_term", flaky_prepare)
    monkeypatch.setattr(
        current_term_scorer,
        "score_development_current_term",
        lambda _features, model_name=None: 84.0,
    )

    unavail = calculate_ai_midterm_what_if(
        db,
        **_scope_kwargs(ctx),
        target_projections=[{
            "assignment_id": ctx["ww1"].classwork_assignment_id,
            "component": "WRITTEN_WORK",
            "applied": True,
            "maximum_hypothetical_effective_score": 17.0,
        }],
        predicted_grade_ceiling=85,
        exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )
    parsed_unavail = AIMidtermWhatIfRead.model_validate(unavail)
    assert parsed_unavail.status == "UNAVAILABLE"
    assert parsed_unavail.baseline_predicted_term_grade is None
    assert parsed_unavail.unremediated_baseline_predicted_term_grade is None
    assert parsed_unavail.target_estimates == []
    reason_codes = {r.code for r in parsed_unavail.unavailable_reasons}
    assert "UNREMEDIATED_BASELINE_UNAVAILABLE" in reason_codes
    assert "INSUFFICIENT_AVAILABLE_ACTIVITIES" in reason_codes


def test_legacy_caller_without_ceiling_preserves_behavior_and_inference_count(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    call_count = 0
    outputs = iter((84.0, 89.0))

    def counting_scorer(_features, model_name=None):
        nonlocal call_count
        call_count += 1
        return next(outputs)

    monkeypatch.setattr(current_term_scorer, "score_development_current_term", counting_scorer)

    result = calculate_ai_midterm_what_if(
        db,
        **_scope_kwargs(ctx),
        target_projections=[{
            "assignment_id": ctx["ww1"].classwork_assignment_id,
            "component": "WRITTEN_WORK",
            "applied": True,
            "maximum_hypothetical_effective_score": 17.0,
        }],
    )

    parsed = AIMidtermWhatIfRead.model_validate(result)
    assert call_count == 2  # baseline + 1 target only (no extra unremediated pass)
    assert parsed.status == "AVAILABLE"
    assert parsed.baseline_predicted_term_grade == 84.0
    assert parsed.unremediated_baseline_predicted_term_grade is None
    assert parsed.selected_grade_ceiling is None
    assert parsed.effective_grade_ceiling is None
    assert parsed.baseline_remediation_adjusted_predicted_term_grade is None
    assert parsed.baseline_was_ceiling_applied is False
    est = parsed.target_estimates[0]
    assert est.hypothetical_predicted_term_grade == 89.0
    assert est.raw_hypothetical_predicted_term_grade == 89.0
    assert est.remediation_adjusted_predicted_term_grade is None
    assert est.applied_grade_ceiling is None
    assert est.was_ceiling_applied is False
    assert est.estimated_difference_from_baseline == 5.0


def test_invalid_ceiling_or_exclude_id_rejected(baseline_ctx):
    ctx = baseline_ctx
    db = ctx["db"]
    with pytest.raises(ValueError, match="selected_ceiling must be between 0 and 85"):
        calculate_ai_midterm_what_if(
            db,
            **_scope_kwargs(ctx),
            target_projections=[],
            predicted_grade_ceiling=86,
            exclude_intervention_id=ctx["current_intervention"].intervention_id,
        )
    with pytest.raises(ValueError, match="exclude_intervention_id must be a positive integer"):
        calculate_ai_midterm_what_if(
            db,
            **_scope_kwargs(ctx),
            target_projections=[],
            predicted_grade_ceiling=85,
            exclude_intervention_id=0,
        )
