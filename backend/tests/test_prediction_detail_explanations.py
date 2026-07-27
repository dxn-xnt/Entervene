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
from app.models.academic.Lesson import Lesson
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.ai.TeacherRiskReview import TeacherRiskReview
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.suggestion.StudentSuggestion import StudentSuggestion


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
    PredictionOutcome.__table__,
    TeacherRiskReview.__table__,
    Lesson.__table__,
    StudentSuggestion.__table__,
]


@pytest.fixture
def explanation_context():
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
    db.add(staff_account)
    db.flush()
    staff = AcademicStaff(
        staff_id="T-EXPLAIN",
        first_name="Explain",
        last_name="Teacher",
        user_id=staff_account.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Risk",
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
    db.add_all([staff, student, source_period, target_period, class_, subject, model_version])
    db.flush()
    prediction = AIPrediction(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        source_period_id=source_period.academic_period_id,
        target_period_id=target_period.academic_period_id,
        predicted_period_grade=74.5,
        risk_score=88.0,
        risk_level="HIGH_RISK",
        data_status="SUFFICIENT",
        model_version_id=model_version.model_version_id,
    )
    db.add(prediction)
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
            "prediction": prediction,
        }

    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def detail_url(prediction_id: int) -> str:
    return f"/api/v1/predictions/{prediction_id}/detail"


def add_feature(context, name, value):
    context["db"].add(
        AIPredictionFeature(
            prediction_id=context["prediction"].prediction_id,
            feature_name=name,
            feature_value=value,
            direction="NEUTRAL",
            feature_rank=1,
            explanation_method="RULE",
        )
    )
    context["db"].commit()


def test_detail_includes_causes_array(explanation_context):
    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    assert isinstance(response.json()["causes"], list)


def test_detail_includes_recommended_actions_array(explanation_context):
    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    assert isinstance(response.json()["recommended_actions"], list)


def test_high_risk_produces_high_priority_actions(explanation_context):
    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    actions = response.json()["recommended_actions"]
    assert any(action["action_code"] == "ASSIGN_REMEDIAL_ACTIVITY" for action in actions)
    assert any(action["priority"] == "HIGH" for action in actions)


def test_insufficient_data_produces_collect_more_data_action(explanation_context):
    explanation_context["prediction"].risk_level = "INSUFFICIENT_DATA"
    explanation_context["prediction"].data_status = "INSUFFICIENT_DATA"
    explanation_context["db"].commit()

    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    body = response.json()
    assert any(cause["code"] == "INSUFFICIENT_DATA" for cause in body["causes"])
    assert body["recommended_actions"][0]["action_code"] == "COLLECT_MORE_DATA"


def test_completion_rate_feature_produces_low_completion_cause(explanation_context):
    add_feature(explanation_context, "completion_rate", 0.58)

    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    causes = response.json()["causes"]
    assert any(cause["code"] == "LOW_COMPLETION_RATE" for cause in causes)


def test_missing_count_feature_produces_missing_work_cause(explanation_context):
    add_feature(explanation_context, "missing_count", 3)

    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    causes = response.json()["causes"]
    assert any(cause["code"] == "MISSING_WORK" for cause in causes)


def test_unknown_feature_does_not_crash_detail_endpoint(explanation_context):
    add_feature(explanation_context, "mystery_signal", 999)

    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    assert "causes" in response.json()


def test_detail_does_not_create_student_suggestions(explanation_context):
    before = explanation_context["db"].query(StudentSuggestion).count()

    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    assert explanation_context["db"].query(StudentSuggestion).count() == before


def test_existing_prediction_detail_fields_still_exist(explanation_context):
    response = explanation_context["client"].get(detail_url(explanation_context["prediction"].prediction_id))

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_id"] == explanation_context["prediction"].prediction_id
    assert body["model_version"]["model_name"] == "entervene_next_period_grade_rf"
    assert "features" in body
    assert "teacher_reviews" in body
    assert "current_user_review" in body
