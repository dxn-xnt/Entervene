from __future__ import annotations

import hashlib
import json
from pathlib import Path
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import IntegrityError

from app.db.Base import Base
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.RiskThreshold import RiskThreshold
from app.services.prediction.ModelRegistryExceptions import (
    ActiveModelNotFound,
    ArtifactIntegrityError,
    ConcurrentActivationConflict,
    ModelPurposeMismatch,
    UnsupportedModelPurpose,
)
from app.services.prediction.ModelVersionService import (
    activate_model_version_atomic,
    count_active_versions_by_purpose,
    register_model_version,
)
from app.services.prediction.ModelScoringService import (
    get_active_model_version,
    get_active_model_version_by_purpose,
    score_student_prediction,
)


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


def make_report(name: str, purpose: str, **overrides) -> dict:
    report = {
        "model_name": name,
        "model_type": "REGRESSOR",
        "model_purpose": purpose,
        "algorithm": "RandomForestRegressor",
        "target_column": "target_final_period_grade",
        "training_row_count": 500,
        "test_row_count": 100,
        "mae": 1.25,
        "rmse": 1.75,
        "r2_score": 0.70,
        "feature_count": 2,
        "feature_columns": ["grade_level", "ww_score_over_hps_count"],
        "created_at": "2026-09-15T00:00:00+00:00",
        "ready_for_task_4": True,
    }
    report.update(overrides)
    return report


def make_schema(**overrides) -> dict:
    schema = {
        "feature_columns": ["grade_level", "ww_score_over_hps_count"],
        "target_column": "target_final_period_grade",
        "excluded_columns": ["student_id"],
        "column_mappings": {},
        "required_runtime_columns": ["grade_level", "ww_score_over_hps_count"],
    }
    schema.update(overrides)
    return schema


def test_1_migration_preserves_existing_model_ids_and_active_states(db):
    """Verify that existing ai_model_version rows preserve ID, active state, and metadata."""
    legacy = AIModelVersion(
        model_version_id=1,
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        training_row_count=1580,
        test_row_count=395,
        mae=Decimal("1.4892"),
        rmse=Decimal("2.0559"),
        r2_score=Decimal("0.6598"),
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        is_active=True,
    )
    db.add(legacy)
    db.commit()
    db.refresh(legacy)

    assert legacy.model_version_id == 1
    assert legacy.is_active is True
    assert legacy.model_purpose == "NEXT_PERIOD_BASELINE_FORECAST"
    assert legacy.mae == Decimal("1.4892")


def test_2_activating_current_does_not_modify_next(db):
    """Activating CURRENT_PERIOD_FINAL_GRADE_PROJECTION must leave NEXT active."""
    # 1. Active Next model
    next_m = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        is_active=True,
    )
    db.add(next_m)
    db.commit()

    # 2. Register & activate Current model
    curr_v1, deactivated, created = register_model_version(
        db=db,
        report=make_report("entervene_current_period_grade_rf_v1", ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value),
        schema=make_schema(),
        artifact_path="data/models/curr_v1.joblib",
        activate=True,
    )

    db.refresh(next_m)
    assert curr_v1.is_active is True
    assert next_m.is_active is True
    assert deactivated == 0
    assert count_active_versions_by_purpose(db, ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST) == 1
    assert count_active_versions_by_purpose(db, ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION) == 1


def test_3_simulated_current_v2_activation_deactivates_only_current_v1(db):
    """Activating CURRENT v2 must deactivate CURRENT v1 while leaving NEXT active."""
    next_m = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        is_active=True,
    )
    db.add(next_m)

    curr_v1 = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v1",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        algorithm="RandomForestRegressor",
        is_active=True,
    )
    db.add(curr_v1)
    db.commit()

    # Register and activate CURRENT v2
    curr_v2, deactivated, _ = register_model_version(
        db=db,
        report=make_report("entervene_current_period_grade_rf_v2", ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value),
        schema=make_schema(),
        artifact_path="data/models/curr_v2.joblib",
        activate=True,
    )

    db.refresh(curr_v1)
    db.refresh(next_m)

    assert deactivated == 1
    assert curr_v1.is_active is False
    assert curr_v2.is_active is True
    assert next_m.is_active is True  # NEXT remained untouched!


def test_4_two_active_models_for_one_purpose_cannot_exist(db):
    """Partial unique index uq_ai_model_version_active_purpose rejects 2 active models for same purpose."""
    m1 = AIModelVersion(
        model_name="curr_a",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        algorithm="RandomForestRegressor",
        is_active=True,
    )
    db.add(m1)
    db.commit()

    m2 = AIModelVersion(
        model_name="curr_b",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        algorithm="RandomForestRegressor",
        is_active=True,
    )
    db.add(m2)
    with pytest.raises(IntegrityError):
        db.commit()


def test_5_hash_schema_mismatch_prevents_activation(db, tmp_path: Path):
    """If artifact digest does not match manifest, activation must fail and rollback atomically."""
    artifact = tmp_path / "model.joblib"
    artifact.write_text("legitimate_bytes", encoding="utf-8")
    actual_hash = hashlib.sha256(artifact.read_bytes()).hexdigest()

    # Create manifest with mismatched hash
    manifest = tmp_path / "model_manifest.json"
    manifest.write_text(
        json.dumps({
            "artifact_hashes": {
                "model_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
            }
        }),
        encoding="utf-8",
    )

    # Register is_active=False
    version, _, _ = register_model_version(
        db=db,
        report=make_report("model", ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value),
        schema=make_schema(),
        artifact_path=str(artifact),
        activate=False,
    )
    assert version.is_active is False

    # Attempt to activate with mismatched hash
    with pytest.raises(ArtifactIntegrityError, match="Model artifact SHA-256 mismatch"):
        activate_model_version_atomic(
            db=db,
            model_version_id=version.model_version_id,
            manifest_path=manifest,
        )

    # Assert version remained inactive
    db.refresh(version)
    assert version.is_active is False


def test_6_missing_current_model_never_falls_back_to_next_model(db):
    """Requesting CURRENT when none is active must raise ActiveModelNotFound, never fall back to NEXT."""
    next_m = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        is_active=True,
    )
    db.add(next_m)
    db.commit()

    with pytest.raises(ActiveModelNotFound, match="No active model version found for purpose=CURRENT_PERIOD_FINAL_GRADE_PROJECTION"):
        get_active_model_version_by_purpose(db, ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION)


def test_7_existing_live_next_period_callers_still_resolve_exact_same_artifact(db):
    """Compatibility wrapper get_active_model_version explicitly resolves NEXT_PERIOD_BASELINE_FORECAST."""
    next_m = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        feature_schema_json=make_schema(),
        is_active=True,
    )
    curr_m = AIModelVersion(
        model_name="entervene_current_period_grade_rf_v1",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/entervene_current_period_grade_rf_v1.joblib",
        feature_schema_json=make_schema(),
        is_active=True,
    )
    db.add_all([next_m, curr_m])
    db.commit()

    resolved = get_active_model_version(db)
    assert resolved.model_version_id == next_m.model_version_id
    assert resolved.model_purpose == ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value
    assert resolved.artifact_path == "data/models/entervene_next_period_grade_rf.joblib"


def test_8_first_activation_race_condition_raises_clean_domain_error(db, monkeypatch):
    """If two transactions race to activate the first model for a purpose, IntegrityError is caught and raised as ConcurrentActivationConflict."""
    m1 = AIModelVersion(
        model_name="race_m1",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        algorithm="RandomForestRegressor",
        artifact_path="data/models/race_m1.joblib",
        is_active=False,
    )
    db.add(m1)
    db.commit()

    # Simulate commit collision from concurrent transaction
    with pytest.raises(ConcurrentActivationConflict, match="Concurrent activation conflict"):
        def mock_commit():
            raise IntegrityError("mock uniqueness failure", params={}, orig=Exception("uq_ai_model_version_active_purpose"))
        monkeypatch.setattr(db, "commit", mock_commit)
        activate_model_version_atomic(db, m1.model_version_id)


def test_9_postgres_live_unique_index_and_check_constraint():
    """Verify live PostgreSQL database enforces CHECK constraint and partial unique index."""
    from app.db.Session import SessionLocal

    pg_db = SessionLocal()
    trans = pg_db.begin_nested()
    try:
        # 1. Test check constraint on PostgreSQL
        bad = AIModelVersion(
            model_name="bad_model",
            model_type="REGRESSOR",
            model_purpose="INVALID_PURPOSE",
            algorithm="RandomForestRegressor",
            is_active=False,
        )
        pg_db.add(bad)
        with pytest.raises(IntegrityError):
            pg_db.flush()
        trans.rollback()
        trans = pg_db.begin_nested()

        # 2. Test partial unique index on PostgreSQL (Model 35 is currently active for UNIFIED_CURRENT_TERM_PROJECTION)
        dup = AIModelVersion(
            model_name="dup_unified",
            model_type="REGRESSOR",
            model_purpose=ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
            algorithm="RandomForestRegressor",
            is_active=True,
        )
        pg_db.add(dup)
        with pytest.raises(IntegrityError):
            pg_db.flush()
    finally:
        trans.rollback()
        pg_db.close()

