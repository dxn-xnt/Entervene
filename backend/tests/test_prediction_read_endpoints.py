from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

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
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.ai.TeacherRiskReview import TeacherRiskReview
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


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
]


@pytest.fixture
def prediction_read_context():
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
    other_staff_account = UserAccount(user_id=uuid.uuid4(), email="other@example.test", password_hash="hash")
    student_account = UserAccount(user_id=uuid.uuid4(), email="student@example.test", password_hash="hash")
    db.add_all([staff_account, other_staff_account, student_account])
    db.flush()
    staff = AcademicStaff(
        staff_id="T-READ",
        first_name="Read",
        last_name="Teacher",
        user_id=staff_account.user_id,
    )
    other_staff = AcademicStaff(
        staff_id="T-OTHER",
        first_name="Other",
        last_name="Teacher",
        user_id=other_staff_account.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Risk",
        last_name="Learner",
        academic_level_id=level.academic_level_id,
        user_id=student_account.user_id,
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
    db.add_all([staff, other_staff, student, source_period, target_period, class_, subject, model_version])
    db.flush()
    prediction = AIPrediction(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        source_period_id=source_period.academic_period_id,
        target_period_id=target_period.academic_period_id,
        predicted_period_grade=82.5,
        risk_score=62.0,
        risk_level="MODERATE_RISK",
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
            "identity": identity,
            "staff": staff,
            "other_staff": other_staff,
            "staff_account": staff_account,
            "student_account": student_account,
            "prediction": prediction,
        }

    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def detail_url(prediction_id: int) -> str:
    return f"/api/v1/predictions/{prediction_id}/detail"


def review_url(prediction_id: int) -> str:
    return f"/api/v1/predictions/{prediction_id}/teacher-review"


def add_feature(context, **overrides):
    values = {
        "prediction_id": context["prediction"].prediction_id,
        "feature_name": "completion_rate",
        "feature_value": 0.72,
        "direction": "NEUTRAL",
        "feature_rank": 1,
        "explanation_method": "RULE",
    }
    values.update(overrides)
    context["db"].add(AIPredictionFeature(**values))
    context["db"].commit()


def add_outcome(context):
    outcome = PredictionOutcome(
        prediction_id=context["prediction"].prediction_id,
        actual_period_grade=86.5,
        prediction_error=4.0,
        absolute_error=4.0,
        actual_passed=True,
        actual_risk_label="LOW_RISK",
        outcome_status="EVALUATED",
        evaluated_at=datetime.now(timezone.utc),
    )
    context["db"].add(outcome)
    context["db"].commit()
    return outcome


def add_review(context, staff=None, decision="CONFIRMED_RISK", notes="Confirmed by teacher."):
    staff = staff or context["staff"]
    review = TeacherRiskReview(
        prediction_id=context["prediction"].prediction_id,
        student_id=context["prediction"].student_id,
        reviewed_by_staff_id=staff.staff_id,
        review_decision=decision,
        teacher_notes=notes,
        reviewed_at=datetime.now(timezone.utc),
    )
    context["db"].add(review)
    context["db"].commit()
    return review


def test_detail_returns_basic_prediction_fields(prediction_read_context):
    response = prediction_read_context["client"].get(detail_url(prediction_read_context["prediction"].prediction_id))

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_id"] == prediction_read_context["prediction"].prediction_id
    assert body["predicted_period_grade"] == 82.5
    assert body["risk_level"] == "MODERATE_RISK"
    assert body["data_status"] == "SUFFICIENT"


def test_detail_includes_model_version(prediction_read_context):
    response = prediction_read_context["client"].get(detail_url(prediction_read_context["prediction"].prediction_id))

    assert response.status_code == 200
    model_version = response.json()["model_version"]
    assert model_version["model_version_id"] == 1
    assert model_version["model_name"] == "entervene_next_period_grade_rf"
    assert model_version["algorithm"] == "RandomForestRegressor"
    assert model_version["is_active"] is True


def test_detail_includes_features(prediction_read_context):
    add_feature(prediction_read_context)

    response = prediction_read_context["client"].get(detail_url(prediction_read_context["prediction"].prediction_id))

    assert response.status_code == 200
    features = response.json()["features"]
    assert len(features) == 1
    assert features[0]["feature_name"] == "completion_rate"
    assert features[0]["feature_value"] == 0.72


def test_detail_includes_outcome(prediction_read_context):
    add_outcome(prediction_read_context)

    response = prediction_read_context["client"].get(detail_url(prediction_read_context["prediction"].prediction_id))

    assert response.status_code == 200
    outcome = response.json()["outcome"]
    assert outcome["actual_period_grade"] == 86.5
    assert outcome["prediction_error"] == 4.0
    assert outcome["absolute_error"] == 4.0
    assert outcome["actual_passed"] is True
    assert outcome["actual_risk_label"] == "LOW_RISK"


def test_detail_includes_teacher_reviews(prediction_read_context):
    add_review(prediction_read_context)
    add_review(
        prediction_read_context,
        staff=prediction_read_context["other_staff"],
        decision="NEEDS_MORE_DATA",
        notes="Need more classroom evidence.",
    )

    response = prediction_read_context["client"].get(detail_url(prediction_read_context["prediction"].prediction_id))

    assert response.status_code == 200
    reviews = response.json()["teacher_reviews"]
    assert len(reviews) == 2
    assert {review["staff_id"] for review in reviews} == {"T-READ", "T-OTHER"}


def test_detail_includes_current_user_review(prediction_read_context):
    review = add_review(prediction_read_context, decision="ESCALATED", notes="Escalated to adviser.")

    response = prediction_read_context["client"].get(detail_url(prediction_read_context["prediction"].prediction_id))

    assert response.status_code == 200
    current = response.json()["current_user_review"]
    assert current["review_id"] == review.review_id
    assert current["staff_id"] == "T-READ"
    assert current["decision"] == "ESCALATED"


def test_detail_missing_prediction_returns_404(prediction_read_context):
    response = prediction_read_context["client"].get(detail_url(99999))

    assert response.status_code == 404
    assert response.json()["detail"] == "Prediction not found."


def test_teacher_review_get_returns_review_information(prediction_read_context):
    add_review(prediction_read_context)

    response = prediction_read_context["client"].get(review_url(prediction_read_context["prediction"].prediction_id))

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_id"] == prediction_read_context["prediction"].prediction_id
    assert len(body["teacher_reviews"]) == 1
    assert body["teacher_reviews"][0]["decision"] == "CONFIRMED_RISK"
    assert body["current_user_review"]["staff_id"] == "T-READ"


def test_teacher_review_get_returns_empty_when_no_review_exists(prediction_read_context):
    response = prediction_read_context["client"].get(review_url(prediction_read_context["prediction"].prediction_id))

    assert response.status_code == 200
    body = response.json()
    assert body["teacher_reviews"] == []
    assert body["current_user_review"] is None


def test_student_users_cannot_access_prediction_read_endpoints(prediction_read_context):
    prediction_read_context["identity"].update({
        "sub": prediction_read_context["student_account"].user_id,
        "role": "student",
    })

    detail_response = prediction_read_context["client"].get(detail_url(prediction_read_context["prediction"].prediction_id))
    review_response = prediction_read_context["client"].get(review_url(prediction_read_context["prediction"].prediction_id))

    assert detail_response.status_code == 403
    assert review_response.status_code == 403
