from __future__ import annotations

from decimal import Decimal
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json

import pytest

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as service
from app.services.prediction.DevelopmentCurrentTermPredictionReadService import _academic_evidence
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DashboardPredictionService import get_dashboard_at_risk_predictions
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights


def _register_test_model(ctx, **overrides):
    schema = scorer.load_development_current_term_schema()
    digest = sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    row = AIModelVersion(
        model_name=scorer.MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="RandomForestRegressor",
        target_column="target_final_period_grade",
        lifecycle_status="DEVELOPMENT",
        production_validated=False,
        independent_three_term_validation=False,
        is_active=False,
        artifact_path="data/models/entervene_current_term_development_rf_v3.joblib",
        feature_schema_json=schema,
        registry_metadata_json={
            "supported_subjects": ["CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE"],
            "supported_weight_patterns": ["20/50/30", "20/60/20"],
            "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM",
            "feature_schema_sha256": digest,
            "feature_schema_version": f"sha256:{digest}",
            "artifact_sha256": sha256(scorer.MODEL_PATH.read_bytes()).hexdigest(),
            "training_dataset_version": "test-dataset-v1",
        },
        **overrides,
    )
    ctx["db"].add(row)
    ctx["db"].commit()
    return row.model_version_id


def _run(ctx, model_version_id, *, supporting_context=None, cutoff_at=None):
    student_id = ctx["student"].student_id
    class_id = ctx["class"].class_id
    subject_id = ctx["subject"].subject_id
    period_id = ctx["period"].academic_period_id
    bind = ctx["db"].get_bind()
    ctx["db"].commit()
    return service.generate_and_persist_development_current_term(
        student_id, class_id, subject_id, period_id,
        model_version_id=model_version_id,
        cutoff_at=cutoff_at,
        supporting_context=supporting_context,
        bind=bind,
    )


def test_append_only_revisions_snapshot_and_dashboard_isolation(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    model_version_id = _register_test_model(ctx)
    grades = iter([90.1234, 78.5678])
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features: next(grades))

    first = _run(ctx, model_version_id, supporting_context={
        "attendance_rate": 20,
        "behavioral_engagement_score": "Learner Secret",
    })
    first_row = ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"])
    original_snapshot = json.loads(json.dumps(first_row.evidence_snapshot))
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    second = _run(ctx, model_version_id)
    ctx["db"].expire_all()
    first_row = ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"])
    second_row = ctx["db"].get(DevelopmentCurrentTermPrediction, second["prediction_id"])

    assert (first["revision"], second["revision"]) == (1, 2)
    assert first_row.prediction_id != second_row.prediction_id
    assert first_row.evidence_snapshot == original_snapshot
    assert first_row.intervention_level == "LOW_RISK"
    assert second_row.intervention_level == "MODERATE_RISK"
    assert first_row.source_period_id == first_row.target_period_id
    assert first_row.model_version_id == model_version_id
    assert first_row.risk_score is None and second_row.risk_score is None
    assert first_row.intervention_basis == "RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE"
    assert first_row.predicted_period_grade == Decimal("90.12")
    assert original_snapshot["projected_final_term_grade_raw"] == 90.1234
    assert original_snapshot["snapshot_version"] == service.EVIDENCE_SNAPSHOT_VERSION
    assert original_snapshot["prediction_purpose"] == "CURRENT_TERM_FINAL_GRADE_PROJECTION"
    assert original_snapshot["readiness"]["status"] == "READY"
    assert original_snapshot["normalized_subject"] == "SCIENCE"
    assert original_snapshot["grading_weight_pattern"] == "20/50/30"
    assert original_snapshot["supporting_context"]["signals"] == {"attendance_rate": 20.0}
    assert original_snapshot["source_period_id"] == original_snapshot["target_period_id"]
    assert [x["name"] for x in original_snapshot["model_features"]] == scorer.required_feature_columns(scorer.load_development_current_term_schema())
    assert len(original_snapshot["model_features"]) == 31
    assert not any(term in json.dumps(original_snapshot).lower() for term in ("learner", "lrn", "email", "uploaded_file"))
    assert ctx["db"].query(AIPrediction).count() == 0
    assert get_dashboard_at_risk_predictions(ctx["db"])["items"] == []


def test_identical_academic_evidence_reuses_latest_revision(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    model_version_id = _register_test_model(ctx)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features: 84.6)

    first = _run(ctx, model_version_id)
    original_snapshot = json.loads(json.dumps(ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"]).evidence_snapshot))
    second = _run(ctx, model_version_id)

    assert second["persisted"] is False
    assert second["unchanged"] is True
    assert second["prediction_id"] == first["prediction_id"]
    assert second["revision"] == 1
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 1

    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    third = _run(ctx, model_version_id)
    assert third["persisted"] is True
    assert third["revision"] == 2
    assert ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"]).evidence_snapshot == original_snapshot


def test_partial_exam_change_creates_revision_without_changing_model_features(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    model_version_id = _register_test_model(ctx)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features: 84.6)

    first = _run(ctx, model_version_id)
    first_snapshot = json.loads(json.dumps(ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"]).evidence_snapshot))
    add_activity(ctx, "EXAMS", 24, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1")
    second = _run(ctx, model_version_id)
    second_snapshot = ctx["db"].get(DevelopmentCurrentTermPrediction, second["prediction_id"]).evidence_snapshot

    assert second["revision"] == 2
    assert first_snapshot["model_features"] == second_snapshot["model_features"]
    assert first_snapshot["examination_presentation"]["status"] == "NOT_STARTED"
    assert second_snapshot["examination_presentation"]["status"] == "PARTIAL"
    assert second_snapshot["examination_presentation"]["components"]["SUMMATIVE_1"] == 80.0


def test_saved_exam_presentation_does_not_reconstruct_future_grade(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    model_version_id = _register_test_model(ctx)
    cutoff = datetime(2026, 7, 1, tzinfo=timezone.utc)
    for category, score, total in (("WRITTEN_WORK", 8, 10), ("WRITTEN_WORK", 7, 10),
                                   ("PERFORMANCE_TASK", 18, 20), ("PERFORMANCE_TASK", 17, 20)):
        add_activity(ctx, category, score, total, graded_at=cutoff - timedelta(days=2))
    add_activity(ctx, "EXAMS", 27, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1", graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "EXAMS", 21, 30, title="Summative 2", classwork_type="EXAM", exam_subtype="SUMMATIVE_2", graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "EXAMS", 40, 40, title="Term Exam", classwork_type="EXAM", exam_subtype="TERM_EXAM", graded_at=cutoff + timedelta(days=1))
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features: 84.6)

    first = _run(ctx, model_version_id, cutoff_at=cutoff)
    old_snapshot = json.loads(json.dumps(ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"]).evidence_snapshot))
    second = _run(ctx, model_version_id, cutoff_at=cutoff + timedelta(days=2))
    new_snapshot = ctx["db"].get(DevelopmentCurrentTermPrediction, second["prediction_id"]).evidence_snapshot

    assert first["revision"] == 1 and second["revision"] == 2
    assert _academic_evidence(old_snapshot)["examination"]["presentation"] == {
        "status": "PARTIAL", "completed_count": 2,
        "components": {"SUMMATIVE_1": 90.0, "SUMMATIVE_2": 70.0, "TERM_EXAM": None},
    }
    assert _academic_evidence(old_snapshot)["examination"]["performance_percent"] is None
    assert _academic_evidence(new_snapshot)["examination"]["presentation"]["status"] == "COMPLETE"
    assert _academic_evidence(new_snapshot)["examination"]["performance_percent"] == 88.0
    assert ctx["db"].get(DevelopmentCurrentTermPrediction, first["prediction_id"]).evidence_snapshot == old_snapshot


def test_inactive_term_blocks_persistence_even_with_ready_evidence(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    model_version_id = _register_test_model(ctx)
    ctx["period"].is_active = False
    ctx["db"].commit()
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features: 84.6)

    result = _run(ctx, model_version_id)
    assert result["prediction_status"] == "PERIOD_NOT_ACTIVE"
    assert result["persisted"] is False
    assert result["reason_codes"] == ["PERIOD_NOT_ACTIVE"]
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0


@pytest.mark.parametrize("blocker", ["insufficient", "subject", "weight", "finalized"])
def test_blocked_results_are_not_persisted(current_period_context, monkeypatch, blocker):
    ctx = current_period_context
    _set_weights(ctx)
    model_version_id = _register_test_model(ctx)
    if blocker == "insufficient":
        add_activity(ctx, "WRITTEN_WORK", 8, 10)
        add_activity(ctx, "PERFORMANCE_TASK", 18, 20)
    else:
        _make_ready(ctx)
    if blocker == "subject":
        ctx["subject"].subject_codename = "PHILOSOPHY"
        ctx["db"].commit()
    elif blocker == "weight":
        _set_weights(ctx, "20", "40", "40")
        add_activity(ctx, "QUARTERLY_ASSESSMENT", 32, 40)
    elif blocker == "finalized":
        ctx["db"].add(StudentPeriodGrade(
            student_id=ctx["student"].student_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            final_period_grade=Decimal("92.00"),
            is_finalized=True,
        ))
        ctx["db"].commit()
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features: 88.0)

    result = _run(ctx, model_version_id)

    assert result["persisted"] is False
    assert result["intervention_level"] == "INTERVENTION_NOT_ASSESSED"
    assert result["prediction_status"] == {
        "insufficient": "INSUFFICIENT_EVIDENCE",
        "subject": "UNSUPPORTED_DEVELOPMENT_DOMAIN",
        "weight": "UNSUPPORTED_DEVELOPMENT_DOMAIN",
        "finalized": "FINALIZED_GRADE_EXISTS",
    }[blocker]
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0


def test_model_version_is_required_and_development_only(current_period_context):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    model_version_id = _register_test_model(ctx)
    with pytest.raises(ValueError, match="model_version_id is required"):
        _run(ctx, None)
    version = ctx["db"].get(AIModelVersion, model_version_id)
    version.lifecycle_status = "PRODUCTION"
    ctx["db"].commit()
    with pytest.raises(ValueError, match="inactive development V3 contract"):
        _run(ctx, model_version_id)
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0
