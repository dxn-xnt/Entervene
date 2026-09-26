"""Corrected prediction to Intervention candidate transaction contract."""

from decimal import Decimal
from datetime import datetime, timezone

import pytest

from app.core.Config import settings
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionCandidateService import sync_intervention_for_persisted_prediction
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persistence
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_development_current_term_model_4l import _register_corrected
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights


def _enable(monkeypatch, environment="test"):
    monkeypatch.setattr(settings, "app_environment", environment)
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)


def _setup(ctx, monkeypatch, grades):
    _enable(monkeypatch)
    _set_weights(ctx)
    _make_ready(ctx)
    model = _register_corrected(ctx)
    values = iter(grades)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: next(values))
    return model.model_version_id


def _interventions(ctx):
    ctx["db"].expire_all()
    return ctx["db"].query(Intervention).order_by(Intervention.intervention_id).all()


@pytest.mark.parametrize("grade,expected", [(84, 1), (74, 1), (84.999, 1), (85, 0), (88, 0)])
def test_boundary_creates_candidate_only_below_85(current_period_context, monkeypatch, grade, expected):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [grade])
    result = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert result["persisted"] is True
    assert len(rows) == expected
    if expected:
        assert rows[0].status == "CANDIDATE"
        assert rows[0].source_prediction_id == result["prediction_id"]
        assert (rows[0].student_id, rows[0].class_id, rows[0].subject_id, rows[0].academic_period_id) == (
            ctx["student"].student_id, ctx["class"].class_id,
            ctx["subject"].subject_id, ctx["period"].academic_period_id,
        )


def test_later_improvement_resolves_without_rewriting_trigger(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 88])
    first = _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    second = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert second["revision"] == 2
    assert len(rows) == 1
    assert rows[0].status == "RESOLVED"
    assert rows[0].source_prediction_id == first["prediction_id"]
    assert rows[0].resolution_reason == "IMPROVED_PREDICTION"
    assert rows[0].resolved_at is not None


def test_active_intervention_resolves_and_later_low_revision_gets_new_candidate(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 88, 74])
    first = _run(ctx, model_id)
    staff_id = ctx["staff"].staff_id
    active = _interventions(ctx)[0]
    active.status = "ACTIVE"
    active.activated_at = datetime.now(timezone.utc)
    active.activated_by_staff_id = staff_id
    ctx["db"].commit()
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    _run(ctx, model_id)
    assert _interventions(ctx)[0].status == "RESOLVED"
    add_activity(ctx, "WRITTEN_WORK", 6, 10)
    third = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert [row.status for row in rows] == ["RESOLVED", "CANDIDATE"]
    assert rows[0].source_prediction_id == first["prediction_id"]
    assert rows[1].source_prediction_id == third["prediction_id"]


def test_low_revision_and_unchanged_evidence_do_not_duplicate(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 84, 74])
    first = _run(ctx, model_id)
    same = _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    second = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert same["unchanged"] is True and second["revision"] == 2
    assert len(rows) == 1
    assert rows[0].status == "CANDIDATE"
    assert rows[0].source_prediction_id == first["prediction_id"]


def test_separate_subjects_have_separate_candidates(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 74])
    first_subject_id = ctx["subject"].subject_id
    first = _run(ctx, model_id)
    second_subject = Subject(
        subject_name="English", subject_codename="ENGLISH", academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add(second_subject)
    ctx["db"].flush()
    template = GradingTemplate(
        template_name="English 20-50-30", academic_level_id=ctx["level"].academic_level_id,
        subject_id=second_subject.subject_id, status="active",
    )
    ctx["db"].add(template)
    ctx["db"].flush()
    ctx["db"].add_all([
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name=name, weight=Decimal(weight), display_order=order)
        for order, (name, weight) in enumerate((
            ("Written Works", "20"), ("Performance Tasks", "50"), ("Quarterly Assessment", "30"),
        ), start=1)
    ])
    second_subject.default_grading_template = str(template.grading_template_id)
    ctx["db"].commit()
    ctx["subject"] = second_subject
    _make_ready(ctx)
    second = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert {row.source_prediction_id for row in rows} == {first["prediction_id"], second["prediction_id"]}
    assert {row.subject_id for row in rows} == {first_subject_id, second_subject.subject_id}


def test_stale_revision_and_scope_mismatch_are_rejected(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 88])
    first = _run(ctx, model_id)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    _run(ctx, model_id)
    source = ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"])
    scope = dict(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id, academic_period_id=ctx["period"].academic_period_id,
    )
    with pytest.raises(ValueError, match="not the latest"):
        sync_intervention_for_persisted_prediction(ctx["db"], source, **scope)
    with pytest.raises(ValueError, match="scope mismatch"):
        sync_intervention_for_persisted_prediction(ctx["db"], source, **{**scope, "subject_id": 999})
    assert _interventions(ctx)[0].status == "RESOLVED"


def test_ungrading_to_insufficient_does_not_resolve_or_duplicate(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84])
    first = _run(ctx, model_id)
    submissions = ctx["db"].query(StudentSubmission).all()
    for submission in submissions[1:]:
        submission.grade = None
    ctx["db"].commit()
    blocked = _run(ctx, model_id)
    rows = _interventions(ctx)
    assert blocked["persisted"] is False
    assert blocked["prediction_status"] == "INSUFFICIENT_EVIDENCE"
    assert len(rows) == 1 and rows[0].status == "CANDIDATE"
    assert rows[0].source_prediction_id == first["prediction_id"]


def test_prediction_failure_and_sync_failure_leave_no_half_transaction(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84])
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("scoring failed")))
    with pytest.raises(RuntimeError, match="scoring failed"):
        _run(ctx, model_id)
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0
    assert _interventions(ctx) == []
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 84)
    monkeypatch.setattr(persistence, "sync_intervention_for_persisted_prediction", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("sync failed")))
    with pytest.raises(RuntimeError, match="sync failed"):
        _run(ctx, model_id)
    ctx["db"].expire_all()
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0
    assert _interventions(ctx) == []


def test_production_does_not_synchronize_interventions(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84])
    _enable(monkeypatch, environment="production")
    result = _run(ctx, model_id)
    assert result["persisted"] is True
    assert _interventions(ctx) == []
