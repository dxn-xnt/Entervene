from __future__ import annotations

import pytest

from app.models.academic.AcademicLevel import AcademicLevel
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME, LEGACY_MODEL_NAME
from app.services.prediction import DevelopmentCurrentTermPredictionService as service
from tests.test_development_current_term_prediction_service import _make_ready, _predict, _set_weights
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


@pytest.mark.parametrize("code,name,reason", [
    ("TLE9", "TLE 9", "CLIENT_CONFIRMATION_REQUIRED"),
    ("SCIRES9", "Science Research", "UNSUPPORTED_SUBJECT"),
    ("MATH9_EXTRA", "Enhanced Mathematics 9", "UNSUPPORTED_SUBJECT"),
    ("MATH9", "Enhanced Mathematics 9", "MAPPING_UNVERIFIED"),
])
def test_unverified_and_fuzzy_names_cannot_score(current_period_context, monkeypatch, code, name, reason):
    ctx = current_period_context
    ctx["subject"].subject_codename = code
    ctx["subject"].subject_name = name
    ctx["db"].commit()
    _set_weights(ctx)
    _make_ready(ctx)
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: pytest.fail("Scorer called"))

    result = _predict(ctx)

    assert result["status"] == service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN
    assert result["readiness_reason_codes"] == [reason]


@pytest.mark.parametrize("grade", [11, 12])
def test_shs_grade_rejected_before_feature_build_or_scoring(current_period_context, monkeypatch, grade):
    ctx = current_period_context
    ctx["level"].grade_level = grade
    ctx["db"].commit()
    monkeypatch.setattr(service, "build_current_period_features_from_records", lambda *_args, **_kwargs: pytest.fail("Feature builder called"))
    monkeypatch.setattr(service.v3_scorer, "score_development_current_term", lambda _features: pytest.fail("Scorer called"))

    result = _predict(ctx)

    assert result["status"] == service.STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN
    assert result["readiness_reason_codes"] == ["UNSUPPORTED_GRADE_SCOPE"]


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
