from __future__ import annotations

from pathlib import Path

import joblib
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.RiskThreshold import RiskThreshold
from app.services.ModelScoringService import (
    get_active_model_version,
    load_model_artifact,
    prepare_feature_row,
    predict_next_period_grade,
    resolve_artifact_path,
    score_student_prediction,
)


class FakeRegressor:
    def __init__(self, prediction: float = 86.42):
        self.prediction = prediction
        self.seen_columns = None

    def predict(self, frame):
        self.seen_columns = list(frame.columns)
        return [self.prediction]


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=[AIModelVersion.__table__, RiskThreshold.__table__])
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=[RiskThreshold.__table__, AIModelVersion.__table__])
        engine.dispose()


def feature_schema():
    return {
        "feature_columns": [
            "grade_level",
            "periodical_assessment_percent",
            "has_previous_period",
            "grade_trend_vs_previous_period",
            "source_period_grade",
            "assessment_completion_rate",
            "subject_SCIENCE",
        ],
        "target_column": "target_next_period_grade",
        "excluded_columns": ["student_id", "target_next_period_grade"],
        "column_mappings": {"quarterly_assessment_percent": "periodical_assessment_percent"},
        "required_runtime_columns": [
            "grade_level",
            "quarterly_assessment_percent",
            "has_previous_period",
            "grade_trend_vs_previous_period",
            "source_period_grade",
            "assessment_completion_rate",
            "subject_SCIENCE",
        ],
    }


def sample_input(**overrides):
    data = {
        "grade_level": 8,
        "quarterly_assessment_percent": 84.0,
        "has_previous_period": 1,
        "grade_trend_vs_previous_period": -2.0,
        "source_period_grade": 87.0,
        "assessment_completion_rate": 0.95,
        "data_coverage_ratio": 0.95,
        "missing_activity_count": 0,
        "late_submission_count": 0,
        "student_id": "SHOULD_NOT_BE_USED",
    }
    data.update(overrides)
    return data


def add_model_version(db, artifact_path: str, is_active: bool = True):
    version = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        algorithm="RandomForestRegressor",
        training_row_count=10,
        test_row_count=2,
        mae=1.0,
        rmse=2.0,
        r2_score=0.5,
        feature_schema_json=feature_schema(),
        artifact_path=artifact_path,
        is_active=is_active,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def test_active_model_lookup_succeeds_when_one_active_model_exists(db, tmp_path: Path):
    version = add_model_version(db, str(tmp_path / "model.joblib"))

    found = get_active_model_version(db)

    assert found.model_version_id == version.model_version_id


def test_active_model_lookup_fails_clearly_when_none_exists(db):
    with pytest.raises(LookupError, match="No active"):
        get_active_model_version(db)


def test_artifact_path_resolution_works_with_relative_paths(tmp_path: Path):
    resolved = resolve_artifact_path("data/models/model.joblib", base_dir=tmp_path)

    assert resolved == (tmp_path / "data" / "models" / "model.joblib").resolve()


def test_missing_artifact_path_fails_clearly(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="Model artifact"):
        load_model_artifact(str(tmp_path / "missing.joblib"))


def test_feature_row_preparation_follows_schema_order():
    frame, warnings = prepare_feature_row(sample_input(), feature_schema())

    assert list(frame.columns) == feature_schema()["feature_columns"]
    assert frame.iloc[0]["periodical_assessment_percent"] == 84.0
    assert warnings
    assert any("student_id" in warning for warning in warnings)


def test_quarterly_assessment_percent_maps_to_periodical():
    frame, _ = prepare_feature_row(sample_input(), feature_schema())

    assert "periodical_assessment_percent" in frame.columns
    assert frame.iloc[0]["periodical_assessment_percent"] == 84.0


def test_identity_and_student_id_are_not_included_in_model_features():
    frame, warnings = prepare_feature_row(
        sample_input(student_lrn="123456789012", learner_name="Synthetic Name"),
        feature_schema(),
    )

    assert "student_id" not in frame.columns
    assert "student_lrn" not in frame.columns
    assert any("student_lrn" in warning for warning in warnings)


def test_classifier_targets_are_ignored_for_model_scoring():
    frame, warnings = prepare_feature_row(
        sample_input(
            at_risk=1,
            final_result="Fail",
            date_unregistration=12,
            actual_failure_target_below_75=1,
        ),
        feature_schema(),
    )

    assert "at_risk" not in frame.columns
    assert "final_result" not in frame.columns
    assert "date_unregistration" not in frame.columns
    assert any("at_risk" in warning for warning in warnings)


def test_missing_subject_one_hot_columns_default_to_zero():
    frame, warnings = prepare_feature_row(sample_input(), feature_schema())

    assert frame.iloc[0]["subject_SCIENCE"] == 0
    assert any("subject_SCIENCE" in warning for warning in warnings)


def test_non_numeric_model_features_fail_clearly():
    with pytest.raises(ValueError, match="grade_level"):
        prepare_feature_row(sample_input(grade_level="eight"), feature_schema())


def test_prediction_returns_numeric_predicted_grade():
    model = FakeRegressor(88.75)
    frame, _ = prepare_feature_row(sample_input(subject_SCIENCE=1), feature_schema())

    prediction = predict_next_period_grade(model, frame)

    assert prediction == pytest.approx(88.75)


def test_score_student_prediction_returns_metadata_prediction_and_risk(db, tmp_path: Path):
    artifact_path = tmp_path / "model.joblib"
    joblib.dump(FakeRegressor(86.42), artifact_path)
    version = add_model_version(db, str(artifact_path))

    result = score_student_prediction(db, sample_input(subject_SCIENCE=1))

    assert result["model_version_id"] == version.model_version_id
    assert result["model_name"] == "entervene_next_period_grade_rf"
    assert result["predicted_period_grade"] == 86.42
    assert result["risk_level"] == "NEEDS_MONITORING"
    assert result["reasons"]
    assert result["recommended_action"]
    assert "subject_SCIENCE" in result["feature_columns_used"]


def test_runtime_only_risk_fields_are_allowed_but_not_model_features(db, tmp_path: Path):
    artifact_path = tmp_path / "model.joblib"
    joblib.dump(FakeRegressor(86.42), artifact_path)
    add_model_version(db, str(artifact_path))

    result = score_student_prediction(
        db,
        sample_input(subject_SCIENCE=1, missing_activity_count=2, late_submission_count=3),
    )

    assert "missing_activity_count" not in result["feature_columns_used"]
    assert "late_submission_count" not in result["feature_columns_used"]
    assert result["risk_level"] == "MODERATE_RISK"
    assert "two_or_more_missing_activities" in result["triggered_rules"]
