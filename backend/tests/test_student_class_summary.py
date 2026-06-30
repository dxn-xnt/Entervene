import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Students import router as students_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassService import build_student_class_assignment


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    AcademicPeriod.__table__,
    Student.__table__,
    Class.__table__,
    StudentClass.__table__,
]


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, connection_record):
        connection.execute("PRAGMA foreign_keys=ON")

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
def identity():
    return {"sub": str(uuid.uuid4()), "role": "student"}


@pytest.fixture
def client(db, identity):
    test_app = FastAPI()
    test_app.include_router(students_router, prefix="/api/v1/students")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def add_year(db, label: str = "2025-2026") -> AcademicYear:
    year = AcademicYear(
        year_label=label,
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()
    return year


def add_level(db) -> AcademicLevel:
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level)
    db.flush()
    return level


def add_account(db, email: str) -> UserAccount:
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=email,
        password_hash="secret",
        account_status="active",
    )
    db.add(account)
    db.flush()
    return account


def add_staff(db, staff_id: str = "T-1") -> AcademicStaff:
    account = add_account(db, f"{staff_id}@example.test")
    staff = AcademicStaff(
        staff_id=staff_id,
        first_name="Joselito",
        last_name="Manalo",
        user_id=account.user_id,
    )
    db.add(staff)
    db.flush()
    return staff


def add_student(db, level: AcademicLevel, lrn: str, first_name: str, last_name: str, *, user_id=None, gender="Male") -> Student:
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn=lrn,
        first_name=first_name,
        last_name=last_name,
        gender=gender,
        academic_level_id=level.academic_level_id,
        user_id=user_id,
    )
    db.add(student)
    db.flush()
    return student


def seed_class(db, identity, *, archived=False):
    year = add_year(db)
    level = add_level(db)
    adviser = add_staff(db)
    class_ = Class(
        section_name="Galileo",
        class_status="archived" if archived else "active",
        adviser_staff_id=adviser.staff_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.flush()
    account = add_account(db, "student@example.test")
    identity["sub"] = str(account.user_id)
    current_student = add_student(db, level, "100000000001", "Alex", "Learner", user_id=account.user_id)
    classmates = [
        add_student(db, level, "100000000002", "Carlos", "Santos", gender="Male"),
        add_student(db, level, "100000000003", "Bea", "Aquino", gender="Female"),
    ]
    db.add(build_student_class_assignment(current_student.student_id, class_))
    for classmate in classmates:
        db.add(build_student_class_assignment(classmate.student_id, class_))
    db.commit()
    return class_, current_student, classmates


def test_student_can_fetch_own_class_summary(client, db, identity):
    class_, _, _ = seed_class(db, identity)

    response = client.get("/api/v1/students/me/class")

    assert response.status_code == 200
    assert response.json() == {
        "class_id": class_.class_id,
        "grade_level": "Grade 7",
        "section_name": "Galileo",
        "academic_year": "2025-2026",
        "adviser_name": "Joselito Manalo",
        "classmate_count": 2,
    }


def test_student_can_fetch_only_own_classmates(client, db, identity):
    class_, current_student, _ = seed_class(db, identity)

    response = client.get("/api/v1/students/me/classmates")

    assert response.status_code == 200
    body = response.json()
    assert body["class_id"] == class_.class_id
    assert body["section_name"] == "Galileo"
    assert [item["full_name"] for item in body["classmates"]] == ["Aquino, Bea", "Santos, Carlos"]
    assert str(current_student.student_id) not in {item["student_id"] for item in body["classmates"]}
    assert all("email" not in item for item in body["classmates"])


def test_student_with_no_class_gets_safe_404(client, db, identity):
    level = add_level(db)
    account = add_account(db, "student@example.test")
    identity["sub"] = str(account.user_id)
    add_student(db, level, "100000000001", "Alex", "Learner", user_id=account.user_id)
    db.commit()

    response = client.get("/api/v1/students/me/class")

    assert response.status_code == 404
    assert response.json()["detail"] == "Student class not found"


def test_archived_class_is_ignored(client, db, identity):
    seed_class(db, identity, archived=True)

    response = client.get("/api/v1/students/me/class")

    assert response.status_code == 404
    assert response.json()["detail"] == "Student class not found"


def test_active_period_routes_return_active_term_one(client, db):
    year = add_year(db)
    period = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        academic_year_id=year.academic_year_id,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        is_active=True,
    )
    db.add(period)
    db.commit()

    old_response = client.get("/api/v1/students/me/active-quarter")
    new_response = client.get("/api/v1/students/me/active-period")

    assert old_response.status_code == 200
    assert new_response.status_code == 200
    assert old_response.json() == new_response.json()
    body = new_response.json()
    assert body["period_name"] == "Term 1"
    assert body["period_type"] == "TERM"
    assert body["period_sequence"] == 1
    assert body["total_periods_in_year"] == 3
    assert body["period_progress_ratio"] == "0.3333"
    assert body["is_active"] is True


def test_non_student_cannot_fetch_student_class(client, identity):
    identity["role"] = "teacher"

    response = client.get("/api/v1/students/me/class")

    assert response.status_code == 403
