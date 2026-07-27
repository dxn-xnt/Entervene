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
    TeacherRiskReview.__table__,
]


@pytest.fixture
def teacher_review_context():
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
        staff_id="T-REVIEW",
        first_name="Review",
        last_name="Teacher",
        user_id=staff_account.user_id,
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
            "identity": identity,
            "staff": staff,
            "staff_account": staff_account,
            "student_account": student_account,
            "student": student,
            "prediction": prediction,
        }

    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def review_url(prediction_id: int) -> str:
    return f"/api/v1/predictions/{prediction_id}/teacher-review"


def test_teacher_can_create_review_for_existing_prediction(teacher_review_context):
    response = teacher_review_context["client"].post(
        review_url(teacher_review_context["prediction"].prediction_id),
        json={
            "decision": "CONFIRMED_RISK",
            "teacher_notes": "Student has missed multiple classworks and needs remediation.",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_id"] == teacher_review_context["prediction"].prediction_id
    assert body["staff_id"] == teacher_review_context["staff"].staff_id
    assert body["decision"] == "CONFIRMED_RISK"
    assert body["teacher_notes"] == "Student has missed multiple classworks and needs remediation."
    assert body["reviewed_at"] is not None
    assert teacher_review_context["db"].query(TeacherRiskReview).count() == 1


def test_same_staff_review_updates_existing_row(teacher_review_context):
    client = teacher_review_context["client"]
    prediction_id = teacher_review_context["prediction"].prediction_id
    first = client.post(
        review_url(prediction_id),
        json={"decision": "NEEDS_MORE_DATA", "teacher_notes": "Need more evidence."},
    ).json()

    second_response = client.post(
        review_url(prediction_id),
        json={"decision": "INTERVENTION_ASSIGNED", "teacher_notes": "Assigned remediation work."},
    )

    assert second_response.status_code == 200
    second = second_response.json()
    assert second["review_id"] == first["review_id"]
    assert second["decision"] == "INTERVENTION_ASSIGNED"
    assert second["teacher_notes"] == "Assigned remediation work."
    assert teacher_review_context["db"].query(TeacherRiskReview).count() == 1


def test_missing_prediction_returns_404(teacher_review_context):
    response = teacher_review_context["client"].post(
        review_url(99999),
        json={"decision": "CONFIRMED_RISK"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Prediction not found."


def test_invalid_decision_returns_validation_error(teacher_review_context):
    response = teacher_review_context["client"].post(
        review_url(teacher_review_context["prediction"].prediction_id),
        json={"decision": "NOT_A_REAL_DECISION"},
    )

    assert response.status_code == 422
    assert teacher_review_context["db"].query(TeacherRiskReview).count() == 0


def test_response_includes_review_fields(teacher_review_context):
    response = teacher_review_context["client"].post(
        review_url(teacher_review_context["prediction"].prediction_id),
        json={"decision": "ESCALATED", "teacher_notes": "Escalating for guidance counselor review."},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["review_id"] is not None
    assert body["staff_id"] == "T-REVIEW"
    assert body["decision"] == "ESCALATED"
    assert body["teacher_notes"] == "Escalating for guidance counselor review."
    assert body["reviewed_at"] is not None


def test_student_users_cannot_create_review(teacher_review_context):
    teacher_review_context["identity"].update({
        "sub": teacher_review_context["student_account"].user_id,
        "role": "student",
    })

    response = teacher_review_context["client"].post(
        review_url(teacher_review_context["prediction"].prediction_id),
        json={"decision": "CONFIRMED_RISK"},
    )

    assert response.status_code == 403
    assert teacher_review_context["db"].query(TeacherRiskReview).count() == 0
