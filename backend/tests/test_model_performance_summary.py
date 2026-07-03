from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Predictions import router as predictions_router
from app.db.Base import Base
from app.db.Session import get_db
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
from app.services.prediction.ModelPerformanceService import get_model_performance_summary


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
def performance_context():
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

    staff_account = UserAccount(user_id=uuid.uuid4(), email="teacher@example.test", password_hash="hash")
    student_account = UserAccount(user_id=uuid.uuid4(), email="student@example.test", password_hash="hash")
    db.add_all([staff_account, student_account])
    db.flush()
    staff = AcademicStaff(
        staff_id="T-PERF",
        first_name="Perf",
        last_name="Teacher",
        user_id=staff_account.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Model",
        last_name="Learner",
        academic_level_id=level.academic_level_id,
        user_id=student_account.user_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000002",
        first_name="Other",
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
    other_class = Class(
        section_name="Curie",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    subject = Subject(subject_name="Science", academic_level_id=level.academic_level_id)
    other_subject = Subject(subject_name="Math", academic_level_id=level.academic_level_id)
    model_version = AIModelVersion(
        model_version_id=1,
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        algorithm="RandomForestRegressor",
        artifact_path="data/models/model.joblib",
        is_active=True,
    )
    other_model_version = AIModelVersion(
        model_version_id=2,
        model_name="entervene_next_period_grade_rf_v2",
        model_type="REGRESSOR",
        algorithm="RandomForestRegressor",
        artifact_path="data/models/model-v2.joblib",
        is_active=False,
    )
    db.add_all([
        staff,
        student,
        other_student,
        source_period,
        target_period,
        other_period,
        class_,
        other_class,
        subject,
        other_subject,
        model_version,
        other_model_version,
    ])
    db.commit()

    identity = {"sub": staff_account.user_id, "role": "teacher"}
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity

    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "staff_account": staff_account,
            "student_account": student_account,
            "student": student,
            "other_student": other_student,
            "class": class_,
            "other_class": other_class,
            "subject": subject,
            "other_subject": other_subject,
            "source_period": source_period,
            "target_period": target_period,
            "other_period": other_period,
            "model_version": model_version,
            "other_model_version": other_model_version,
        }

    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def add_prediction_with_outcome(context, **overrides):
    prediction_values = {
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
    outcome_values = {
        "actual_period_grade": 86.5,
        "actual_risk_label": "LOW_RISK",
        "actual_risk_status": "LOW_RISK",
        "prediction_error": 4.0,
        "absolute_error": 4.0,
        "actual_passed": True,
        "outcome_status": "EVALUATED",
    }
    for key in list(overrides):
        if key.startswith("outcome_"):
            outcome_values[key.replace("outcome_", "", 1)] = overrides.pop(key)
    prediction_values.update(overrides)
    prediction = AIPrediction(**prediction_values)
    context["db"].add(prediction)
    context["db"].flush()
    outcome = PredictionOutcome(prediction_id=prediction.prediction_id, **outcome_values)
    context["db"].add(outcome)
    context["db"].commit()
    return prediction, outcome


def seed_performance_rows(context):
    add_prediction_with_outcome(
        context,
        predicted_period_grade=82.5,
        risk_level="NEEDS_MONITORING",
        outcome_actual_period_grade=86.5,
        outcome_actual_risk_label="LOW_RISK",
        outcome_actual_risk_status="LOW_RISK",
        outcome_prediction_error=4.0,
        outcome_absolute_error=4.0,
    )
    add_prediction_with_outcome(
        context,
        student_id=context["other_student"].student_id,
        predicted_period_grade=90.0,
        risk_level="LOW_RISK",
        outcome_actual_period_grade=87.0,
        outcome_actual_risk_label="LOW_RISK",
        outcome_actual_risk_status="LOW_RISK",
        outcome_prediction_error=-3.0,
        outcome_absolute_error=3.0,
    )
    add_prediction_with_outcome(
        context,
        class_id=context["other_class"].class_id,
        subject_id=context["other_subject"].subject_id,
        target_period_id=context["other_period"].academic_period_id,
        model_version_id=context["other_model_version"].model_version_id,
        predicted_period_grade=80.0,
        risk_level="HIGH_RISK",
        outcome_actual_period_grade=72.0,
        outcome_actual_risk_label="HIGH_RISK",
        outcome_actual_risk_status="HIGH_RISK",
        outcome_prediction_error=-8.0,
        outcome_absolute_error=8.0,
    )
    add_prediction_with_outcome(
        context,
        predicted_period_grade=85.0,
        risk_level="MODERATE_RISK",
        outcome_outcome_status="PENDING",
        outcome_prediction_error=100.0,
        outcome_absolute_error=100.0,
    )


def test_empty_summary_returns_null_metrics(performance_context):
    summary = get_model_performance_summary(performance_context["db"])

    assert summary["total_evaluated_predictions"] == 0
    assert summary["mae"] is None
    assert summary["rmse"] is None
    assert summary["mean_prediction_error"] is None
    assert summary["min_absolute_error"] is None
    assert summary["max_absolute_error"] is None
    assert summary["actual_risk_label_counts"] == {}
    assert summary["predicted_risk_level_counts"] == {}
    assert summary["by_model_version"] == []


def test_computes_regression_metrics(performance_context):
    seed_performance_rows(performance_context)

    summary = get_model_performance_summary(performance_context["db"])

    assert summary["total_evaluated_predictions"] == 3
    assert summary["mae"] == pytest.approx(5.0)
    assert summary["rmse"] == pytest.approx(5.4467)
    assert summary["mean_prediction_error"] == pytest.approx(-2.3333)
    assert summary["min_absolute_error"] == 3.0
    assert summary["max_absolute_error"] == 8.0


def test_counts_actual_and_predicted_risk_labels(performance_context):
    seed_performance_rows(performance_context)

    summary = get_model_performance_summary(performance_context["db"])

    assert summary["actual_risk_label_counts"] == {"HIGH_RISK": 1, "LOW_RISK": 2}
    assert summary["predicted_risk_level_counts"] == {
        "HIGH_RISK": 1,
        "LOW_RISK": 1,
        "NEEDS_MONITORING": 1,
    }


def test_filters_by_model_version(performance_context):
    seed_performance_rows(performance_context)

    summary = get_model_performance_summary(
        performance_context["db"],
        model_version_id=performance_context["other_model_version"].model_version_id,
    )

    assert summary["total_evaluated_predictions"] == 1
    assert summary["mae"] == 8.0
    assert summary["by_model_version"][0]["model_version_id"] == 2


def test_filters_by_class_subject_and_academic_period(performance_context):
    seed_performance_rows(performance_context)

    summary = get_model_performance_summary(
        performance_context["db"],
        class_id=performance_context["class"].class_id,
        subject_id=performance_context["subject"].subject_id,
        academic_period_id=performance_context["target_period"].academic_period_id,
    )

    assert summary["total_evaluated_predictions"] == 2
    assert summary["mae"] == pytest.approx(3.5)
    assert summary["actual_risk_label_counts"] == {"LOW_RISK": 2}


def test_does_not_include_unevaluated_outcomes(performance_context):
    seed_performance_rows(performance_context)

    summary = get_model_performance_summary(performance_context["db"])

    assert summary["total_evaluated_predictions"] == 3
    assert summary["max_absolute_error"] == 8.0


def test_groups_by_model_version(performance_context):
    seed_performance_rows(performance_context)

    summary = get_model_performance_summary(performance_context["db"])

    assert len(summary["by_model_version"]) == 2
    assert summary["by_model_version"][0]["model_version_id"] == 1
    assert summary["by_model_version"][0]["model_name"] == "entervene_next_period_grade_rf"
    assert summary["by_model_version"][0]["total_evaluated_predictions"] == 2
    assert summary["by_model_version"][1]["model_version_id"] == 2


def test_route_returns_summary(performance_context):
    seed_performance_rows(performance_context)

    response = performance_context["client"].get("/api/v1/predictions/model-performance")

    assert response.status_code == 200
    body = response.json()
    assert body["total_evaluated_predictions"] == 3
    assert body["mae"] == pytest.approx(5.0)
    assert body["actual_risk_label_counts"] == {"HIGH_RISK": 1, "LOW_RISK": 2}


def test_route_supports_filters(performance_context):
    seed_performance_rows(performance_context)

    response = performance_context["client"].get(
        "/api/v1/predictions/model-performance",
        params={"model_version_id": performance_context["other_model_version"].model_version_id},
    )

    assert response.status_code == 200
    assert response.json()["total_evaluated_predictions"] == 1


def test_student_users_cannot_access_model_performance(performance_context):
    performance_context["identity"].update({
        "sub": performance_context["student_account"].user_id,
        "role": "student",
    })

    response = performance_context["client"].get("/api/v1/predictions/model-performance")

    assert response.status_code == 403
