from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest

from app.services.prediction.DevelopmentCurrentTermScoringService import (
    MODEL_PATH,
    SCHEMA_PATH,
    compare_feature_contract,
    load_development_current_term_schema,
    prepare_development_current_term_frame,
    required_feature_columns,
    score_development_current_term,
)
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_current_period_features_from_records,
)
from tests.test_current_period_live_feature_builder import add_activity, current_period_context


DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "datasets" / "current_term_development" / "current_term_development_snapshots.csv"


def test_current_period_builder_matches_v3_feature_contract(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "WRITTEN_WORK", 7, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 18, 20)
    add_activity(ctx, "PERFORMANCE_TASK", 17, 20)
    add_activity(ctx, "QUARTERLY_ASSESSMENT", 32, 40)

    result = build_current_period_features_from_records(
        ctx["db"],
        ctx["student"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period"].academic_period_id,
    )
    contract = compare_feature_contract(result["features"])

    assert contract["missing_features"] == []
    assert contract["unexpected_features"] == []
    assert contract["categorical_fields"] == ["subject"]
    assert contract["type_mismatches"] == []


def test_v3_development_artifact_loads():
    assert MODEL_PATH.exists()
    assert SCHEMA_PATH.exists()
    artifact = joblib.load(MODEL_PATH)
    assert hasattr(artifact["pipeline"], "predict")


def _test_rows() -> list[dict]:
    schema = load_development_current_term_schema()
    features = required_feature_columns(schema)
    df = pd.read_csv(DATASET_PATH)
    test_df = df[df["split"] == "test"]
    selected = [
        test_df[test_df["subject"] == "MATHEMATICS"].iloc[0],
        test_df[test_df["subject"] == "SCIENCE"].iloc[0],
        test_df[test_df["weight_pattern"] == "20/60/20"].iloc[0],
    ]
    return [row[features].to_dict() for row in selected]


def test_development_prediction_succeeds_and_matches_direct_artifact():
    artifact = joblib.load(MODEL_PATH)
    pipeline = artifact["pipeline"]
    schema = load_development_current_term_schema()

    for features in _test_rows():
        scorer_prediction = score_development_current_term(features)
        direct_frame = pd.DataFrame([features], columns=required_feature_columns(schema))
        direct_prediction = float(pipeline.predict(direct_frame)[0])

        assert np.isfinite(scorer_prediction)
        assert 0.0 <= scorer_prediction <= 100.0
        assert scorer_prediction == pytest.approx(direct_prediction)


def test_development_scorer_rejects_leakage_and_invalid_inputs():
    features = _test_rows()[0]

    missing = dict(features)
    missing.pop("overall_partial_percent")
    with pytest.raises(ValueError, match="Missing development current-term features"):
        prepare_development_current_term_frame(missing)

    with_target = dict(features)
    with_target["target_final_period_grade"] = 99
    with pytest.raises(ValueError, match="Forbidden leakage fields"):
        prepare_development_current_term_frame(with_target)

    with_identity = dict(features)
    with_identity["student_id"] = "S-1"
    with pytest.raises(ValueError, match="Forbidden leakage fields"):
        prepare_development_current_term_frame(with_identity)

    bad_numeric = dict(features)
    bad_numeric["overall_partial_percent"] = "not-a-number"
    with pytest.raises(ValueError, match="Invalid development current-term feature types"):
        prepare_development_current_term_frame(bad_numeric)
