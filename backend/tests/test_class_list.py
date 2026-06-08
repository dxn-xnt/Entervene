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
from app.api.v1.routes.Classes import router as classes_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.ClassManagement import (
    ClassManagementError,
    build_student_class_assignment,
    class_management_error_handler,
)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    AcademicStaff.__table__,
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
def client(db):
    test_app = FastAPI()
    test_app.add_exception_handler(ClassManagementError, class_management_error_handler)
    test_app.include_router(classes_router, prefix="/api/v1/classes")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def add_year(db, label: str) -> AcademicYear:
    year = AcademicYear(
        year_label=label,
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()
    return year


def add_level(db, name: str, grade: int) -> AcademicLevel:
    level = AcademicLevel(level_name=name, grade_level=grade)
    db.add(level)
    db.flush()
    return level


def add_staff(db, staff_id: str) -> AcademicStaff:
    role = Role(role_id=1, role_name="Teacher")
    db.add(role)
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=f"{staff_id}@example.test",
        password_hash="super-secret-hash",
        account_status="active",
    )
    db.add(account)
    db.flush()
    db.add(UserRoles(user_id=account.user_id, role_id=role.role_id))
    staff = AcademicStaff(
        staff_id=staff_id,
        first_name="Ada",
        middle_name="Byron",
        last_name="Lovelace",
        suffix=None,
        user_id=account.user_id,
    )
    db.add(staff)
    db.flush()
    return staff


def add_student(db, level: AcademicLevel, lrn: str) -> Student:
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn=lrn,
        first_name="Student",
        last_name=lrn,
        academic_level_id=level.academic_level_id,
    )
    db.add(student)
    db.flush()
    return student


def test_list_classes_empty_database_returns_zero_totals(client):
    response = client.get("/api/v1/classes")

    assert response.status_code == 200
    assert response.json() == {
        "summary": {
            "total_classes": 0,
            "active_classes": 0,
            "archived_classes": 0,
            "students_assigned": 0,
        },
        "classes": [],
    }


def test_list_classes_returns_real_rows_counts_null_adviser_and_sorted_order(client, db):
    year = add_year(db, "2025-2026")
    grade_7 = add_level(db, "Grade 7", 7)
    grade_8 = add_level(db, "Grade 8", 8)
    adviser = add_staff(db, "T-1")

    sapphire = Class(
        section_name="Sapphire",
        class_status="active",
        adviser_staff_id=adviser.staff_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=grade_7.academic_level_id,
    )
    alpha = Class(
        section_name="Alpha",
        class_status="active",
        academic_year_id=year.academic_year_id,
        academic_level_id=grade_7.academic_level_id,
    )
    aristotle = Class(
        section_name="Aristotle",
        class_status="archived",
        academic_year_id=year.academic_year_id,
        academic_level_id=grade_8.academic_level_id,
    )
    db.add_all([sapphire, alpha, aristotle])
    db.flush()

    students = [
        add_student(db, grade_7, "100000000001"),
        add_student(db, grade_7, "100000000002"),
        add_student(db, grade_8, "100000000003"),
    ]
    db.add(build_student_class_assignment(students[0].student_id, sapphire))
    db.add(build_student_class_assignment(students[1].student_id, sapphire))
    db.add(build_student_class_assignment(students[2].student_id, aristotle))
    db.commit()

    response = client.get("/api/v1/classes")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == {
        "total_classes": 3,
        "active_classes": 2,
        "archived_classes": 1,
        "students_assigned": 3,
    }
    assert [item["section_name"] for item in body["classes"]] == ["Alpha", "Sapphire", "Aristotle"]

    alpha_item = body["classes"][0]
    assert alpha_item["adviser"] is None
    assert alpha_item["student_count"] == 0
    assert alpha_item["subject_count"] == 0

    sapphire_item = body["classes"][1]
    assert sapphire_item["class_id"] == sapphire.class_id
    assert sapphire_item["section_name"] == "Sapphire"
    assert sapphire_item["class_status"] == "active"
    assert sapphire_item["academic_year"] == {
        "academic_year_id": year.academic_year_id,
        "year_label": "2025-2026",
    }
    assert sapphire_item["academic_level"] == {
        "academic_level_id": grade_7.academic_level_id,
        "level_name": "Grade 7",
        "grade_level": 7,
    }
    assert sapphire_item["adviser"] == {
        "staff_id": adviser.staff_id,
        "first_name": "Ada",
        "middle_name": "Byron",
        "last_name": "Lovelace",
        "suffix": None,
    }
    assert sapphire_item["student_count"] == 2
    assert "password_hash" not in response.text
    assert "super-secret-hash" not in response.text


def test_list_classes_requires_admin_and_authentication(client):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    assert client.get("/api/v1/classes").status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert client.get("/api/v1/classes").status_code == 401
