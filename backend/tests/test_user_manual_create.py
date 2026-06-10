import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Users import router as users_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.auth.InvitationToken import InvitationToken
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


TABLES = [
    AcademicLevel.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    InvitationToken.__table__,
    AcademicStaff.__table__,
    Student.__table__,
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
    session.add_all(
        [
            Role(role_id=1, role_name="Admin"),
            Role(role_id=2, role_name="Teacher"),
            Role(role_id=3, role_name="Student"),
            AcademicLevel(level_name="Grade 7", grade_level=7),
        ]
    )
    session.commit()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


@pytest.fixture
def client(db, monkeypatch):
    test_app = FastAPI()
    test_app.include_router(users_router, prefix="/api/v1")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    monkeypatch.setattr("app.api.v1.routes.Users.send_invitation_email", lambda email, token: None)
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def invite(client, **overrides):
    payload = {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "middle_name": "",
        "email": "ada@example.com",
        "role": "Student",
        "student_lrn": "123456789012",
        "grade_level": 7,
        "suffix": "",
        "gender": "Female",
        "contact_number": "09170000000",
        "address": "Antipolo City",
    }
    payload.update(overrides)
    return client.post("/api/v1/users/invite", json=payload)


def test_valid_manual_student_creation_creates_account_role_profile_and_invitation(client, db):
    response = invite(client)

    assert response.status_code == 200
    account = db.query(UserAccount).filter(UserAccount.email == "ada@example.com").one()
    student = db.query(Student).filter(Student.user_id == account.user_id).one()
    role = (
        db.query(Role.role_name)
        .join(UserRoles, Role.role_id == UserRoles.role_id)
        .filter(UserRoles.user_id == account.user_id)
        .scalar()
    )
    assert account.account_status == "pending"
    assert role == "Student"
    assert student.student_lrn == "123456789012"
    assert student.middle_name == ""
    assert student.suffix == ""
    assert db.query(InvitationToken).filter(InvitationToken.user_id == account.user_id).count() == 1


def test_manual_student_rejects_duplicate_email(client, db):
    assert invite(client).status_code == 200

    response = invite(client, student_lrn="123456789013")

    assert response.status_code == 409
    assert response.json()["detail"] == "Email already registered"
    assert db.query(UserAccount).count() == 1


def test_manual_student_rejects_duplicate_lrn(client, db):
    assert invite(client).status_code == 200

    response = invite(client, email="other@example.com")

    assert response.status_code == 409
    assert response.json()["detail"] == "Student LRN already registered"
    assert db.query(UserAccount).count() == 1


def test_manual_student_rejects_invalid_grade_level_before_insert(client, db):
    response = invite(client, grade_level=99)

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid grade level"
    assert db.query(UserAccount).count() == 0
    assert db.query(Student).count() == 0


def test_valid_manual_teacher_creation_creates_staff_profile(client, db):
    response = invite(
        client,
        role="Teacher",
        email="teacher@example.com",
        student_lrn="",
        grade_level=None,
        employment_status="Regular",
    )

    assert response.status_code == 200
    account = db.query(UserAccount).filter(UserAccount.email == "teacher@example.com").one()
    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == account.user_id).one()
    assert staff.staff_id.startswith(f"{date.today().year}-")
    assert staff.employment_status == "Regular"
    assert db.query(Student).count() == 0


def test_valid_manual_admin_creation_has_no_student_or_staff_profile(client, db):
    response = invite(client, role="Admin", email="admin@example.com", student_lrn="", grade_level=None)

    assert response.status_code == 200
    account = db.query(UserAccount).filter(UserAccount.email == "admin@example.com").one()
    assert db.query(Student).filter(Student.user_id == account.user_id).count() == 0
    assert db.query(AcademicStaff).filter(AcademicStaff.user_id == account.user_id).count() == 0
