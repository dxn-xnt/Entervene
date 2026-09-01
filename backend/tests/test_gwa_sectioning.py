import io
import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classes import router as classes_router
from app.api.v1.routes.Users import router as users_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.auth.InvitationToken import InvitationToken
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassService import build_student_class_assignment
from app.services.classes.StudentDistributionService import (
    distribute_students_balanced,
    resolve_student_gwa,
)
from app.services.users.UserQueryService import get_user_detail, list_users


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)

    session = sessionmaker(bind=engine)()
    session.add_all([
        Role(role_id=1, role_name="Admin"),
        Role(role_id=2, role_name="Teacher"),
        Role(role_id=3, role_name="Student"),
        AcademicLevel(academic_level_id=1, level_name="Grade 7", grade_level=7),
        AcademicLevel(academic_level_id=2, level_name="Grade 8", grade_level=8),
        AcademicYear(
            academic_year_id=1,
            year_label="2024-2025",
            start_date=date(2024, 6, 1),
            end_date=date(2025, 3, 31),
            is_active=False,
        ),
        AcademicYear(
            academic_year_id=2,
            year_label="2025-2026",
            start_date=date(2025, 6, 1),
            end_date=date(2026, 3, 31),
            is_active=True,
        ),
    ])
    session.commit()
    yield session
    session.close()


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(classes_router, prefix="/api/v1/classes")
    app.include_router(users_router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
        "email": "admin@example.com",
    }
    return TestClient(app)


def _make_student(db, first_name, last_name, gender, prior_gwa=None, lrn="123456789012"):
    s_id = uuid.uuid4()
    student = Student(
        student_id=s_id,
        first_name=first_name,
        last_name=last_name,
        gender=gender,
        student_lrn=f"{lrn[:8]}{s_id.hex[:4]}",
        academic_level_id=2,
        prior_gwa=Decimal(str(prior_gwa)) if prior_gwa is not None else None,
    )
    db.add(student)
    db.commit()
    return student


# 1. test_gwa_sorting_all_students_ranked: Descending GWA sort within each gender group
def test_gwa_sorting_all_students_ranked(db):
    m1 = _make_student(db, "Adam", "Low", "Male", prior_gwa=75.00)
    m2 = _make_student(db, "Brian", "High", "Male", prior_gwa=95.00)
    m3 = _make_student(db, "Carl", "Mid", "Male", prior_gwa=85.00)

    f1 = _make_student(db, "Diana", "Low", "Female", prior_gwa=78.00)
    f2 = _make_student(db, "Eva", "High", "Female", prior_gwa=98.00)

    sections = ["sec_a", "sec_b"]
    unassigned = [m1.student_id, m2.student_id, m3.student_id, f1.student_id, f2.student_id]
    current = {"sec_a": [], "sec_b": []}

    res = distribute_students_balanced(db, 2, sections, unassigned, current, mode="gwa")

    # Both sections should have balanced counts (total 5: 3 and 2)
    assert len(res["sec_a"]) + len(res["sec_b"]) == 5
    # Males: Highest (m2=95) goes to sec_a, 2nd (m3=85) goes to sec_b, 3rd (m1=75) goes to sec_a
    # Females: Highest (f2=98) goes to sec_b (lowest female count=0), 2nd (f1=78) goes to sec_a
    assert str(m2.student_id) in res["sec_a"]
    assert str(m3.student_id) in res["sec_b"]
    assert str(m1.student_id) in res["sec_a"]


# 2. test_gwa_sorting_mixed_with_nulls: Null-GWA students sort after ranked students, alphabetically among themselves
def test_gwa_sorting_mixed_with_nulls(db):
    m1 = _make_student(db, "Zack", "Ranked", "Male", prior_gwa=80.00)
    m2 = _make_student(db, "Aaron", "NullGWA", "Male", prior_gwa=None)
    m3 = _make_student(db, "Ben", "NullGWA", "Male", prior_gwa=None)

    sections = ["sec_a", "sec_b"]
    unassigned = [m2.student_id, m3.student_id, m1.student_id]
    current = {"sec_a": [], "sec_b": []}

    res = distribute_students_balanced(db, 2, sections, unassigned, current, mode="gwa")

    # Ranked m1 placed first -> sec_a. Then Aaron (m2) -> sec_b, then Ben (m3) -> sec_a
    assert str(m1.student_id) in res["sec_a"]
    assert str(m2.student_id) in res["sec_b"]
    assert str(m3.student_id) in res["sec_a"]


# 3. test_gwa_sorting_all_nulls: Output produces exact, byte-identical ordering and section assignments to standard alphabetical distribution
def test_gwa_sorting_all_nulls(db):
    m1 = _make_student(db, "Charlie", "Brown", "Male", prior_gwa=None)
    m2 = _make_student(db, "Alice", "Brown", "Male", prior_gwa=None)
    f1 = _make_student(db, "Lucy", "VanPelt", "Female", prior_gwa=None)
    f2 = _make_student(db, "Sally", "Brown", "Female", prior_gwa=None)

    sections = ["sec_1", "sec_2"]
    unassigned = [m1.student_id, m2.student_id, f1.student_id, f2.student_id]
    current = {"sec_1": [], "sec_2": []}

    res_alpha = distribute_students_balanced(db, 2, sections, unassigned, current, mode="alphabetical")
    res_gwa = distribute_students_balanced(db, 2, sections, unassigned, current, mode="gwa")

    assert res_alpha == res_gwa


# 4. test_gwa_sorting_tied_gwa: Alphabetical fallback when GWA values are equal
def test_gwa_sorting_tied_gwa(db):
    m1 = _make_student(db, "Zack", "Smith", "Male", prior_gwa=90.00)
    m2 = _make_student(db, "Adam", "Smith", "Male", prior_gwa=90.00)

    sections = ["sec_a", "sec_b"]
    unassigned = [m1.student_id, m2.student_id]
    current = {"sec_a": [], "sec_b": []}

    res = distribute_students_balanced(db, 2, sections, unassigned, current, mode="gwa")

    # Adam (m2) alphabetically before Zack (m1) -> m2 assigned first to sec_a, m1 to sec_b
    assert str(m2.student_id) in res["sec_a"]
    assert str(m1.student_id) in res["sec_b"]


# 5. test_prior_year_gwa_resolution: Arithmetic mean across subjects for previous year with mixed period counts
def test_prior_year_gwa_resolution(db):
    student = _make_student(db, "John", "Doe", "Male", prior_gwa=None)
    # Create prior year class
    prior_class = Class(
        class_id=101,
        section_name="Grade 7 - Pearl",
        academic_level_id=1,
        academic_year_id=1,  # prior year (2024-2025)
        class_status="archived",
    )
    db.add(prior_class)
    db.add(build_student_class_assignment(student.student_id, prior_class))

    # Subjects: Math (id 1) with 2 quarters (80, 90 -> avg 85), Science (id 2) with 1 quarter (95 -> avg 95)
    sub1 = Subject(subject_id=1, subject_name="Math", academic_level_id=1)
    sub2 = Subject(subject_id=2, subject_name="Science", academic_level_id=1)
    db.add_all([sub1, sub2])

    p1 = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Q1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2024, 6, 1),
        end_date=date(2024, 8, 31),
    )
    p2 = AcademicPeriod(
        academic_period_id=2,
        academic_year_id=1,
        period_name="Q2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date(2024, 9, 1),
        end_date=date(2024, 11, 30),
    )
    db.add_all([p1, p2])

    db.add_all([
        StudentPeriodGrade(period_grade_id=1, student_id=student.student_id, class_id=101, subject_id=1, academic_period_id=1, final_period_grade=Decimal("80.00")),
        StudentPeriodGrade(period_grade_id=2, student_id=student.student_id, class_id=101, subject_id=1, academic_period_id=2, final_period_grade=Decimal("90.00")),
        StudentPeriodGrade(period_grade_id=3, student_id=student.student_id, class_id=101, subject_id=2, academic_period_id=1, final_period_grade=Decimal("95.00")),
    ])
    db.commit()

    # Math avg = 85.0, Science avg = 95.0 -> GWA = (85 + 95) / 2 = 90.0
    computed_gwa = resolve_student_gwa(db, student, active_academic_year_id=2)
    assert computed_gwa == 90.0


# 6. test_partial_completion_gwa: Student with 2 of 5 subjects finalized gets computed GWA from those 2 — does not fall back to prior_gwa or null
def test_partial_completion_gwa(db):
    student = _make_student(db, "Maria", "Clara", "Female", prior_gwa=75.00)
    prior_class = Class(
        class_id=102,
        section_name="Grade 7 - Diamond",
        academic_level_id=1,
        academic_year_id=1,
        class_status="archived",
    )
    db.add(prior_class)
    db.add(build_student_class_assignment(student.student_id, prior_class))

    sub1 = Subject(subject_id=10, subject_name="English", academic_level_id=1)
    sub2 = Subject(subject_id=11, subject_name="Filipino", academic_level_id=1)
    db.add_all([sub1, sub2])

    p1 = AcademicPeriod(
        academic_period_id=10,
        academic_year_id=1,
        period_name="Q1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2024, 6, 1),
        end_date=date(2024, 8, 31),
    )
    db.add(p1)

    # Graded only in English (88) and Filipino (92) -> mean = 90.00
    db.add_all([
        StudentPeriodGrade(period_grade_id=10, student_id=student.student_id, class_id=102, subject_id=10, academic_period_id=10, final_period_grade=Decimal("88.00")),
        StudentPeriodGrade(period_grade_id=11, student_id=student.student_id, class_id=102, subject_id=11, academic_period_id=10, final_period_grade=Decimal("92.00")),
    ])
    db.commit()

    # Must resolve to 90.00, NOT fall back to prior_gwa (75.00)
    computed_gwa = resolve_student_gwa(db, student, active_academic_year_id=2)
    assert computed_gwa == 90.00


# 7. test_prior_gwa_csv_import: Importing students with valid, invalid (out of range), and missing general_average values
def test_prior_gwa_csv_import(client, db):
    csv_content = (
        "first_name,last_name,email,student_lrn,gender,grade_level,general_average\n"
        "Valid,Student,valid.student@test.com,111111111111,Male,7,89.50\n"
        "NoGWA,Student,nogwa.student@test.com,222222222222,Female,7,\n"
        "LowGWA,Student,lowgwa.student@test.com,333333333333,Male,7,55.00\n"
    )

    response = client.post(
        "/api/v1/users/upload-csv",
        params={"role": "Student"},
        files={"file": ("students.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
    )

    # Phase 1 validation should catch the row with GWA 55.00
    assert response.status_code == 422
    data = response.json()
    errors = data.get("detail", {}).get("errors", []) if isinstance(data.get("detail"), dict) else data.get("errors", [])
    assert any("General average must be between 60.00 and 100.00" in err.get("reason", "") for err in errors)


# 8. test_distribute_endpoint_read_only: POST /api/v1/classes/distribute-students returns a mapping and creates zero StudentClass rows
def test_distribute_endpoint_read_only(client, db):
    s1 = _make_student(db, "Alpha", "One", "Male", prior_gwa=85.00)
    s2 = _make_student(db, "Beta", "Two", "Female", prior_gwa=90.00)

    initial_assignments_count = db.query(StudentClass).count()

    payload = {
        "academic_level_id": 2,
        "mode": "gwa",
        "sections": [
            {"local_id": "sec_1", "section_name": "Section 1"},
            {"local_id": "sec_2", "section_name": "Section 2"},
        ],
        "unassigned_student_ids": [str(s1.student_id), str(s2.student_id)],
        "assignments_by_section": {"sec_1": [], "sec_2": []},
    }

    res = client.post("/api/v1/classes/distribute-students", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert "assignments_by_section" in body
    assert len(body["assignments_by_section"]["sec_1"]) + len(body["assignments_by_section"]["sec_2"]) == 2

    # Zero database rows should be created
    assert db.query(StudentClass).count() == initial_assignments_count


# 9. test_prior_gwa_not_in_list_users: prior_gwa does not appear in the list_users response
def test_prior_gwa_not_in_list_users(db):
    u_id = uuid.uuid4()
    account = UserAccount(user_id=u_id, email="student.list@test.com", password_hash="hash", account_status="active")
    db.add(account)
    db.add(UserRoles(user_id=u_id, role_id=3))
    student = Student(
        student_id=uuid.uuid4(),
        user_id=u_id,
        first_name="List",
        last_name="Test",
        gender="Male",
        student_lrn="999999999999",
        academic_level_id=1,
        prior_gwa=Decimal("92.50"),
    )
    db.add(student)
    db.commit()

    users = list_users(db, role="student")
    student_user = next((u for u in users if u["id"] == str(u_id)), None)
    assert student_user is not None
    assert "prior_gwa" not in student_user


# 10. test_prior_gwa_in_user_detail: prior_gwa appears in get_user_detail for student users
def test_prior_gwa_in_user_detail(db):
    u_id = uuid.uuid4()
    account = UserAccount(user_id=u_id, email="student.detail@test.com", password_hash="hash", account_status="active")
    db.add(account)
    db.add(UserRoles(user_id=u_id, role_id=3))
    student = Student(
        student_id=uuid.uuid4(),
        user_id=u_id,
        first_name="Detail",
        last_name="Test",
        gender="Male",
        student_lrn="888888888888",
        academic_level_id=1,
        prior_gwa=Decimal("87.50"),
    )
    db.add(student)
    db.commit()

    detail = get_user_detail(db, u_id)
    assert detail["prior_gwa"] == 87.50
    assert detail["has_computed_gwa"] is False


# 11. test_computed_gwa_overrides_prior_gwa: Student has both a computed prior-year average AND a prior_gwa value on file -> resolve_student_gwa returns computed one
def test_computed_gwa_overrides_prior_gwa(db):
    student = _make_student(db, "Override", "Test", "Female", prior_gwa=72.00)
    prior_class = Class(
        class_id=103,
        section_name="Grade 7 - Emerald",
        academic_level_id=1,
        academic_year_id=1,
        class_status="archived",
    )
    db.add(prior_class)
    db.add(build_student_class_assignment(student.student_id, prior_class))

    sub = Subject(subject_id=20, subject_name="History", academic_level_id=1)
    db.add(sub)
    p = AcademicPeriod(
        academic_period_id=20,
        academic_year_id=1,
        period_name="Q1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2024, 6, 1),
        end_date=date(2024, 8, 31),
    )
    db.add(p)
    db.add(StudentPeriodGrade(period_grade_id=30, student_id=student.student_id, class_id=103, subject_id=20, academic_period_id=20, final_period_grade=Decimal("94.00")))
    db.commit()

    # Computed grade is 94.00, prior_gwa is 72.00 -> must return 94.00
    gwa = resolve_student_gwa(db, student, active_academic_year_id=2)
    assert gwa == 94.00


# 12. test_prior_gwa_used_when_no_computed_grades: Student has no StudentPeriodGrade rows but has prior_gwa set -> resolve_student_gwa returns prior_gwa
def test_prior_gwa_used_when_no_computed_grades(db):
    student = _make_student(db, "Transferee", "Student", "Male", prior_gwa=88.50)
    gwa = resolve_student_gwa(db, student, active_academic_year_id=2)
    assert gwa == 88.50
