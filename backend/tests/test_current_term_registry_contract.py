from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import CheckConstraint, create_engine, inspect
from sqlalchemy.orm import Session

from app.db.Base import Base
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction
from app.services.prediction.ModelVersionService import (
    get_production_model_versions,
    get_model_versions,
    normalize_feature_schema,
    normalize_training_report,
    register_model_version,
    validate_feature_schema,
    validate_training_report,
)


MODELS_DIR = Path(__file__).resolve().parents[1] / "data" / "models"


def test_development_registry_is_inactive_and_unvalidated():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[AIModelVersion.__table__])
    with Session(engine) as db:
        version = AIModelVersion(
            model_name="test_current_term_development",
            model_type="REGRESSOR",
            model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
            algorithm="RandomForestRegressor",
            target_column="target_final_period_grade",
            lifecycle_status="DEVELOPMENT",
            production_validated=False,
            independent_three_term_validation=False,
            is_active=False,
        )
        db.add(version)
        db.commit()
        found = get_model_versions(db, purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION, lifecycle_status="DEVELOPMENT", is_active=False)
        assert found == [version]
        assert found[0].production_validated is False
        assert found[0].independent_three_term_validation is False

        version.is_active = True
        db.commit()
        assert version.lifecycle_status == "DEVELOPMENT"
        assert version.production_validated is False
    engine.dispose()


def test_prediction_orm_represents_legacy_and_current_term_contracts():
    columns = AIPrediction.__table__.c
    assert columns.risk_score.nullable is True
    assert columns.risk_level.nullable is True
    assert columns.intervention_level.nullable is True
    assert columns.intervention_basis.nullable is True
    assert columns.revision.nullable is False
    assert columns.risk_assessment_status.nullable is False
    assert columns.model_version_id.nullable is True
    assert not any(
        "source_period_id != target_period_id" in str(constraint.sqltext)
        for constraint in AIPrediction.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    )

    period_id = 4
    prediction = AIPrediction(
        student_id=uuid4(), class_id=2, subject_id=3,
        source_period_id=period_id, target_period_id=period_id,
        model_version_id=1, predicted_period_grade=90,
        intervention_level="LOW_RISK",
        intervention_basis="RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE",
        risk_score=None, risk_level=None,
        revision=2, risk_assessment_status="NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL",
    )
    assert prediction.source_period_id == prediction.target_period_id
    assert prediction.risk_score is None
    assert prediction.intervention_level == "LOW_RISK"
    assert prediction.revision == 2


def test_v3_report_and_schema_are_structurally_readable_without_registration():
    from app.services.prediction.ModelVersionService import load_feature_schema, load_training_report

    schema = normalize_feature_schema(load_feature_schema(MODELS_DIR / "entervene_current_term_development_rf_v3_feature_schema.json"))
    report = normalize_training_report(
        load_training_report(MODELS_DIR / "entervene_current_term_development_rf_v3_training_report.json"),
        schema=schema,
    )
    validate_feature_schema(schema)
    validate_training_report(report)
    assert report["production_validated"] is False
    assert report["independent_three_term_validation"] is False
    assert report["target_column"] == schema["target_column"]
    assert len(schema["feature_columns"]) == 31


def test_v3_registration_path_is_development_only():
    from app.services.prediction.ModelVersionService import load_feature_schema, load_training_report
    from app.services.prediction.DevelopmentCurrentTermScoringService import MODEL_PATH

    schema = normalize_feature_schema(load_feature_schema(MODELS_DIR / "entervene_current_term_development_rf_v3_feature_schema.json"))
    report = normalize_training_report(
        load_training_report(MODELS_DIR / "entervene_current_term_development_rf_v3_training_report.json"),
        schema=schema,
    )
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[AIModelVersion.__table__])
    with Session(engine) as db:
        with pytest.raises(ValueError, match="cannot be activated"):
            register_model_version(
                db, report, schema, str(MODEL_PATH), activate=True,
                model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION,
            )
        assert db.query(AIModelVersion).count() == 0

        version, _, created = register_model_version(
            db, report, schema, str(MODEL_PATH), activate=False,
            model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION,
        )
        assert created is True
        assert version.lifecycle_status == "DEVELOPMENT"
        assert version.is_active is False
        assert version.production_validated is False
        assert version.independent_three_term_validation is False
        assert version.trained_at is None
        assert version.registry_metadata_json["supported_subjects"] == [
            "CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE",
        ]
        assert get_production_model_versions(db, ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION) == []
    engine.dispose()


def test_migration_graph_has_one_head_and_existing_columns_are_not_readded():
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    scripts = ScriptDirectory.from_config(cfg)
    assert scripts.get_heads() == ["20260922_development_immutable"]
    assert scripts.get_revision("20260916_add_lesson_goals").down_revision == "20260916_unified_prediction_risk"
    assert "model_purpose" in inspect(AIModelVersion).columns
    assert "revision" in inspect(AIPrediction).columns
