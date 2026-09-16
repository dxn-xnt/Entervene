import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.ml import ExportUnifiedV2RuntimeArtifact as export_unified
from app.ml import RunUnifiedDevelopmentExperiment as devexp
from app.models.ai.AIModelVersion import ModelPurpose
from app.models.ai.AIPrediction import RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED
from app.services.prediction.ModelVersionService import resolve_model_purpose
from app.services.prediction.PredictionPersistenceService import (
    PredictionRiskContractError,
    validate_prediction_risk_contract,
)


MODEL_DIR = Path("data/models")
ARTIFACT_PATH = MODEL_DIR / "unified_current_term_projection_v2.joblib"
SCHEMA_PATH = MODEL_DIR / "unified_current_term_projection_v2_feature_schema.json"
REPORT_PATH = MODEL_DIR / "unified_current_term_projection_v2_training_report.json"
MANIFEST_PATH = MODEL_DIR / "unified_current_term_projection_v2_manifest.json"


def test_unified_v2_artifact_and_schema_are_exact_runtime_contract():
    artifact = joblib.load(ARTIFACT_PATH)
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    expected_features = export_unified.unified_v2_features()

    assert artifact["model_purpose"] == ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value
    assert schema["model_purpose"] == ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value
    assert report["model_purpose"] == ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value
    assert artifact["development_status"] == "DEVELOPMENT_PROMISING"
    assert artifact["independent_3term_validation"] is False

    assert artifact["raw_feature_columns"] == expected_features
    assert schema["feature_columns"] == expected_features
    assert schema["raw_feature_count"] == 34
    assert report["feature_count"] == 34
    assert manifest["training_rows_used"] == devexp.EXPECTED_DEV_ROWS
    assert manifest["old_frozen_rows_excluded"] == devexp.EXPECTED_FROZEN_ROWS

    assert "current_period_progress_ratio" in expected_features
    assert "previous_term_available" in expected_features
    assert "previous_term_final_grade" in expected_features
    assert "subject" in expected_features
    assert devexp.TARGET_COLUMN not in expected_features
    assert not (set(expected_features) & devexp.METADATA_COLUMNS)

    assert schema["supported_subjects"] == [
        "CREATIVE_TECHNOLOGY",
        "ELECTRONICS",
        "ENGLISH",
        "ICT",
        "MATHEMATICS",
        "SCIENCE",
        "VALUES_EDUCATION",
    ]
    assert schema["unsupported_subjects"] == ["MAPEH", "ADVANCED_PHYSICS"]


def test_unified_v2_loaded_artifact_scores_deterministically_without_frozen_rows():
    artifact = joblib.load(ARTIFACT_PATH)
    features = artifact["raw_feature_columns"]
    df = pd.read_csv(devexp.DATASET_PATH)
    df["current_period_progress_ratio"] = (df["historical_period_sequence"].astype(float) / 4.0).round(6)
    frozen_mask = df["cohort_group_key"].isin(devexp.FROZEN_TEST_COHORTS)
    development = df.loc[~frozen_mask].copy()

    assert len(development) == devexp.EXPECTED_DEV_ROWS
    assert len(df.loc[frozen_mask]) == devexp.EXPECTED_FROZEN_ROWS
    assert set(development["raw_student_key"]) & set(df.loc[frozen_mask, "raw_student_key"]) == set()

    sample = development.iloc[[0]][features]
    prediction_a = artifact["pipeline"].predict(sample)
    prediction_b = artifact["pipeline"].predict(sample)

    assert np.allclose(prediction_a, prediction_b, rtol=0.0, atol=1e-12)
    assert np.isfinite(prediction_a).all()


def test_unified_model_purpose_resolves_from_name():
    assert (
        resolve_model_purpose({"model_name": "unified_current_term_projection_v2"})
        == ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value
    )


def test_unified_prediction_persistence_contract_allows_academic_estimate_without_risk():
    validate_prediction_risk_contract(
        model_purpose=ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
        risk_level=None,
        risk_score=None,
        data_status=None,
    )


def test_unified_prediction_persistence_contract_rejects_fabricated_risk():
    with np.testing.assert_raises(PredictionRiskContractError):
        validate_prediction_risk_contract(
            model_purpose=ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION,
            risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
            risk_level="LOW_RISK",
            risk_score=0,
            data_status="SUFFICIENT",
        )

