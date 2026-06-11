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
from app.services.classes.ClassShared import ClassManagementError, class_management_error_handler


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


def add_year(db, year_label: str, active: bool) -> AcademicYear:
    year = AcademicYear(
        year_label=year_label,
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=active,
    )
    db.add(year)
    db.flush()
    return year


def add_level(db, name: str, grade: int) -> AcademicLevel:
    level = AcademicLevel(level_name=name, grade_level=grade)
    db.add(level)
    db.flush()
    return level


def add_account(db, role: Role, status: str = "active") -> UserAccount:
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=f"{uuid.uuid4()}@example.test",
        password_hash="hash",
        account_status=status,
    )
    db.add(account)
    db.flush()
    db.add(UserRoles(user_id=account.user_id, role_id=role.role_id))
    return account


def add_staff(
    db,
    staff_id: str,
    first_name: str,
    last_name: str,
    account: UserAccount | None,
    middle_name: str | None = None,
) -> AcademicStaff:
    staff = AcademicStaff(
        staff_id=staff_id,
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        user_id=account.user_id if account else None,
    )
    db.add(staff)
    return staff


def add_student(
    db,
    level: AcademicLevel,
    lrn: str,
    first_name: str,
    last_name: str,
    gender: str | None,
    middle_name: str | None = None,
) -> Student:
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn=lrn,
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        gender=gender,
        academic_level_id=level.academic_level_id,
    )
    db.add(student)
    db.flush()
    return student


def test_form_options_returns_409_when_no_active_year_exists(client):
    response = client.get("/api/v1/classes/form-options")

    assert response.status_code == 409
    assert response.json() == {
        "message": "Active academic year configuration is invalid.",
        "code": "active_academic_year_missing",
        "errors": [],
    }


def test_form_options_returns_409_when_multiple_active_years_exist(client, db):
    add_year(db, "2025-2026", True)
    add_year(db, "2026-2027", True)
    db.commit()

    response = client.get("/api/v1/classes/form-options")

    assert response.status_code == 409
    assert response.json()["code"] == "active_academic_year_multiple"


def test_form_options_returns_sorted_levels_and_only_eligible_sorted_advisers(client, db):
    active_year = add_year(db, "2025-2026", True)
    add_level(db, "Grade 10", 10)
    add_level(db, "Grade 7 B", 7)
    add_level(db, "grade 7 A", 7)

    teacher_role = Role(role_id=1, role_name="Teacher")
    admin_role = Role(role_id=2, role_name="Admin")
    db.add_all([teacher_role, admin_role])
    db.flush()

    active_teacher_b = add_account(db, teacher_role, "ACTIVE")
    active_teacher_a = add_account(db, teacher_role, "active")
    inactive_teacher = add_account(db, teacher_role, "inactive")
    active_admin = add_account(db, admin_role, "active")
    add_staff(db, "T-2", "Zoe", "Beta", active_teacher_b)
    add_staff(db, "T-1", "Amy", "Alpha", active_teacher_a)
    add_staff(db, "T-3", "Ian", "Inactive", inactive_teacher)
    add_staff(db, "A-1", "Ada", "Admin", active_admin)
    add_staff(db, "T-4", "Una", "Unlinked", None)
    db.commit()

    response = client.get("/api/v1/classes/form-options")

    assert response.status_code == 200
    body = response.json()
    assert body["academic_year"] == {
        "academic_year_id": active_year.academic_year_id,
        "year_label": "2025-2026",
    }
    assert [level["level_name"] for level in body["academic_levels"]] == [
        "grade 7 A",
        "Grade 7 B",
        "Grade 10",
    ]
    assert [adviser["staff_id"] for adviser in body["eligible_advisers"]] == ["T-1", "T-2"]


def test_form_options_excludes_adviser_assigned_in_active_year_only(client, db):
    active_year = add_year(db, "2025-2026", True)
    old_year = add_year(db, "2024-2025", False)
    level = add_level(db, "Grade 7", 7)
    teacher_role = Role(role_id=1, role_name="Teacher")
    db.add(teacher_role)
    db.flush()
    active_adviser = add_staff(db, "T-1", "Active", "Assigned", add_account(db, teacher_role))
    old_adviser = add_staff(db, "T-2", "Old", "Assigned", add_account(db, teacher_role))
    available_adviser = add_staff(db, "T-3", "Still", "Available", add_account(db, teacher_role))
    db.flush()
    db.add_all([
        Class(section_name="Active", adviser_staff_id=active_adviser.staff_id, academic_year_id=active_year.academic_year_id, academic_level_id=level.academic_level_id),
        Class(section_name="Old", adviser_staff_id=old_adviser.staff_id, academic_year_id=old_year.academic_year_id, academic_level_id=level.academic_level_id),
    ])
    db.commit()

    response = client.get("/api/v1/classes/form-options")

    assert response.status_code == 200
    adviser_ids = {adviser["staff_id"] for adviser in response.json()["eligible_advisers"]}
    assert active_adviser.staff_id not in adviser_ids
    assert adviser_ids == {old_adviser.staff_id, available_adviser.staff_id}


def test_unassigned_students_returns_404_for_unknown_level(client, db):
    add_year(db, "2025-2026", True)
    db.commit()

    response = client.get("/api/v1/classes/unassigned-students?academic_level_id=99")

    assert response.status_code == 404
    assert response.json()["errors"][0] == {
        "row": None,
        "field": "academic_level_id",
        "code": "academic_level_not_found",
        "message": "Academic level 99 does not exist.",
    }


def test_unassigned_students_filters_by_level_and_active_year_then_sorts(client, db):
    active_year = add_year(db, "2025-2026", True)
    previous_year = add_year(db, "2024-2025", False)
    selected_level = add_level(db, "Grade 7", 7)
    other_level = add_level(db, "Grade 8", 8)

    male_b = add_student(db, selected_level, "100000000001", "Ben", "Baker", "M", None)
    male_a = add_student(db, selected_level, "100000000002", "Adam", "Able", "boy", "Zed")
    female_b = add_student(db, selected_level, "100000000003", "Beth", "Baker", "Female")
    female_a = add_student(db, selected_level, "100000000004", "Alice", "Able", "f", None)
    unknown = add_student(db, selected_level, "100000000005", "Uma", "Able", None)
    previous_only = add_student(db, selected_level, "100000000006", "Pat", "Prior", "male")
    active_assigned = add_student(db, selected_level, "100000000007", "Ann", "Assigned", "female")
    add_student(db, other_level, "100000000008", "Other", "Level", "male")

    active_class = Class(
        section_name="Active",
        academic_year_id=active_year.academic_year_id,
        academic_level_id=selected_level.academic_level_id,
    )
    previous_class = Class(
        section_name="Previous",
        academic_year_id=previous_year.academic_year_id,
        academic_level_id=selected_level.academic_level_id,
    )
    db.add_all([active_class, previous_class])
    db.flush()
    db.add_all(
        [
            StudentClass(
                student_id=active_assigned.student_id,
                class_id=active_class.class_id,
                academic_year_id=active_class.academic_year_id,
                enrollment_status="completed",
            ),
            StudentClass(
                student_id=previous_only.student_id,
                class_id=previous_class.class_id,
                academic_year_id=previous_class.academic_year_id,
                enrollment_status="enrolled",
            ),
        ]
    )
    db.commit()

    response = client.get(
        f"/api/v1/classes/unassigned-students?academic_level_id={selected_level.academic_level_id}"
    )

    assert response.status_code == 200
    students = response.json()["students"]
    assert [student["student_lrn"] for student in students] == [
        male_a.student_lrn,
        male_b.student_lrn,
        previous_only.student_lrn,
        female_a.student_lrn,
        female_b.student_lrn,
        unknown.student_lrn,
    ]
    assert students[1]["middle_name"] is None
    assert students[-1]["gender"] is None


def test_non_admin_cannot_access_either_endpoint(client):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    form_options = client.get("/api/v1/classes/form-options")
    unassigned = client.get("/api/v1/classes/unassigned-students?academic_level_id=1")

    assert form_options.status_code == 403
    assert unassigned.status_code == 403


def test_unauthenticated_request_cannot_access_either_endpoint(client):
    del client.app.dependency_overrides[get_current_user]

    form_options = client.get("/api/v1/classes/form-options")
    unassigned = client.get("/api/v1/classes/unassigned-students?academic_level_id=1")

    assert form_options.status_code == 401
    assert unassigned.status_code == 401
