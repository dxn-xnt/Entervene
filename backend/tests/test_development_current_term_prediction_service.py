from __future__ import annotations

from decimal import Decimal
from datetime import date, timedelta

import pytest

from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.services.prediction import DevelopmentCurrentTermPredictionService as service
from tests.test_current_period_live_feature_builder import add_activity, current_period_context


def _set_weights(ctx, ww: str = "20", pt: str = "50", qa: str = "30") -> None:
    components = (
        ctx["db"].query(GradingTemplateComponent)
        .filter(GradingTemplateComponent.grading_template_id == ctx["template"].grading_template_id)
        .order_by(GradingTemplateComponent.display_order)
        .all()
    )
    components[0].weight = Decimal(ww)
    components[1].weight = Decimal(pt)
    components[2].weight = Decimal(qa)
    ctx["db"].commit()


def _make_ready(ctx) -> None:
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "WRITTEN_WORK", 7, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 18, 20)
    add_activity(ctx, "PERFORMANCE_TASK", 17, 20)


def _predict(ctx, *, target_period_id=None):
    return service.predict_development_current_term(
        ctx["db"],
        ctx["student"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period"].academic_period_id,
        target_period_id,
    )


def test_ready_supported_scope_scores_development_prediction(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    captured = {}

    def fake_score(features):
        captured["features"] = dict(features)
        return 88.75

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fake_score)

    result = _predict(ctx)

    assert result["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert result["projected_final_term_grade"] == pytest.approx(88.75)
    assert result["source_period_id"] == ctx["period"].academic_period_id
    assert result["target_period_id"] == ctx["period"].academic_period_id
    assert result["readiness_result"]["ready"] is True
    assert result["readiness_result"]["readiness_level"] == "STANDARD_READY"
    assert result["model_name"] == service.v3_scorer.MODEL_NAME
    assert result["model_development_status"] == service.MODEL_DEVELOPMENT_STATUS
    assert result["prediction_purpose"] == service.PREDICTION_PURPOSE
    assert captured["features"]["subject"] == "SCIENCE"


@pytest.mark.parametrize("scheduled_end_offset", [-30, 30])
def test_admin_active_period_allows_generation_on_either_side_of_scheduled_end(
    current_period_context, monkeypatch, scheduled_end_offset
):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    ctx["period"].start_date = date.today() - timedelta(days=60)
    ctx["period"].end_date = date.today() + timedelta(days=scheduled_end_offset)
    ctx["db"].commit()
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: 84.6)

    assert _predict(ctx)["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE


def test_inactive_period_blocks_before_scoring(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    ctx["period"].is_active = False
    ctx["db"].commit()
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: pytest.fail("Scorer called"))

    result = _predict(ctx)
    assert result["status"] == service.STATUS_PERIOD_NOT_ACTIVE
    assert result["readiness_reason_codes"] == ["PERIOD_NOT_ACTIVE"]


def test_insufficient_evidence_returns_without_scoring(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 18, 20)

    def fail_score(_features):
        raise AssertionError("scorer must not be called")

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fail_score)

    result = _predict(ctx)

    assert result["status"] == service.STATUS_INSUFFICIENT_EVIDENCE
    assert result["projected_final_term_grade"] is None
    assert result["readiness_result"]["ready"] is False
    assert "INSUFFICIENT_AVAILABLE_ACTIVITIES" in result["readiness_reason_codes"]


def test_same_term_contract_accepts_same_period_and_rejects_different_target(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: 87.0)

    same = _predict(ctx, target_period_id=ctx["period"].academic_period_id)
    different = _predict(ctx, target_period_id=ctx["next_period"].academic_period_id)

    assert same["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert different["status"] == service.STATUS_INVALID_PERIOD_SCOPE
    assert different["readiness_reason_codes"] == ["SOURCE_TARGET_PERIOD_MISMATCH"]


def test_unsupported_subject_blocks_before_scoring(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    ctx["subject"].subject_codename = "PHILOSOPHY"
    ctx["db"].commit()
    _make_ready(ctx)

    def fail_score(_features):
        raise AssertionError("scorer must not be called")

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fail_score)

    result = _predict(ctx)

    assert result["status"] == service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN
    assert result["readiness_result"]["ready"] is True
    assert result["readiness_reason_codes"] == ["UNSUPPORTED_SUBJECT"]
    assert result["domain_result"]["subject"] == "PHILOSOPHY"


def test_unsupported_weight_pattern_blocks_before_scoring(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx, "20", "40", "40")
    _make_ready(ctx)
    add_activity(ctx, "QUARTERLY_ASSESSMENT", 32, 40)

    def fail_score(_features):
        raise AssertionError("scorer must not be called")

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fail_score)

    result = _predict(ctx)

    assert result["status"] == service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN
    assert result["readiness_result"]["ready"] is True
    assert result["readiness_reason_codes"] == ["UNSUPPORTED_WEIGHT_PATTERN"]
    assert result["domain_result"]["weight_pattern"] == "20/40/40"


def test_finalized_same_term_grade_blocks_prediction(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    ctx["db"].add(StudentPeriodGrade(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        final_period_grade=Decimal("92.00"),
        is_finalized=True,
    ))
    ctx["db"].commit()

    def fail_score(_features):
        raise AssertionError("scorer must not be called")

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fail_score)

    result = _predict(ctx)

    assert result["status"] == service.STATUS_FINALIZED_GRADE_EXISTS
    assert result["readiness_reason_codes"] == ["FINALIZED_SAME_TERM_GRADE_EXISTS"]
    assert result["projected_final_term_grade"] is None


def test_leakage_fields_do_not_enter_scorer_payload(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    captured = {}
    forbidden = set(service.v3_scorer.FORBIDDEN_INPUT_FIELDS) | {
        "final_period_grade",
        "transmuted_grade",
        "initial_grade",
    }

    def fake_score(features):
        captured["features"] = dict(features)
        return 90.0

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fake_score)

    result = _predict(ctx)

    assert result["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert forbidden.isdisjoint(captured["features"])
    assert len(captured["features"]) == 31
