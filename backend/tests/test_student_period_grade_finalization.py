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
from app.api.v1.routes.StudentRecords import router as student_records_router
from app.db.Base import Base
from app.db.Session import get_db
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
def finalization_context():
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
        staff_id="T-FINAL",
        first_name="Final",
        last_name="Teacher",
        user_id=staff_account.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Outcome",
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
    db.commit()

    identity = {"sub": staff_account.user_id, "role": "teacher"}
    app = FastAPI()
    app.include_router(student_records_router, prefix="/api/v1/student-records")
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
            "class": class_,
            "subject": subject,
            "source_period": source_period,
            "target_period": target_period,
            "model_version": model_version,
        }

    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def add_period_grade(context, **overrides):
    values = {
        "student_id": context["student"].student_id,
        "class_id": context["class"].class_id,
        "subject_id": context["subject"].subject_id,
        "academic_period_id": context["target_period"].academic_period_id,
        "final_period_grade": None,
    }
    values.update(overrides)
    period_grade = StudentPeriodGrade(**values)
    context["db"].add(period_grade)
    context["db"].commit()
    return period_grade


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
    context["db"].commit()
    return prediction


def finalize_url(period_grade_id: int) -> str:
    return f"/api/v1/student-records/period-grades/{period_grade_id}/finalize"


def test_finalizes_existing_period_grade_with_payload_grade(finalization_context):
    period_grade = add_period_grade(finalization_context)

    response = finalization_context["client"].post(
        finalize_url(period_grade.period_grade_id),
        json={"final_period_grade": 86.5, "passing_grade": 75},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["period_grade_id"] == period_grade.period_grade_id
    assert body["final_period_grade"] == 86.5
    assert body["is_finalized"] is True
    assert body["finalized_at"] is not None


def test_rejects_finalization_when_final_period_grade_is_missing(finalization_context):
    period_grade = add_period_grade(finalization_context)

    response = finalization_context["client"].post(finalize_url(period_grade.period_grade_id), json={})

    assert response.status_code == 400
    assert response.json()["detail"] == "final_period_grade is required to finalize a period grade"


def test_uses_existing_final_period_grade_when_payload_omits_it(finalization_context):
    period_grade = add_period_grade(finalization_context, final_period_grade=88.5)

    response = finalization_context["client"].post(finalize_url(period_grade.period_grade_id), json={})

    assert response.status_code == 200
    assert response.json()["final_period_grade"] == 88.5


def test_sets_finalization_metadata(finalization_context):
    period_grade = add_period_grade(finalization_context)

    response = finalization_context["client"].post(
        finalize_url(period_grade.period_grade_id),
        json={"final_period_grade": 86.5},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_finalized"] is True
    assert body["finalized_at"] is not None
    assert body["finalized_by_staff_id"] == finalization_context["staff"].staff_id


def test_finalization_evaluates_matching_prediction(finalization_context):
    prediction = add_prediction(finalization_context)
    period_grade = add_period_grade(finalization_context)

    response = finalization_context["client"].post(
        finalize_url(period_grade.period_grade_id),
        json={"final_period_grade": 86.5},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_outcomes_evaluated_count"] == 1
    outcome = finalization_context["db"].query(PredictionOutcome).one()
    assert outcome.prediction_id == prediction.prediction_id
    assert float(outcome.prediction_error) == 4.0


def test_finalization_does_not_crash_without_matching_prediction(finalization_context):
    period_grade = add_period_grade(finalization_context)

    response = finalization_context["client"].post(
        finalize_url(period_grade.period_grade_id),
        json={"final_period_grade": 86.5},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_outcomes_evaluated_count"] == 0
    assert body["prediction_outcomes_skipped_count"] == 1
    assert body["prediction_outcomes_message"] == "No matching predictions found."


def test_refinalizing_updates_existing_prediction_outcome(finalization_context):
    add_prediction(finalization_context)
    period_grade = add_period_grade(finalization_context)
    client = finalization_context["client"]

    first = client.post(
        finalize_url(period_grade.period_grade_id),
        json={"final_period_grade": 86.5},
    ).json()
    second_response = client.post(
        finalize_url(period_grade.period_grade_id),
        json={"final_period_grade": 90.0},
    )

    assert second_response.status_code == 200
    second = second_response.json()
    assert first["prediction_outcomes_evaluated_count"] == 1
    assert second["prediction_outcomes_evaluated_count"] == 1
    assert finalization_context["db"].query(PredictionOutcome).count() == 1
    outcome = finalization_context["db"].query(PredictionOutcome).one()
    assert float(outcome.prediction_error) == 7.5


def test_students_cannot_finalize_period_grades(finalization_context):
    period_grade = add_period_grade(finalization_context)
    finalization_context["identity"].update({
        "sub": finalization_context["student_account"].user_id,
        "role": "student",
    })

    response = finalization_context["client"].post(
        finalize_url(period_grade.period_grade_id),
        json={"final_period_grade": 86.5},
    )

    assert response.status_code == 403
    assert finalization_context["db"].get(StudentPeriodGrade, period_grade.period_grade_id).is_finalized is False


def test_missing_period_grade_returns_404(finalization_context):
    response = finalization_context["client"].post(
        finalize_url(99999),
        json={"final_period_grade": 86.5},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Student period grade not found"
