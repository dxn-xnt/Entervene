import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Users import router as users_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    AcademicPeriod.__table__,
    Subject.__table__,
    Class.__table__,
    StudentClass.__table__,
    SubjectLoad.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
]


@pytest.fixture
def db_and_engine():
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
        yield session, engine
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


@pytest.fixture
def client(db_and_engine):
    db, _ = db_and_engine
    test_app = FastAPI()
    test_app.include_router(users_router, prefix="/api/v1")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def seed_users(db, pairs: int = 2):
    roles = {
        name: Role(role_id=index, role_name=name)
        for index, name in enumerate(("Admin", "Teacher", "Student"), start=1)
    }
    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([*roles.values(), year, level])
    db.flush()
    period = AcademicPeriod(
        period_name="Q1",
        period_type="QUARTER",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    db.add(period)
    db.flush()

    for index in range(pairs):
        teacher_account = UserAccount(
            user_id=uuid.uuid4(),
            email=f"teacher{index}@example.com",
            account_status="active",
        )
        student_account = UserAccount(
            user_id=uuid.uuid4(),
            email=f"student{index}@example.com",
            account_status="active",
        )
        db.add_all([teacher_account, student_account])
        db.flush()
        db.add_all([
            UserRoles(user_id=teacher_account.user_id, role_id=roles["Teacher"].role_id),
            UserRoles(user_id=student_account.user_id, role_id=roles["Student"].role_id),
        ])
        staff = AcademicStaff(
            staff_id=f"T-{index}",
            first_name=f"Teacher{index}",
            last_name="User",
            user_id=teacher_account.user_id,
        )
        student = Student(
            student_id=uuid.uuid4(),
            student_lrn=f"{index + 1:012d}",
            first_name=f"Student{index}",
            last_name="User",
            academic_level_id=level.academic_level_id,
            user_id=student_account.user_id,
        )
        db.add_all([staff, student])
        db.flush()
        old_class = Class(section_name=f"Old-{index}", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
        latest_class = Class(section_name=f"Latest-{index}", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
        subject = Subject(subject_name=f"Subject-{index}", academic_level_id=level.academic_level_id)
        db.add_all([old_class, latest_class, subject])
        db.flush()
        db.add_all([
            StudentClass(student_id=student.student_id, class_id=latest_class.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled", enrolled_at=datetime.now(timezone.utc)),
            SubjectLoad(staff_id=staff.staff_id, subject_id=subject.subject_id, class_id=latest_class.class_id, academic_period_id=period.academic_period_id, status="active"),
            SubjectLoad(staff_id=staff.staff_id, subject_id=subject.subject_id, class_id=old_class.class_id, academic_period_id=period.academic_period_id, status="active"),
        ])
        classwork = Classwork(title="Quiz", classwork_type="QUIZ", subject_id=subject.subject_id, created_by_staff_id=staff.staff_id)
        db.add(classwork)
        db.flush()
        assignment = ClassworkAssignment(classwork_id=classwork.classwork_id, class_id=latest_class.class_id, assigned_by_staff_id=staff.staff_id)
        db.add(assignment)
        db.flush()
        db.add_all([
            StudentSubmission(student_id=student.student_id, classwork_assignment_id=assignment.classwork_assignment_id, status="graded", grade=84),
            StudentSubmission(student_id=student.student_id, classwork_assignment_id=assignment.classwork_assignment_id, status="graded", grade=87),
        ])
    db.commit()


def test_list_users_batches_mixed_user_summaries_and_preserves_filters(client, db_and_engine):
    db, _ = db_and_engine
    seed_users(db)

    response = client.get("/api/v1/users")
    users_by_email = {item["email"]: item for item in response.json()}
    teacher = users_by_email["teacher0@example.com"]
    student = users_by_email["student0@example.com"]

    assert response.status_code == 200
    assert teacher["subjects"] == ["Subject-0"]
    assert teacher["class_count"] == 2
    assert student["section"] == "Latest-0"
    assert student["grade_level"] == 7
    assert student["average"] == 86
    assert set(student) == {"id", "name", "email", "role", "created_at", "account_status", "section", "grade_level", "average"}
    assert all(item["role"] == "teacher" for item in client.get("/api/v1/users?role=teacher").json())
    assert len(client.get("/api/v1/users?search=student0").json()) == 1


def test_list_users_allows_null_profile_dob(client, db_and_engine):
    db, _ = db_and_engine
    seed_users(db)

    response = client.get("/api/v1/users")

    assert response.status_code == 200
    assert any(item["email"] == "student0@example.com" for item in response.json())


def test_list_users_query_count_stays_bounded_as_results_grow(client, db_and_engine):
    db, engine = db_and_engine
    seed_users(db, pairs=4)
    statement_count = 0

    def count_statement(*args):
        nonlocal statement_count
        statement_count += 1

    event.listen(engine, "before_cursor_execute", count_statement)
    try:
        response = client.get("/api/v1/users")
    finally:
        event.remove(engine, "before_cursor_execute", count_statement)

    assert response.status_code == 200
    assert len(response.json()) == 8
    assert statement_count <= 4
