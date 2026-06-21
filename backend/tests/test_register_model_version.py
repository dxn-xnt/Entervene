from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.ai.AIModelVersion import AIModelVersion
from app.services.ModelVersionService import (
    count_active_versions,
    load_feature_schema,
    load_training_report,
    normalize_artifact_path,
    register_model_version,
    validate_artifact_path,
    validate_feature_schema,
    validate_training_report,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=[AIModelVersion.__table__])
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=[AIModelVersion.__table__])
        engine.dispose()


def valid_report(**overrides):
    report = {
        "model_name": "entervene_next_period_grade_rf",
        "model_type": "REGRESSOR",
        "algorithm": "RandomForestRegressor",
        "target_column": "target_next_period_grade",
        "training_row_count": 938,
        "test_row_count": 231,
        "mae": 1.4396,
        "rmse": 2.0984,
        "r2_score": 0.6227,
        "feature_count": 2,
        "feature_columns": ["grade_level", "periodical_assessment_percent"],
        "created_at": "2026-06-21T13:52:38.285103+00:00",
        "ready_for_task_4": True,
    }
    report.update(overrides)
    return report


def valid_schema(**overrides):
    schema = {
        "feature_columns": ["grade_level", "periodical_assessment_percent"],
        "target_column": "target_next_period_grade",
        "excluded_columns": ["student_id", "target_next_period_grade"],
        "column_mappings": {"quarterly_assessment_percent": "periodical_assessment_percent"},
        "required_runtime_columns": ["grade_level", "quarterly_assessment_percent"],
    }
    schema.update(overrides)
    return schema


def test_training_report_validation_passes_for_valid_report():
    validate_training_report(valid_report())


def test_training_report_validation_fails_if_not_ready():
    with pytest.raises(ValueError, match="not ready"):
        validate_training_report(valid_report(ready_for_task_4=False))


def test_training_report_validation_fails_for_classifier():
    with pytest.raises(ValueError, match="REGRESSOR"):
        validate_training_report(valid_report(model_type="CLASSIFIER"))


def test_feature_schema_validation_catches_missing_feature_columns():
    schema = valid_schema()
    del schema["feature_columns"]

    with pytest.raises(ValueError, match="feature_columns"):
        validate_feature_schema(schema)


def test_artifact_path_validation_catches_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        validate_artifact_path(tmp_path / "missing.joblib")


def test_load_json_helpers(tmp_path: Path):
    report_path = tmp_path / "report.json"
    schema_path = tmp_path / "schema.json"
    report_path.write_text(json.dumps(valid_report()), encoding="utf-8")
    schema_path.write_text(json.dumps(valid_schema()), encoding="utf-8")

    assert load_training_report(report_path)["model_type"] == "REGRESSOR"
    assert load_feature_schema(schema_path)["target_column"] == "target_next_period_grade"


def test_registering_model_version_inserts_db_row(db):
    version, deactivated_count, created = register_model_version(
        db=db,
        report=valid_report(),
        schema=valid_schema(),
        artifact_path="data/models/model.joblib",
        activate=False,
    )

    assert created is True
    assert deactivated_count == 0
    assert version.model_version_id is not None
    assert version.model_name == "entervene_next_period_grade_rf"
    assert version.is_active is False
    assert db.query(AIModelVersion).count() == 1


def test_registering_with_activate_deactivates_previous_active_versions(db):
    first, _, _ = register_model_version(
        db=db,
        report=valid_report(),
        schema=valid_schema(),
        artifact_path="data/models/old.joblib",
        activate=True,
    )
    second_report = valid_report(created_at="2026-06-22T13:52:38+00:00")
    second, deactivated_count, _ = register_model_version(
        db=db,
        report=second_report,
        schema=valid_schema(),
        artifact_path="data/models/new.joblib",
        activate=True,
    )

    db.refresh(first)
    assert deactivated_count == 1
    assert first.is_active is False
    assert second.is_active is True
    assert count_active_versions(db, "entervene_next_period_grade_rf", "REGRESSOR") == 1


def test_same_artifact_path_reuses_existing_row_instead_of_duplicate(db):
    first, _, created_first = register_model_version(
        db=db,
        report=valid_report(mae=1.0),
        schema=valid_schema(),
        artifact_path="data/models/model.joblib",
        activate=True,
    )
    second, _, created_second = register_model_version(
        db=db,
        report=valid_report(mae=2.0),
        schema=valid_schema(),
        artifact_path="data/models/model.joblib",
        activate=True,
    )

    assert created_first is True
    assert created_second is False
    assert first.model_version_id == second.model_version_id
    assert db.query(AIModelVersion).count() == 1
    assert count_active_versions(db, "entervene_next_period_grade_rf", "REGRESSOR") == 1
    assert float(second.mae) == pytest.approx(2.0)


def test_normalize_artifact_path_returns_relative_posix_path(tmp_path: Path):
    artifact = tmp_path / "data" / "models" / "model.joblib"
    artifact.parent.mkdir(parents=True)
    artifact.write_text("model", encoding="utf-8")

    assert normalize_artifact_path(artifact, base_dir=tmp_path) == "data/models/model.joblib"
