from __future__ import annotations

import json
import math
from hashlib import sha256

import pytest

from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persistence
from app.services.prediction.DevelopmentCurrentTermModelSelection import (
    CORRECTED_MODEL_NAME, LEGACY_MODEL_NAME, artifact_path,
    require_development_model_name, selected_development_model_name,
)
from app.services.prediction.DevelopmentCurrentTermPredictionReadService import list_latest_development_current_term_predictions
from app.services.prediction.RegisterCorrectedCurrentTermModel import verified_corrected_package
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights
from tests.test_development_current_term_prediction_persistence import _register_test_model, _run


def _register_corrected(ctx):
    schema, _report, artifact_digest, schema_digest = verified_corrected_package()
    row = AIModelVersion(
        model_name=CORRECTED_MODEL_NAME, model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION", algorithm="RandomForestRegressor",
        target_column="target_final_period_grade", lifecycle_status="DEVELOPMENT",
        production_validated=False, independent_three_term_validation=False, is_active=False,
        artifact_path=f"data/models/{CORRECTED_MODEL_NAME}.joblib", feature_schema_json=schema,
        registry_metadata_json={
            "supported_subjects": ["CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE"],
            "supported_weight_patterns": ["20/50/30", "20/60/20"],
            "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM",
            "feature_schema_sha256": schema_digest,
            "feature_schema_version": f"sha256:{schema_digest}",
            "artifact_sha256": artifact_digest,
            "training_dataset_version": f"sha256:{schema['dataset_sha256']}",
        },
    )
    ctx["db"].add(row)
    ctx["db"].commit()
    return row


def test_corrected_package_and_selector(monkeypatch):
    schema, report, artifact_digest, schema_digest = verified_corrected_package()
    assert len(schema["feature_columns"]) == 31
    assert report["artifact"]["sha256"] == artifact_digest
    assert schema_digest == sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert require_development_model_name(CORRECTED_MODEL_NAME) == CORRECTED_MODEL_NAME
    with pytest.raises(ValueError, match="Unknown"):
        require_development_model_name("unapproved")
    from app.services.prediction import DevelopmentCurrentTermModelSelection as selection
    monkeypatch.setattr(selection.settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)
    assert selected_development_model_name() == CORRECTED_MODEL_NAME
    monkeypatch.setattr(selection.settings, "development_current_term_model_name", LEGACY_MODEL_NAME)
    assert selected_development_model_name() == LEGACY_MODEL_NAME


def test_separate_histories_and_fail_closed_registry(current_period_context):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    legacy_id = _register_test_model(ctx)
    corrected = _register_corrected(ctx)
    legacy = _run(ctx, legacy_id)
    first = _run(ctx, corrected.model_version_id)
    same = _run(ctx, corrected.model_version_id)
    assert legacy["revision"] == first["revision"] == same["revision"] == 1
    assert legacy["model_version_id"] != first["model_version_id"]
    assert first["persisted"] is True and same["unchanged"] is True
    assert math.isfinite(first["projected_final_term_grade"])
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    second = _run(ctx, corrected.model_version_id)
    assert second["revision"] == 2
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).filter_by(model_version_id=legacy_id).count() == 1
    scope = dict(class_id=ctx["class"].class_id, subject_id=ctx["subject"].subject_id,
                 academic_period_id=ctx["period"].academic_period_id)
    assert list_latest_development_current_term_predictions(ctx["db"], **scope, model_version_id=corrected.model_version_id)["total"] == 1
    assert list_latest_development_current_term_predictions(ctx["db"], **scope, model_version_id=legacy_id)["total"] == 1
    metadata = dict(corrected.registry_metadata_json)
    metadata["artifact_sha256"] = "0" * 64
    corrected.registry_metadata_json = metadata
    ctx["db"].commit()
    with pytest.raises(ValueError, match="artifact hash"):
        _run(ctx, corrected.model_version_id)
    metadata["artifact_sha256"] = sha256(artifact_path(CORRECTED_MODEL_NAME).read_bytes()).hexdigest()
    metadata["feature_schema_sha256"] = "0" * 64
    corrected.registry_metadata_json = dict(metadata)
    ctx["db"].commit()
    with pytest.raises(ValueError, match="feature schema"):
        _run(ctx, corrected.model_version_id)
    metadata["feature_schema_sha256"] = sha256(json.dumps(corrected.feature_schema_json, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    corrected.registry_metadata_json = dict(metadata)
    corrected.model_purpose = "NEXT_PERIOD_BASELINE_FORECAST"
    ctx["db"].commit()
    with pytest.raises(ValueError, match="inactive development"):
        _run(ctx, corrected.model_version_id)


def test_corrected_artifact_load_failure(monkeypatch):
    schema = scorer.load_development_current_term_schema(CORRECTED_MODEL_NAME)
    features = {name: 0 for name in schema["feature_columns"]}
    features["subject"] = "MATHEMATICS"
    def broken(_path):
        raise OSError("load failure")
    monkeypatch.setattr(scorer.joblib, "load", broken)
    with pytest.raises(OSError, match="load failure"):
        scorer.score_development_current_term(features, CORRECTED_MODEL_NAME)


def test_corrected_feature_order_rejected(monkeypatch):
    schema = scorer.load_development_current_term_schema(CORRECTED_MODEL_NAME)
    features = {name: 0 for name in schema["feature_columns"]}
    features["subject"] = "MATHEMATICS"
    reordered = dict(schema)
    reordered["feature_columns"] = list(reversed(schema["feature_columns"]))
    original = scorer.load_development_current_term_schema
    monkeypatch.setattr(scorer, "load_development_current_term_schema", lambda _name=CORRECTED_MODEL_NAME: reordered)
    with pytest.raises(ValueError, match="metadata"):
        scorer.score_development_current_term(features, CORRECTED_MODEL_NAME)
    monkeypatch.setattr(scorer, "load_development_current_term_schema", original)
