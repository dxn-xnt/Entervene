from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.services.PredictionPersistenceService as persistence_service
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.PredictionPersistenceService import (
    score_and_persist_prediction,
    validate_required_identifiers,
)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    AIModelVersion.__table__,
    AIPrediction.__table__,
    AIPredictionFeature.__table__,
]


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        constraint
        for constraint in Student.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    Student.__table__.constraints.remove(lrn_check)
    Base.metadata.create_all(bind=engine, tables=TABLES)
    Student.__table__.append_constraint(lrn_check)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
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


def fake_scoring_result(**overrides):
    result = {
        "model_version_id": 1,
        "predicted_period_grade": 87.81,
        "risk_level": "NEEDS_MONITORING",
        "risk_score": 37.29,
        "data_status": "SUFFICIENT",
        "reasons": ["Predicted next-period grade is between 82 and 88."],
        "recommended_action": "Continue monitoring and review recent learning activities.",
        "triggered_rules": ["predicted_grade_82_to_87"],
        "feature_columns_used": [
            "grade_level",
            "periodical_assessment_percent",
            "source_period_grade",
            "assessment_completion_rate",
            "grade_trend_vs_previous_period",
            "subject_SCIENCE",
        ],
    }
    result.update(overrides)
    return result


def prediction_request(seeded, **feature_overrides):
    features = {
        "grade_level": 8,
        "quarterly_assessment_percent": 84.0,
        "source_period_grade": 87.0,
        "assessment_completion_rate": 0.95,
        "grade_trend_vs_previous_period": -2.0,
        "subject_SCIENCE": 1,
        "missing_activity_count": 0,
        "late_submission_count": 0,
        "data_coverage_ratio": 0.95,
    }
    features.update(feature_overrides)
    return {
        "student_id": str(seeded["student"].student_id),
        "class_id": seeded["class"].class_id,
        "subject_id": seeded["subject"].subject_id,
        "source_period_id": seeded["source_period"].academic_period_id,
        "target_period_id": seeded["target_period"].academic_period_id,
        "features": features,
    }


def patch_scoring(monkeypatch, result=None):
    monkeypatch.setattr(
        persistence_service,
        "score_student_prediction",
        lambda db, features, model_name="entervene_next_period_grade_rf": result or fake_scoring_result(),
    )


def test_required_identifiers_are_validated():
    with pytest.raises(ValueError, match="student_id"):
        validate_required_identifiers({"features": {}})


def test_missing_referenced_record_fails_clearly(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    request = prediction_request(seeded)
    request["student_id"] = str(uuid.uuid4())

    with pytest.raises(ValueError, match="student"):
        score_and_persist_prediction(db, request)


def test_scoring_service_result_is_saved_into_ai_prediction(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)

    result = score_and_persist_prediction(db, prediction_request(seeded))

    prediction = db.get(AIPrediction, result["prediction_id"])
    assert prediction is not None
    assert float(prediction.predicted_period_grade) == pytest.approx(87.81)
    assert prediction.risk_level == "NEEDS_MONITORING"
    assert result["risk_score"] == pytest.approx(37.29)


def test_feature_rows_are_saved_into_ai_prediction_feature(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)

    result = score_and_persist_prediction(db, prediction_request(seeded))

    rows = db.query(AIPredictionFeature).filter_by(prediction_id=result["prediction_id"]).all()
    names = {row.feature_name for row in rows}
    assert "grade_level" in names
    assert "periodical_assessment_percent" in names
    assert result["feature_rows_created"] == len(rows)


def test_student_names_and_lrns_are_not_saved_as_feature_rows(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    request = prediction_request(
        seeded,
        student_lrn="100000000001",
        synthetic_full_name="Synthetic Learner",
        learner_name="Synthetic Learner",
    )

    result = score_and_persist_prediction(db, request)

    names = {
        row.feature_name
        for row in db.query(AIPredictionFeature).filter_by(prediction_id=result["prediction_id"])
    }
    assert "student_lrn" not in names
    assert "synthetic_full_name" not in names
    assert "learner_name" not in names


def test_runtime_only_risk_fields_can_be_saved_as_feature_evidence(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    request = prediction_request(seeded, missing_activity_count=2, late_submission_count=3)

    result = score_and_persist_prediction(db, request)

    rows = db.query(AIPredictionFeature).filter_by(prediction_id=result["prediction_id"]).all()
    values = {row.feature_name: row.feature_value for row in rows}
    assert values["missing_activity_count"] == 2
    assert values["late_submission_count"] == 3
    assert "data_coverage_ratio" in values


def test_transaction_rolls_back_if_feature_insert_fails(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)

    def bad_feature_rows(prediction, features, scoring_result):
        return [
            AIPredictionFeature(
                prediction=prediction,
                feature_name="bad",
                feature_value=1,
                direction="NOT_ALLOWED",
                explanation_method="RULE",
            )
        ]

    monkeypatch.setattr(persistence_service, "build_prediction_feature_rows", bad_feature_rows)
    with pytest.raises(Exception):
        score_and_persist_prediction(db, prediction_request(seeded))

    assert db.query(AIPrediction).count() == 0
    assert db.query(AIPredictionFeature).count() == 0


def test_duplicate_prediction_handling_returns_existing_row(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    first = score_and_persist_prediction(db, prediction_request(seeded))
    second = score_and_persist_prediction(db, prediction_request(seeded))

    assert second["duplicate"] is True
    assert second["prediction_id"] == first["prediction_id"]
    assert db.query(AIPrediction).count() == 1


def test_replace_existing_updates_prediction_safely(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    first = score_and_persist_prediction(db, prediction_request(seeded))
    patch_scoring(
        monkeypatch,
        fake_scoring_result(
            predicted_period_grade=80.5,
            risk_level="MODERATE_RISK",
            risk_score=62.0,
            triggered_rules=["predicted_grade_75_to_81"],
        ),
    )

    second = score_and_persist_prediction(db, prediction_request(seeded), replace_existing=True)

    assert second["prediction_id"] == first["prediction_id"]
    assert second["duplicate"] is False
    assert second["predicted_period_grade"] == pytest.approx(80.5)
    assert db.query(AIPrediction).count() == 1
    assert db.get(AIPrediction, first["prediction_id"]).risk_level == "MODERATE_RISK"


def test_returned_result_includes_prediction_summary(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)

    result = score_and_persist_prediction(db, prediction_request(seeded))

    assert result["prediction_id"] is not None
    assert result["predicted_period_grade"] == pytest.approx(87.81)
    assert result["risk_level"] == "NEEDS_MONITORING"
    assert result["risk_score"] == pytest.approx(37.29)
    assert result["feature_rows_created"] > 0
