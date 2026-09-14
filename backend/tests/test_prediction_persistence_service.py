from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.people.Student import Student
from app.services.prediction.PredictionPersistenceService import (
    build_prediction_feature_rows,
    find_existing_prediction,
    score_and_persist_prediction,
    validate_references,
    validate_required_identifiers,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def seeded(db):
    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add_all([year, level])
    db.flush()

    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Synthetic",
        last_name="Learner",
        academic_level_id=level.academic_level_id,
    )
    source_period = AcademicPeriod(
        period_name="Quarter 1",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        period_progress_ratio=0.25,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    target_period = AcademicPeriod(
        period_name="Quarter 2",
        period_type="QUARTER",
        period_sequence=2,
        total_periods_in_year=4,
        period_progress_ratio=0.5,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        academic_year_id=year.academic_year_id,
    )
    class_ = Class(
        section_name="Einstein",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    subject = Subject(subject_name="Science", academic_level_id=level.academic_level_id)
    model_version = AIModelVersion(
        model_version_id=1,
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        algorithm="RandomForestRegressor",
        artifact_path="data/models/model.joblib",
        is_active=True,
    )
    db.add_all([student, source_period, target_period, class_, subject, model_version])
    db.commit()
    return {
        "student": student,
        "class": class_,
        "subject": subject,
        "source_period": source_period,
        "target_period": target_period,
        "model_version": model_version,
    }


def identifiers(seeded, **overrides):
    payload = {
        "student_id": str(seeded["student"].student_id),
        "class_id": seeded["class"].class_id,
        "subject_id": seeded["subject"].subject_id,
        "source_period_id": seeded["source_period"].academic_period_id,
        "target_period_id": seeded["target_period"].academic_period_id,
        "features": {"source_period_grade": 87.0},
    }
    payload.update(overrides)
    return payload


def test_required_identifiers_are_validated():
    with pytest.raises(ValueError, match="student_id"):
        validate_required_identifiers({"features": {}})
    with pytest.raises(ValueError, match="features object"):
        validate_required_identifiers({
            "student_id": str(uuid.uuid4()),
            "class_id": 1,
            "subject_id": 1,
            "source_period_id": 1,
            "target_period_id": 2,
        })


def test_validate_references_parses_and_returns_canonical_scope(db, seeded):
    scope = validate_references(db, identifiers(seeded))

    assert scope == {
        "student_id": seeded["student"].student_id,
        "class_id": seeded["class"].class_id,
        "subject_id": seeded["subject"].subject_id,
        "source_period_id": seeded["source_period"].academic_period_id,
        "target_period_id": seeded["target_period"].academic_period_id,
    }


def test_missing_referenced_record_fails_clearly(db, seeded):
    payload = identifiers(seeded, student_id=str(uuid.uuid4()))

    with pytest.raises(ValueError, match="student"):
        validate_references(db, payload)


def test_raw_feature_persistence_is_rejected(db, seeded):
    with pytest.raises(ValueError, match="Raw feature persistence is disabled"):
        score_and_persist_prediction(db, identifiers(seeded))

    assert db.query(AIPrediction).count() == 0
    assert db.query(AIPredictionFeature).count() == 0


def test_feature_rows_filter_identity_fields_and_preserve_runtime_evidence(seeded):
    prediction = AIPrediction(
        student_id=seeded["student"].student_id,
        class_id=seeded["class"].class_id,
        subject_id=seeded["subject"].subject_id,
        source_period_id=seeded["source_period"].academic_period_id,
        target_period_id=seeded["target_period"].academic_period_id,
        model_version_id=seeded["model_version"].model_version_id,
        revision=1,
    )
    features = {
        "grade_level": 8,
        "source_period_grade": 87.0,
        "assessment_completion_rate": 0.95,
        "student_lrn": "100000000001",
        "synthetic_full_name": "Synthetic Learner",
        "missing_activity_count": 2,
        "late_submission_count": 3,
        "data_coverage_ratio": 0.95,
    }
    scoring = {
        "feature_columns_used": [
            "grade_level",
            "source_period_grade",
            "student_lrn",
            "synthetic_full_name",
            "assessment_completion_rate",
        ],
        "predicted_period_grade": 87.81,
    }

    rows = build_prediction_feature_rows(prediction, features, scoring)
    values = {row.feature_name: row.feature_value for row in rows}

    assert "student_lrn" not in values
    assert "synthetic_full_name" not in values
    assert values["missing_activity_count"] == Decimal("2")
    assert values["late_submission_count"] == Decimal("3")
    assert values["data_coverage_ratio"] == Decimal("0.95")
    assert values["predicted_period_grade"] == Decimal("87.81")


def test_find_existing_prediction_returns_latest_revision(db, seeded):
    base = {
        "student_id": seeded["student"].student_id,
        "class_id": seeded["class"].class_id,
        "subject_id": seeded["subject"].subject_id,
        "source_period_id": seeded["source_period"].academic_period_id,
        "target_period_id": seeded["target_period"].academic_period_id,
        "model_version_id": seeded["model_version"].model_version_id,
        "risk_level": "LOW_RISK",
        "data_status": "SUFFICIENT",
    }
    first = AIPrediction(**base, revision=1, predicted_period_grade=Decimal("84.00"))
    second = AIPrediction(**base, revision=2, predicted_period_grade=Decimal("86.00"))
    db.add_all([first, second])
    db.commit()

    found = find_existing_prediction(db, validate_references(db, identifiers(seeded)), seeded["model_version"].model_version_id)

    assert found.prediction_id == second.prediction_id
    assert found.revision == 2
