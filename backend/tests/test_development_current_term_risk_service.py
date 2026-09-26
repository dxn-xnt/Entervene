from __future__ import annotations

import pytest

from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction_service
from app.services.prediction import DevelopmentCurrentTermRiskService as service
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights


def _prediction(grade, status=prediction_service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE, reasons=None):
    return {
        "status": status,
        "projected_final_term_grade": grade,
        "readiness_reason_codes": reasons or [],
        "prediction_purpose": prediction_service.PREDICTION_PURPOSE,
        "model_name": prediction_service.v3_scorer.MODEL_NAME,
        "model_development_status": prediction_service.MODEL_DEVELOPMENT_STATUS,
    }


@pytest.mark.parametrize(
    ("grade", "level", "reason"),
    [
        (74, "HIGH_RISK", "PROJECTED_GRADE_BELOW_75"),
        (75, "MODERATE_RISK", "PROJECTED_GRADE_75_TO_BELOW_85"),
        (78, "MODERATE_RISK", "PROJECTED_GRADE_75_TO_BELOW_85"),
        (84.99, "MODERATE_RISK", "PROJECTED_GRADE_75_TO_BELOW_85"),
        (85, "NEEDS_MONITORING", "PROJECTED_GRADE_85_TO_BELOW_90"),
        (89.99, "NEEDS_MONITORING", "PROJECTED_GRADE_85_TO_BELOW_90"),
        (90, "LOW_RISK", "PROJECTED_GRADE_90_OR_ABOVE"),
    ],
)
def test_grade_bands_are_rule_based(grade, level, reason):
    result = service.assess_development_current_term_intervention(_prediction(grade))

    assert result["projected_final_term_grade"] == grade
    assert result["intervention_level"] == level
    assert result["intervention_basis"] == service.INTERVENTION_BASIS
    assert result["triggered_reasons"] == [reason]
    assert result["prediction_status"] == prediction_service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert result["prediction_purpose"] == prediction_service.PREDICTION_PURPOSE
    assert result["development_status"] == prediction_service.MODEL_DEVELOPMENT_STATUS
    assert result["model_name"] == prediction_service.v3_scorer.MODEL_NAME
    assert result["model_scope_note"] == service.MODEL_SCOPE_NOTE
    assert "rule-based" in result["intervention_explanation"]


@pytest.mark.parametrize(
    "status",
    [
        prediction_service.STATUS_INSUFFICIENT_EVIDENCE,
        prediction_service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN,
        prediction_service.STATUS_INVALID_PERIOD_SCOPE,
        prediction_service.STATUS_FINALIZED_GRADE_EXISTS,
        prediction_service.STATUS_SCHEMA_CONTRACT_ERROR,
    ],
)
def test_non_prediction_preserves_upstream_status_and_reasons(status):
    result = service.assess_development_current_term_intervention(
        _prediction(None, status, ["UPSTREAM_REASON"])
    )

    assert result["prediction_status"] == status
    assert result["upstream_reason_codes"] == ["UPSTREAM_REASON"]
    assert result["intervention_level"] == service.INTERVENTION_NOT_ASSESSED
    assert result["projected_final_term_grade"] is None
    assert result["intervention_basis"] is None
    assert result["triggered_reasons"] == []


@pytest.mark.parametrize("grade", [None, float("nan"), float("inf"), -1, 101, "bad"])
def test_missing_or_invalid_grade_is_not_assessed(grade):
    result = service.assess_development_current_term_intervention(_prediction(grade))

    assert result["intervention_level"] == service.INTERVENTION_NOT_ASSESSED
    assert result["projected_final_term_grade"] is None
    assert result["upstream_reason_codes"]


def test_behavior_and_missing_activities_only_supply_context():
    result = service.assess_development_current_term_intervention(
        _prediction(90),
        supporting_context={
            "behavioral_engagement_score": 20,
            "attendance_rate": 30,
            "missing_activity_count": 8,
            "assessment_completion_rate": 0.4,
            "data_coverage_ratio": 0.3,
            "ww_percent": 25,
            "risk_score": 99,
        },
    )

    assert result["intervention_level"] == "LOW_RISK"
    assert result["triggered_reasons"] == ["PROJECTED_GRADE_90_OR_ABOVE"]
    assert result["supporting_context"] == {
        "role": "SUPPORTING_CONTEXT_ONLY",
        "signals": {
            "behavioral_engagement_score": 20,
            "attendance_rate": 30,
            "missing_activity_count": 8,
            "assessment_completion_rate": 0.4,
            "data_coverage_ratio": 0.3,
            "ww_percent": 25,
        },
    }


def test_result_contract_has_no_probability_or_next_period_inputs():
    result = service.assess_development_current_term_intervention(_prediction(78))
    forbidden = {
        "probability",
        "failure_probability",
        "risk_probability",
        "risk_score",
        "source_period_grade",
        "grade_trend_vs_previous_period",
        "has_previous_period",
    }

    assert forbidden.isdisjoint(result)
    assert forbidden.isdisjoint(result["supporting_context"]["signals"])
    assert "probability" not in str(result).lower()
    assert "next-period" not in str(result).lower()


def test_development_wrapper_passes_prediction_to_adapter(monkeypatch):
    calls = {}

    def fake_predict(*args, **kwargs):
        calls["args"] = args
        calls["kwargs"] = kwargs
        return _prediction(85)

    monkeypatch.setattr(prediction_service, "predict_development_current_term", fake_predict)
    result = service.predict_and_assess_development_current_term(
        None, "student-id", 2, 3, 4, supporting_context={"missing_activity_count": 5}
    )

    assert calls["args"] == (None, "student-id", 2, 3, 4, None)
    assert result["intervention_level"] == "NEEDS_MONITORING"
    assert result["supporting_context"]["signals"] == {"missing_activity_count": 5}


def test_development_wrapper_uses_live_current_term_prediction(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    selected_models = []

    def fake_score(_features, model_name=prediction_service.v3_scorer.MODEL_NAME):
        selected_models.append(model_name)
        return 78.0

    monkeypatch.setattr(prediction_service.v3_scorer, "score_development_current_term", fake_score)

    result = service.predict_and_assess_development_current_term(
        ctx["db"],
        ctx["student"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period"].academic_period_id,
    )

    assert result["prediction_status"] == prediction_service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert result["projected_final_term_grade"] == 78.0
    assert result["intervention_level"] == "MODERATE_RISK"
    assert result["intervention_basis"] == service.INTERVENTION_BASIS
    assert selected_models == [prediction_service.selected_development_model_name()]
