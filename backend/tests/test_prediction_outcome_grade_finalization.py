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
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.prediction.PredictionOutcomeService import evaluate_outcomes_for_finalized_period_grade


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
    StudentPeriodGrade.__table__,
    PredictionOutcome.__table__,
]


@pytest.fixture
def grade_outcome_context():
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
    other_period = AcademicPeriod(
        period_name="Quarter 3",
        period_type="QUARTER",
        period_sequence=3,
        total_periods_in_year=4,
        period_progress_ratio=0.75,
        start_date=date(2025, 12, 1),
        end_date=date(2026, 1, 31),
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
    db.add_all([student, source_period, target_period, other_period, class_, subject, model_version])
    db.commit()

    yield {
        "db": db,
        "student": student,
        "class": class_,
        "subject": subject,
        "source_period": source_period,
        "target_period": target_period,
        "other_period": other_period,
        "model_version": model_version,
    }

    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def add_prediction(context, **overrides):
    values = {
        "student_id": context["student"].student_id,
        "class_id": context["class"].class_id,
        "subject_id": context["subject"].subject_id,
        "source_period_id": context["source_period"].academic_period_id,
        "target_period_id": context["target_period"].academic_period_id,
        "predicted_period_grade": 82.5,
        "risk_score": 37.25,
        "risk_level": "NEEDS_MONITORING",
        "data_status": "SUFFICIENT",
        "model_version_id": context["model_version"].model_version_id,
    }
    values.update(overrides)
    prediction = AIPrediction(**values)
    context["db"].add(prediction)
    context["db"].flush()
    return prediction


def add_period_grade(context, **overrides):
    values = {
        "student_id": context["student"].student_id,
        "class_id": context["class"].class_id,
        "subject_id": context["subject"].subject_id,
        "academic_period_id": context["target_period"].academic_period_id,
        "final_period_grade": 86.5,
        "is_finalized": True,
    }
    values.update(overrides)
    period_grade = StudentPeriodGrade(**values)
    context["db"].add(period_grade)
    context["db"].flush()
    return period_grade


def test_helper_evaluates_matching_predictions_for_final_period_grade(grade_outcome_context):
    prediction = add_prediction(grade_outcome_context)
    period_grade = add_period_grade(grade_outcome_context, final_period_grade=86.5)
    grade_outcome_context["db"].commit()

    result = evaluate_outcomes_for_finalized_period_grade(
        grade_outcome_context["db"],
        period_grade.period_grade_id,
    )

    assert result["evaluated_count"] == 1
    assert result["skipped_count"] == 0
    assert result["outcomes"][0]["prediction_id"] == prediction.prediction_id
    assert result["outcomes"][0]["prediction_error"] == 4.0
    assert grade_outcome_context["db"].query(PredictionOutcome).count() == 1


def test_helper_skips_when_period_grade_is_not_finalized(grade_outcome_context):
    add_prediction(grade_outcome_context)
    period_grade = add_period_grade(grade_outcome_context, final_period_grade=86.5)
    period_grade.is_finalized = False
    grade_outcome_context["db"].commit()

    result = evaluate_outcomes_for_finalized_period_grade(
        grade_outcome_context["db"],
        period_grade.period_grade_id,
    )

    assert result["evaluated_count"] == 0
    assert result["skipped_count"] == 1
    assert result["reason"] == "Student period grade is not finalized."
    assert grade_outcome_context["db"].query(PredictionOutcome).count() == 0


def test_helper_skips_when_final_period_grade_is_missing(grade_outcome_context):
    add_prediction(grade_outcome_context)
    period_grade = add_period_grade(grade_outcome_context, final_period_grade=None)
    grade_outcome_context["db"].commit()

    result = evaluate_outcomes_for_finalized_period_grade(
        grade_outcome_context["db"],
        period_grade.period_grade_id,
    )

    assert result["evaluated_count"] == 0
    assert result["skipped_count"] == 1
    assert result["reason"] == "Student period grade does not have final_period_grade."
    assert grade_outcome_context["db"].query(PredictionOutcome).count() == 0


def test_helper_does_not_crash_when_no_matching_prediction_exists(grade_outcome_context):
    add_prediction(
        grade_outcome_context,
        target_period_id=grade_outcome_context["other_period"].academic_period_id,
    )
    period_grade = add_period_grade(grade_outcome_context, final_period_grade=86.5)
    grade_outcome_context["db"].commit()

    result = evaluate_outcomes_for_finalized_period_grade(
        grade_outcome_context["db"],
        period_grade.period_grade_id,
    )

    assert result["evaluated_count"] == 0
    assert result["skipped_count"] == 1
    assert result["reason"] == "No matching predictions found."
    assert grade_outcome_context["db"].query(PredictionOutcome).count() == 0


def test_helper_is_idempotent_for_repeated_evaluation(grade_outcome_context):
    prediction = add_prediction(grade_outcome_context)
    period_grade = add_period_grade(grade_outcome_context, final_period_grade=86.5)
    grade_outcome_context["db"].commit()

    first = evaluate_outcomes_for_finalized_period_grade(
        grade_outcome_context["db"],
        period_grade.period_grade_id,
    )
    period_grade.final_period_grade = 90.0
    grade_outcome_context["db"].commit()
    second = evaluate_outcomes_for_finalized_period_grade(
        grade_outcome_context["db"],
        period_grade.period_grade_id,
    )

    assert first["outcomes"][0]["outcome_id"] == second["outcomes"][0]["outcome_id"]
    assert second["outcomes"][0]["prediction_id"] == prediction.prediction_id
    assert second["outcomes"][0]["prediction_error"] == 7.5
    assert grade_outcome_context["db"].query(PredictionOutcome).count() == 1


def test_helper_raises_for_missing_student_period_grade(grade_outcome_context):
    with pytest.raises(LookupError, match="Student period grade not found"):
        evaluate_outcomes_for_finalized_period_grade(grade_outcome_context["db"], 99999)
