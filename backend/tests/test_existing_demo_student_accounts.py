"""Read-only checks for the existing-student Demo login provisioning command."""

import json
import secrets
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.main import app
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.intervention.Intervention import Intervention
from app.models.people.Student import Student
from scripts.provision_existing_demo_student_accounts import (
    CREDENTIALS_PATH, EMAILS, provision_existing_student,
    require_safe_demo_connection, select_students,
)


@pytest.fixture
def demo_session():
    if settings.app_environment != "development" or not CREDENTIALS_PATH.exists():
        pytest.skip("Demo-only acceptance credentials are unavailable")
    engine = create_engine(settings.database_url)
    with Session(engine) as session:
        require_safe_demo_connection(session)
        yield session
        session.rollback()
    engine.dispose()


def test_guard_rejects_main_and_production(monkeypatch):
    fake_main = SimpleNamespace(get_bind=lambda: SimpleNamespace(url="postgresql://user@localhost/Entervene"))
    monkeypatch.setattr(settings, "app_environment", "development")
    with pytest.raises(ValueError, match="non-local or non-demo"):
        require_safe_demo_connection(fake_main)
    monkeypatch.setattr(settings, "app_environment", "production")
    with pytest.raises(ValueError, match="requires APP_ENVIRONMENT=development"):
        require_safe_demo_connection(fake_main)


def test_existing_students_are_linked_idempotently_without_academic_mutation(demo_session):
    intervention, target, classmate = select_students(demo_session)
    assert intervention.student_id == target.student_id
    assert target.student_id != classmate.student_id
    credentials = json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))
    role = demo_session.scalar(select(Role).where(Role.role_name == "Student"))
    before = {
        "students": demo_session.scalar(select(func.count()).select_from(Student)),
        "enrollments": demo_session.scalar(select(func.count()).select_from(StudentClass)),
        "interventions": demo_session.scalar(select(func.count()).select_from(Intervention)),
        "predictions": demo_session.scalar(select(func.count()).select_from(DevelopmentCurrentTermPrediction)),
        "identity": [(s.student_id, s.student_lrn, s.user_id,
                      tuple((e.class_id, e.academic_year_id, e.enrollment_status) for e in s.student_classes))
                     for s in (target, classmate)],
    }
    for label, student in (("target", target), ("classmate", classmate)):
        assert student.user_id is not None
        assert provision_existing_student(demo_session, student, EMAILS[label],
                                          credentials[label]["password"], role.role_id) == "reused"
        account = demo_session.get(UserAccount, student.user_id)
        assert account.email == EMAILS[label] and account.account_status == "active"
        assert demo_session.get(UserRoles, (account.user_id, role.role_id)) is not None
    demo_session.flush()
    assert demo_session.scalar(select(func.count()).select_from(Student)) == before["students"]
    assert demo_session.scalar(select(func.count()).select_from(StudentClass)) == before["enrollments"]
    assert demo_session.scalar(select(func.count()).select_from(Intervention)) == before["interventions"]
    assert demo_session.scalar(select(func.count()).select_from(DevelopmentCurrentTermPrediction)) == before["predictions"]
    assert [(s.student_id, s.student_lrn, s.user_id,
             tuple((e.class_id, e.academic_year_id, e.enrollment_status) for e in s.student_classes))
            for s in (target, classmate)] == before["identity"]
    with pytest.raises(ValueError, match="different or broken account link"):
        provision_existing_student(demo_session, classmate, EMAILS["target"],
                                   credentials["target"]["password"], role.role_id)


def test_first_link_preserves_existing_profile_and_duplicate_email_fails(demo_session):
    intervention, target, classmate = select_students(demo_session)
    other_students = demo_session.scalars(
        select(Student).join(StudentClass, Student.student_id == StudentClass.student_id)
        .where(StudentClass.class_id == intervention.class_id, Student.user_id.is_(None))
        .order_by(Student.student_id)
    ).all()
    if not other_students:
        pytest.skip("No unlinked existing Demo student remains for a rollback test")
    student = other_students[0]
    role = demo_session.scalar(select(Role).where(Role.role_name == "Student"))
    original = (student.student_id, student.student_lrn,
                tuple((e.class_id, e.academic_year_id, e.enrollment_status) for e in student.student_classes))
    student_count = demo_session.scalar(select(func.count()).select_from(Student))
    intervention_count = demo_session.scalar(select(func.count()).select_from(Intervention))
    prediction_count = demo_session.scalar(select(func.count()).select_from(DevelopmentCurrentTermPrediction))
    with pytest.raises(ValueError, match="already used"):
        provision_existing_student(demo_session, student, EMAILS["target"], secrets.token_urlsafe(32), role.role_id)
    assert student.user_id is None
    result = provision_existing_student(demo_session, student,
                                        "demo-temporary-link@example.com", secrets.token_urlsafe(32), role.role_id)
    assert result == "created"
    demo_session.flush()
    assert student.user_id is not None
    assert (student.student_id, student.student_lrn,
            tuple((e.class_id, e.academic_year_id, e.enrollment_status) for e in student.student_classes)) == original
    assert demo_session.scalar(select(func.count()).select_from(Student)) == student_count
    assert demo_session.scalar(select(func.count()).select_from(Intervention)) == intervention_count
    assert demo_session.scalar(select(func.count()).select_from(DevelopmentCurrentTermPrediction)) == prediction_count


def test_provisioned_students_authenticate_as_correct_profiles(demo_session):
    _, target, classmate = select_students(demo_session)
    credentials = json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))
    with TestClient(app) as client:
        for label, student in (("target", target), ("classmate", classmate)):
            result = client.post("/api/v1/auth/login", json=credentials[label])
            assert result.status_code == 200
            assert result.json()["role"] == "student"
            assert result.json()["user_id"] == str(student.user_id)
            me = client.get("/api/v1/auth/me")
            assert me.status_code == 200 and me.json()["role"] == "student"
