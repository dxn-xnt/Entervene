"""Reconcile only a still-current, latest corrected development prediction."""

from copy import deepcopy

import pytest

from app.core.Config import settings
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionReconciliationService import reconcile_existing_candidate
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persistence
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_intervention_candidate_sync import _setup


def _enroll(ctx):
    ctx["db"].add(StudentClass(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled",
    ))
    ctx["db"].commit()


def _remove_candidate(ctx):
    db = ctx["db"]
    for candidate in db.query(Intervention).all():
        db.delete(candidate)
    db.commit()


def test_existing_low_prediction_reconciles_once_without_new_revision(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [84])
    original = _run(ctx, model_id)
    _remove_candidate(ctx)
    before = ctx["db"].query(DevelopmentCurrentTermPrediction).count()
    assert reconcile_existing_candidate(ctx["db"], original["prediction_id"]) == "would_create"
    assert ctx["db"].query(Intervention).count() == 0
    assert reconcile_existing_candidate(ctx["db"], original["prediction_id"], apply=True) == "created"
    ctx["db"].commit()
    assert reconcile_existing_candidate(ctx["db"], original["prediction_id"], apply=True) == "already_open"
    rows = ctx["db"].query(Intervention).all()
    assert len(rows) == 1 and rows[0].source_prediction_id == original["prediction_id"]
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == before


def test_unchanged_reused_prediction_repairs_missing_candidate(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [84, 84])
    original = _run(ctx, model_id)
    _remove_candidate(ctx)
    again = _run(ctx, model_id)
    assert again["unchanged"] is True and again["prediction_id"] == original["prediction_id"]
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 1
    assert ctx["db"].query(Intervention).filter_by(source_prediction_id=original["prediction_id"]).count() == 1


def test_unchanged_reused_high_prediction_resolves_open_candidate(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [84, 88, 88])
    _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    original_sync = persistence.sync_intervention_for_persisted_prediction
    monkeypatch.setattr(persistence, "sync_intervention_for_persisted_prediction", lambda *_args, **_kwargs: None)
    high = _run(ctx, model_id)
    assert ctx["db"].query(Intervention).one().status == "CANDIDATE"
    monkeypatch.setattr(persistence, "sync_intervention_for_persisted_prediction", original_sync)
    reused = _run(ctx, model_id)
    assert reused["unchanged"] is True and reused["prediction_id"] == high["prediction_id"]
    intervention = ctx["db"].query(Intervention).one()
    assert intervention.status == "RESOLVED" and intervention.resolution_reason == "IMPROVED_PREDICTION"


def test_high_grade_without_open_intervention_is_skipped(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [88])
    result = _run(ctx, model_id)
    assert reconcile_existing_candidate(ctx["db"], result["prediction_id"], apply=True) == "not_candidate_grade"
    assert ctx["db"].query(Intervention).count() == 0


def test_stale_low_revision_is_skipped(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [84, 74])
    first = _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    latest = _run(ctx, model_id)
    _remove_candidate(ctx)
    assert reconcile_existing_candidate(ctx["db"], first["prediction_id"], apply=True) == "stale_revision"
    assert reconcile_existing_candidate(ctx["db"], latest["prediction_id"]) == "would_create"
    assert ctx["db"].query(Intervention).count() == 0


def test_historical_inactive_period_is_skipped(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [84])
    result = _run(ctx, model_id)
    _remove_candidate(ctx)
    ctx["period"].is_active = False
    ctx["db"].commit()
    assert reconcile_existing_candidate(ctx["db"], result["prediction_id"], apply=True) == "inactive_period"
    assert ctx["db"].query(Intervention).count() == 0


def test_saved_insufficient_snapshot_is_skipped(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [84])
    result = _run(ctx, model_id)
    _remove_candidate(ctx)
    row = ctx["db"].get(DevelopmentCurrentTermPrediction, result["prediction_id"])
    snapshot = deepcopy(row.evidence_snapshot)
    snapshot["readiness"]["status"] = "INSUFFICIENT_EVIDENCE"
    row.evidence_snapshot = snapshot
    ctx["db"].commit()
    assert reconcile_existing_candidate(ctx["db"], result["prediction_id"], apply=True) == "not_ready"


def test_live_ungrading_and_changed_evidence_are_skipped(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [84])
    result = _run(ctx, model_id)
    _remove_candidate(ctx)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    assert reconcile_existing_candidate(ctx["db"], result["prediction_id"], apply=True) == "changed_evidence"
    for submission in ctx["db"].query(StudentSubmission).all()[1:]:
        submission.grade = None
    ctx["db"].commit()
    assert reconcile_existing_candidate(ctx["db"], result["prediction_id"], apply=True) == "not_ready"
    assert ctx["db"].query(Intervention).count() == 0


def test_production_setting_cannot_reconcile(current_period_context, monkeypatch):
    ctx = current_period_context
    _enroll(ctx)
    model_id = _setup(ctx, monkeypatch, [84])
    result = _run(ctx, model_id)
    _remove_candidate(ctx)
    monkeypatch.setattr(settings, "app_environment", "production")
    with pytest.raises(ValueError, match="development-only"):
        reconcile_existing_candidate(ctx["db"], result["prediction_id"], apply=True)
    assert ctx["db"].query(Intervention).count() == 0
