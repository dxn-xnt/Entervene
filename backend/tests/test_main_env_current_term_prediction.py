from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.Config import settings
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DevelopmentCurrentTermModelResolver import (
    MODEL_REGISTRY_ENTRY_NOT_FOUND,
    SELECTED_MODEL_NOT_REFRESH_ELIGIBLE,
    SelectedModelResolutionError,
    resolve_selected_development_model,
)
from app.services.prediction.DevelopmentCurrentTermModelSelection import (
    CORRECTED_MODEL_NAME,
    LEGACY_MODEL_NAME,
)
from app.services.prediction.RegisterCorrectedCurrentTermModel import (
    register_corrected_development_model,
    require_isolated_demo_database,
)
from app.services.prediction.ScopedCurrentTermRegenerationService import (
    apply_scoped_current_term_regeneration,
    inspect_scoped_current_term_regeneration,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_development_current_term_prediction_persistence import _register_test_model
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights


class _DatabaseStub:
    def __init__(self, url: str):
        self._bind = SimpleNamespace(url=url)

    def get_bind(self):
        return self._bind


@pytest.mark.parametrize(
    ("url", "environment", "opt_in"),
    [
        ("postgresql://local@remote.example/Entervene", "development", True),
        ("postgresql://local@localhost/OtherDatabase", "development", True),
        ("postgresql://local@localhost/Entervene", "production", True),
        ("postgresql://local@localhost/Entervene", "development", False),
    ],
)
def test_main_registration_rejects_unapproved_environment(monkeypatch, url, environment, opt_in):
    monkeypatch.setattr(settings, "app_environment", environment)
    monkeypatch.setattr(settings, "allow_local_corrected_prediction_model", opt_in)
    with pytest.raises(ValueError, match="approved local development database"):
        require_isolated_demo_database(_DatabaseStub(url))


def test_main_registration_accepts_exact_local_opt_in(monkeypatch):
    monkeypatch.setattr(settings, "app_environment", "development")
    monkeypatch.setattr(settings, "allow_local_corrected_prediction_model", True)
    require_isolated_demo_database(_DatabaseStub("postgresql://local@127.0.0.1/Entervene"))


def test_corrected_registration_is_idempotent(current_period_context, monkeypatch):
    ctx = current_period_context
    monkeypatch.setattr(
        "app.services.prediction.RegisterCorrectedCurrentTermModel.require_isolated_demo_database",
        lambda _db: None,
    )
    first, created = register_corrected_development_model(ctx["db"])
    ctx["db"].commit()
    second, created_again = register_corrected_development_model(ctx["db"])

    assert created is True
    assert created_again is False
    assert first.model_version_id == second.model_version_id


def test_selected_resolver_rejects_legacy_and_missing_corrected(current_period_context, monkeypatch):
    ctx = current_period_context
    monkeypatch.setattr(settings, "app_environment", "test")
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", LEGACY_MODEL_NAME)
    with pytest.raises(SelectedModelResolutionError) as legacy_error:
        resolve_selected_development_model(ctx["db"])
    assert legacy_error.value.reason_code == SELECTED_MODEL_NOT_REFRESH_ELIGIBLE

    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)
    with pytest.raises(SelectedModelResolutionError) as missing_error:
        resolve_selected_development_model(ctx["db"])
    assert missing_error.value.reason_code == MODEL_REGISTRY_ENTRY_NOT_FOUND


def test_selected_resolver_rejects_duplicate_corrected_rows(current_period_context, monkeypatch):
    ctx = current_period_context
    _register_test_model(ctx, model_name=CORRECTED_MODEL_NAME)
    _register_test_model(ctx, model_name=CORRECTED_MODEL_NAME)
    monkeypatch.setattr(settings, "app_environment", "test")
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)

    with pytest.raises(SelectedModelResolutionError) as duplicate_error:
        resolve_selected_development_model(ctx["db"])

    assert duplicate_error.value.reason_code == "DUPLICATE_MODEL_REGISTRY_ENTRY"


def test_scoped_dry_run_is_read_only_and_apply_affects_one_scope(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    model_version_id = _register_test_model(ctx, model_name=CORRECTED_MODEL_NAME)
    monkeypatch.setattr(settings, "app_environment", "test")
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=CORRECTED_MODEL_NAME: 82.5)

    scope = {
        "student_id": ctx["student"].student_id,
        "class_id": ctx["class"].class_id,
        "subject_id": ctx["subject"].subject_id,
        "period_id": ctx["period"].academic_period_id,
    }
    dry_run = inspect_scoped_current_term_regeneration(ctx["db"], **scope)
    assert dry_run["mode"] == "DRY_RUN"
    assert dry_run["would_persist"] is True
    assert dry_run["model_version_id"] == model_version_id
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0

    applied = apply_scoped_current_term_regeneration(
        ctx["db"],
        **scope,
        bind=ctx["db"].get_bind(),
    )
    assert applied["persisted"] is True
    assert applied["revision"] == 1
    rows = ctx["db"].query(DevelopmentCurrentTermPrediction).all()
    assert len(rows) == 1
    assert rows[0].student_id == ctx["student"].student_id
