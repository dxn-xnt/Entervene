from __future__ import annotations

import pytest

from app.models.academic.AcademicLevel import AcademicLevel
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME, LEGACY_MODEL_NAME
from app.services.prediction import DevelopmentCurrentTermPredictionService as service
from tests.test_development_current_term_prediction_service import _make_ready, _predict, _set_weights, add_activity
from tests.test_current_period_live_feature_builder import current_period_context


@pytest.mark.parametrize(
    "grade,code,name,canonical",
    [
        (7, "MATH7", "Mathematics 7", "MATHEMATICS"),
        (7, "SCI7", "Science 7", "SCIENCE"),
        (7, "ENG7", "English 7", "ENGLISH"),
        (8, "ENG8", "English 8", "ENGLISH"),
        (9, "ENG9", "English 9", "ENGLISH"),
        (10, "MATH10", "Mathematics 10", "MATHEMATICS"),
        (10, "SCI10", "Science 10", "SCIENCE"),
    ],
)
def test_verified_jhs_mapping_scores_exact_canonical_subject(current_period_context, monkeypatch, grade, code, name, canonical):
    ctx = current_period_context
    ctx["level"].grade_level = grade
    ctx["subject"].subject_codename = code
    ctx["subject"].subject_name = name
    ctx["db"].commit()
    _set_weights(ctx)
    _make_ready(ctx)
    captured = []

    def fake_score(features, model_name=LEGACY_MODEL_NAME):
        captured.append((features["subject"], model_name))
        return 86.0

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fake_score)

    result = _predict(ctx, model_name=CORRECTED_MODEL_NAME)

    assert result["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert captured == [(canonical, CORRECTED_MODEL_NAME)]
    assert result["is_provisional"] is False
    assert result["validation_status"] == "VALIDATED_JHS"


@pytest.mark.parametrize("grade,code,name,canonical", [
    (7, "ENMATH7", "Enhanced Mathematics 7", "MATHEMATICS"),
    (8, "ENMATH8", "Enhanced Mathematics 8", "MATHEMATICS"),
    (9, "ENMATH9", "Enhanced Mathematics 9", "MATHEMATICS"),
    (9, "MATH9_EXTRA", "Enhanced Mathematics 9", "MATHEMATICS"),
    (10, "ENMATH10", "Enhanced Mathematics 10", "MATHEMATICS"),
    (7, "ENSCI7", "Enhanced Science 7", "SCIENCE"),
    (8, "ENSCI8", "Enhanced Science 8", "SCIENCE"),
    (9, "ENSCI9", "Enhanced Science 9", "SCIENCE"),
    (10, "ENSCI10", "Enhanced Science 10", "SCIENCE"),
])
def test_enhanced_mathematics_and_science_normalized_and_scored(current_period_context, monkeypatch, grade, code, name, canonical):
    ctx = current_period_context
    ctx["level"].grade_level = grade
    ctx["subject"].subject_codename = code
    ctx["subject"].subject_name = name
    ctx["db"].commit()
    _set_weights(ctx)
    _make_ready(ctx)
    captured = []

    def fake_score(features, model_name=LEGACY_MODEL_NAME):
        captured.append((features["subject"], model_name))
        return 88.5

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fake_score)

    result = _predict(ctx, model_name=CORRECTED_MODEL_NAME)

    assert result["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert captured == [(canonical, CORRECTED_MODEL_NAME)]
    assert result["is_provisional"] is True
    assert result["validation_status"] == "PROVISIONAL"


@pytest.mark.parametrize("grade,code,name", [
    (9, "TLE9", "TLE 9"),
    (7, "FRENCH7", "French 7"),
    (8, "ROBOTICS8", "Robotics 8"),
    (10, "VALUES10", "Values Education 10"),
])
def test_unknown_valid_subjects_use_rf_unknown_category_provisional(current_period_context, monkeypatch, grade, code, name):
    ctx = current_period_context
    ctx["level"].grade_level = grade
    ctx["subject"].subject_codename = code
    ctx["subject"].subject_name = name
    ctx["db"].commit()
    _set_weights(ctx)
    _make_ready(ctx)
    captured = []

    def fake_score(features, model_name=LEGACY_MODEL_NAME):
        captured.append((features["subject"], model_name))
        return 83.0

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fake_score)

    result = _predict(ctx, model_name=CORRECTED_MODEL_NAME)

    assert result["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert captured == [(code, CORRECTED_MODEL_NAME)]
    assert result["is_provisional"] is True
    assert result["validation_status"] == "PROVISIONAL"


def test_empty_or_inactive_subject_still_blocks(current_period_context, monkeypatch):
    ctx = current_period_context
    ctx["level"].grade_level = 9
    ctx["subject"].subject_codename = ""
    ctx["subject"].subject_name = ""
    ctx["db"].commit()
    _set_weights(ctx)
    _make_ready(ctx)
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: pytest.fail("Scorer called"))

    result = _predict(ctx)

    assert result["status"] == service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN
    assert result["readiness_reason_codes"] == ["UNSUPPORTED_SUBJECT"]


def test_philosophy_subject_supported_as_provisional(current_period_context, monkeypatch):
    ctx = current_period_context
    ctx["level"].grade_level = 11
    ctx["subject"].subject_codename = "PHILOSOPHY"
    ctx["subject"].subject_name = "Introduction to the Philosophy of the Human Person"
    ctx["db"].commit()
    _set_weights(ctx)
    _make_ready(ctx)

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features, model_name=None: 86.0)

    result = _predict(ctx)

    assert result["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert result["is_provisional"] is True
    assert result["validation_status"] == "PROVISIONAL_UNVALIDATED_SHS"


@pytest.mark.parametrize("pred_score,expected_risk", [
    (74.9, "HIGH_RISK"),
    (75.1, "MODERATE_RISK"),
    (84.9, "MODERATE_RISK"),
    (85.1, "NEEDS_MONITORING"),
    (89.9, "NEEDS_MONITORING"),
    (90.1, "LOW_RISK"),
])
def test_predictions_near_risk_and_intervention_thresholds(current_period_context, monkeypatch, pred_score, expected_risk):
    ctx = current_period_context
    ctx["level"].grade_level = 7
    ctx["subject"].subject_codename = "ENMATH7"
    ctx["subject"].subject_name = "Enhanced Mathematics 7"
    ctx["db"].commit()
    _set_weights(ctx)
    _make_ready(ctx)

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features, model_name=LEGACY_MODEL_NAME: pred_score)

    result = service.predict_development_current_term(
        ctx["db"],
        ctx["student"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period"].academic_period_id,
        model_name=CORRECTED_MODEL_NAME,
    )

    from app.services.prediction import DevelopmentCurrentTermRiskService as intervention_service
    assessed = intervention_service.assess_development_current_term_intervention(result)
    assert assessed["intervention_level"] == expected_risk


@pytest.mark.parametrize("grade", [6, 13])
def test_out_of_scope_grade_rejected_before_feature_build_or_scoring(current_period_context, monkeypatch, grade):
    ctx = current_period_context
    ctx["level"].grade_level = grade
    ctx["db"].commit()
    monkeypatch.setattr(service, "build_current_period_features_from_records", lambda *_args, **_kwargs: pytest.fail("Feature builder called"))
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: pytest.fail("Scorer called"))

    result = _predict(ctx)

    assert result["status"] == service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN
    assert result["readiness_reason_codes"] == ["UNSUPPORTED_GRADE_SCOPE"]


@pytest.mark.parametrize("grade,code,name,canonical", [
    (11, "PRECAL11", "Precalculus", "MATHEMATICS"),
    (11, "BIO1", "General Biology 1", "SCIENCE"),
    (11, "GENMATH11", "General Mathematics", "MATHEMATICS"),
    (12, "PHYS1", "General Physics 1", "SCIENCE"),
    (12, "CHEM2", "General Chemistry 2", "SCIENCE"),
])
def test_shs_grade_scores_with_provisional_unvalidated_status(current_period_context, monkeypatch, grade, code, name, canonical):
    ctx = current_period_context
    ctx["level"].grade_level = grade
    ctx["subject"].subject_codename = code
    ctx["subject"].subject_name = name
    ctx["db"].commit()
    _set_weights(ctx)
    _make_ready(ctx)
    captured = []

    def fake_score(features, model_name=LEGACY_MODEL_NAME):
        captured.append((features["subject"], model_name))
        return 82.5

    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", fake_score)

    result = _predict(ctx, model_name=CORRECTED_MODEL_NAME)

    assert result["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert result["projected_final_term_grade"] == 82.5
    assert result["is_provisional"] is True
    assert result["validation_status"] == "PROVISIONAL_UNVALIDATED_SHS"
    assert captured == [(canonical, CORRECTED_MODEL_NAME)]


@pytest.mark.parametrize("grade,weights", [
    (11, (20, 50, 30)),
    (11, (20, 60, 20)),
    (12, (20, 50, 30)),
    (12, (20, 60, 20)),
])
def test_shs_supported_weight_patterns_accepted(current_period_context, monkeypatch, grade, weights):
    ctx = current_period_context
    ctx["level"].grade_level = grade
    ctx["subject"].subject_codename = "PRECAL11"
    ctx["subject"].subject_name = "Precalculus"
    ctx["db"].commit()
    _set_weights(ctx, ww=weights[0], pt=weights[1], qa=weights[2])
    _make_ready(ctx)
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features, model_name=LEGACY_MODEL_NAME: 88.0)

    result = _predict(ctx, model_name=CORRECTED_MODEL_NAME)

    assert result["status"] == service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    assert result["domain_result"]["supported"] is True


def test_shs_unsupported_weight_pattern_rejected(current_period_context, monkeypatch):
    ctx = current_period_context
    ctx["level"].grade_level = 11
    ctx["subject"].subject_codename = "PRECAL11"
    ctx["subject"].subject_name = "Precalculus"
    ctx["db"].commit()
    _set_weights(ctx, ww=20, pt=40, qa=40)
    _make_ready(ctx)
    add_activity(ctx, "QUARTERLY_ASSESSMENT", 32, 40)
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: pytest.fail("Scorer called"))

    result = _predict(ctx, model_name=CORRECTED_MODEL_NAME)

    assert result["status"] == service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN
    assert result["readiness_reason_codes"] == ["UNSUPPORTED_WEIGHT_PATTERN"]


def test_ids_cannot_bypass_student_class_grade_match(current_period_context, monkeypatch):
    ctx = current_period_context
    other_level = AcademicLevel(level_name="Grade 11", grade_level=11)
    ctx["db"].add(other_level)
    ctx["db"].flush()
    ctx["student"].academic_level_id = other_level.academic_level_id
    ctx["db"].commit()
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: pytest.fail("Scorer called"))

    result = _predict(ctx)

    assert result["readiness_reason_codes"] == ["MISMATCHED_GRADE_SCOPE"]
