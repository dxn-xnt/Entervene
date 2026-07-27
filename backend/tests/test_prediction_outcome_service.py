from __future__ import annotations

import uuid
from datetime import date

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
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.prediction.PredictionOutcomeService import evaluate_prediction_outcome


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
    PredictionOutcome.__table__,
]


@pytest.fixture
def outcome_context():
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
    db = sessionmaker(bind=engine)()

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
        first_name="Outcome",
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
    db.flush()
    prediction = AIPrediction(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        source_period_id=source_period.academic_period_id,
        target_period_id=target_period.academic_period_id,
        predicted_period_grade=82.5,
        risk_score=37.25,
        risk_level="NEEDS_MONITORING",
        data_status="SUFFICIENT",
        model_version_id=model_version.model_version_id,
    )
    db.add(prediction)
    db.commit()

    yield {
        "db": db,
        "prediction": prediction,
        "student": student,
        "class": class_,
        "subject": subject,
        "source_period": source_period,
        "target_period": target_period,
    }

    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def test_creates_outcome_for_evaluated_prediction(outcome_context):
    db = outcome_context["db"]
    prediction = outcome_context["prediction"]

    result = evaluate_prediction_outcome(db, prediction.prediction_id, actual_period_grade=86.5)

    outcome = db.query(PredictionOutcome).one()
    assert outcome.prediction_id == prediction.prediction_id
    assert result["prediction_id"] == prediction.prediction_id
    assert result["outcome_status"] == "EVALUATED"
    assert result["evaluated_at"] is not None


def test_updates_existing_outcome_instead_of_duplicating(outcome_context):
    db = outcome_context["db"]
    prediction = outcome_context["prediction"]

    first = evaluate_prediction_outcome(db, prediction.prediction_id, actual_period_grade=86.5)
    second = evaluate_prediction_outcome(db, prediction.prediction_id, actual_period_grade=90.0)

    assert first["outcome_id"] == second["outcome_id"]
    assert db.query(PredictionOutcome).count() == 1
    assert second["actual_period_grade"] == 90.0


def test_computes_prediction_error(outcome_context):
    result = evaluate_prediction_outcome(
        outcome_context["db"],
        outcome_context["prediction"].prediction_id,
        actual_period_grade=86.5,
    )

    assert result["prediction_error"] == 4.0


def test_computes_absolute_error(outcome_context):
    result = evaluate_prediction_outcome(
        outcome_context["db"],
        outcome_context["prediction"].prediction_id,
        actual_period_grade=78.0,
    )

    assert result["prediction_error"] == -4.5
    assert result["absolute_error"] == 4.5


def test_marks_actual_passed_based_on_passing_grade(outcome_context):
    passed = evaluate_prediction_outcome(
        outcome_context["db"],
        outcome_context["prediction"].prediction_id,
        actual_period_grade=75.0,
        passing_grade=75.0,
    )
    failed = evaluate_prediction_outcome(
        outcome_context["db"],
        outcome_context["prediction"].prediction_id,
        actual_period_grade=74.99,
        passing_grade=75.0,
    )

    assert passed["actual_passed"] is True
    assert passed["actual_risk_label"] == "LOW_RISK"
    assert failed["actual_passed"] is False
    assert failed["actual_risk_label"] == "HIGH_RISK"


def test_handles_missing_prediction_safely(outcome_context):
    with pytest.raises(LookupError, match="Prediction not found"):
        evaluate_prediction_outcome(outcome_context["db"], 99999, actual_period_grade=86.5)


def test_rejects_prediction_without_predicted_grade(outcome_context):
    db = outcome_context["db"]
    prediction = outcome_context["prediction"]
    prediction.predicted_period_grade = None
    db.commit()

    with pytest.raises(ValueError, match="predicted_period_grade"):
        evaluate_prediction_outcome(db, prediction.prediction_id, actual_period_grade=86.5)
