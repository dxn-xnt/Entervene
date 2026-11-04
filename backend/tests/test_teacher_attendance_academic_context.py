import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-12345678901234567890")

import uuid
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.main import app
from app.db.Base import Base
from app.db.Session import get_db
from app.core.Security import create_access_token
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.attendance.Attendance import AttendanceRecord
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


@pytest.fixture
def attendance_db():
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
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(attendance_db):
    app.dependency_overrides[get_db] = lambda: attendance_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def attendance_world(attendance_db):
    db = attendance_db

    # 1. Academic Years
    year_hist = AcademicYear(
        academic_year_id=1,
        year_label="2024-2025",
        start_date=date(2024, 8, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    year_active = AcademicYear(
        academic_year_id=2,
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=True,
    )
    year_future = AcademicYear(
        academic_year_id=3,
        year_label="2027-2028",
        start_date=date(2027, 8, 1),
        end_date=date(2028, 5, 31),
        is_active=False,
    )
    year_unauth = AcademicYear(
        academic_year_id=4,
        year_label="2023-2024",
        start_date=date(2023, 8, 1),
        end_date=date(2024, 5, 31),
        is_active=False,
    )
    db.add_all([year_hist, year_active, year_future, year_unauth])
    db.flush()

    # 2. Academic Periods
    period_hist = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Quarter 1 (2024-2025)",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        start_date=date(2024, 8, 1),
        end_date=date(2024, 10, 31),
        is_active=False,
    )
    period_active = AcademicPeriod(
        academic_period_id=2,
        academic_year_id=2,
        period_name="Quarter 1 (2025-2026)",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        start_date=date(2025, 8, 1),
        end_date=date(2025, 10, 31),
        is_active=True,
    )
    period_future = AcademicPeriod(
        academic_period_id=3,
        academic_year_id=3,
        period_name="Quarter 1 (2027-2028)",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        start_date=date(2027, 8, 1),
        end_date=date(2027, 10, 31),
        is_active=False,
    )
    period_unauth = AcademicPeriod(
        academic_period_id=4,
        academic_year_id=4,
        period_name="Quarter 1 (2023-2024)",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        start_date=date(2023, 8, 1),
        end_date=date(2023, 10, 31),
        is_active=False,
    )
    db.add_all([period_hist, period_active, period_future, period_unauth])
    db.flush()

    # 3. Academic Level
    level = AcademicLevel(academic_level_id=1, level_name="Grade 10", grade_level=10)
    db.add(level)
    db.flush()

    # 4. Users & Staff
    user_teacher1_id = uuid.uuid4()
    teacher1_user = UserAccount(user_id=user_teacher1_id, email="teacher1@example.com", account_status="active")
    teacher1 = AcademicStaff(staff_id="TCH-001", user_id=user_teacher1_id, first_name="T1", last_name="Teacher")

    user_teacher2_id = uuid.uuid4()
    teacher2_user = UserAccount(user_id=user_teacher2_id, email="teacher2@example.com", account_status="active")
    teacher2 = AcademicStaff(staff_id="TCH-002", user_id=user_teacher2_id, first_name="T2", last_name="Teacher")

    user_admin_id = uuid.uuid4()
    admin_user = UserAccount(user_id=user_admin_id, email="admin@example.com", account_status="active")

    db.add_all([teacher1_user, teacher1, teacher2_user, teacher2, admin_user])
    db.flush()

    # 5. Classes
    class_active = Class(
        class_id=10,
        academic_year_id=2,
        academic_level_id=1,
        section_name="Active Section",
        adviser_staff_id=teacher1.staff_id,
        class_status="active",
    )
    class_hist = Class(
        class_id=20,
        academic_year_id=1,
        academic_level_id=1,
        section_name="Hist Section",
        adviser_staff_id=teacher1.staff_id,
        class_status="archived",
    )
    class_future = Class(
        class_id=30,
        academic_year_id=3,
        academic_level_id=1,
        section_name="Future Section",
        adviser_staff_id=teacher1.staff_id,
        class_status="active",
    )
    class_unauth = Class(
        class_id=40,
        academic_year_id=4,
        academic_level_id=1,
        section_name="Unauth Section",
        adviser_staff_id=teacher2.staff_id,
        class_status="archived",
    )
    db.add_all([class_active, class_hist, class_future, class_unauth])
    db.flush()

    # 6. Students & Enrollments
    s1_id = uuid.uuid4()
    s1_user = UserAccount(user_id=uuid.uuid4(), email="s1@example.com", account_status="active")
    s1 = Student(student_id=s1_id, user_id=s1_user.user_id, first_name="Student", last_name="One", student_lrn="100000000001")

    db.add_all([s1_user, s1])
    db.flush()

    db.add_all([
        StudentClass(student_id=s1.student_id, class_id=10, academic_year_id=2, enrollment_status="enrolled"),
        StudentClass(student_id=s1.student_id, class_id=20, academic_year_id=1, enrollment_status="enrolled"),
        StudentClass(student_id=s1.student_id, class_id=30, academic_year_id=3, enrollment_status="enrolled"),
        StudentClass(student_id=s1.student_id, class_id=40, academic_year_id=4, enrollment_status="enrolled"),
    ])
    db.flush()

    # 7. Attendance Records
    rec_active = AttendanceRecord(student_id=s1.student_id, class_id=10, date=date(2025, 9, 10), status="present")
    rec_hist = AttendanceRecord(student_id=s1.student_id, class_id=20, date=date(2024, 9, 10), status="present")
    rec_future = AttendanceRecord(student_id=s1.student_id, class_id=30, date=date(2027, 9, 10), status="present")
    rec_unauth = AttendanceRecord(student_id=s1.student_id, class_id=40, date=date(2023, 9, 10), status="present")
    db.add_all([rec_active, rec_hist, rec_future, rec_unauth])
    db.commit()

    return {
        "teacher1_token": create_access_token(str(user_teacher1_id), "teacher"),
        "teacher2_token": create_access_token(str(user_teacher2_id), "teacher"),
        "admin_token": create_access_token(str(user_admin_id), "admin"),
    }


def test_teacher_attendance_active_period(client, attendance_world):
    """Teacher fetches attendance logs for an active class and period."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    res = client.get("/api/v1/attendance/class/10?academic_period_id=2&academic_year_id=2", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data) == 1
    assert data[0]["date"] == "2025-09-10"
    assert data[0]["status"] == "present"


def test_teacher_attendance_authorized_historical_period(client, attendance_world):
    """Teacher fetches attendance logs for an authorized historical class and period."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    res = client.get("/api/v1/attendance/class/20?academic_period_id=1&academic_year_id=1", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data) == 1
    assert data[0]["date"] == "2024-09-10"


def test_teacher_attendance_forbidden_future_year(client, attendance_world):
    """Teacher cannot view attendance records for a future academic year."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    res = client.get("/api/v1/attendance/class/30", headers=headers)
    assert res.status_code == 403
    assert "Not authorized to access this academic year" in res.json()["detail"]


def test_teacher_attendance_forbidden_unauthorized_historical_year(client, attendance_world):
    """Teacher cannot view attendance records for a historical year they never taught in."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    res = client.get("/api/v1/attendance/class/40", headers=headers)
    assert res.status_code == 403
    assert "Not authorized to access this academic year" in res.json()["detail"]


def test_teacher_attendance_mismatched_year_returns_400(client, attendance_world):
    """Mismatched academic_year_id query parameter and class year returns 400 Bad Request."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    res = client.get("/api/v1/attendance/class/10?academic_year_id=1", headers=headers)
    assert res.status_code == 400
    assert "Class does not belong to specified academic year" in res.json()["detail"]


def test_teacher_attendance_mismatched_period_year_returns_400(client, attendance_world):
    """Mismatched period academic year and class year returns 400 Bad Request."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    res = client.get("/api/v1/attendance/class/10?academic_period_id=1", headers=headers)
    assert res.status_code == 400
    assert "Academic class and period must belong to the same academic year" in res.json()["detail"]


def test_admin_can_access_attendance_any_year(client, attendance_world):
    """Admin can view attendance for any class including future years."""
    headers = {"Authorization": f"Bearer {attendance_world['admin_token']}"}
    res = client.get("/api/v1/attendance/class/30?academic_period_id=3&academic_year_id=3", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data) == 1
    assert data[0]["date"] == "2027-09-10"


def test_batch_mark_attendance_active_period_succeeds(client, attendance_world, attendance_db):
    """Teacher can record batch attendance in the current active period."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    student = attendance_db.query(Student).filter(Student.student_lrn == "100000000001").first()
    payload = {
        "class_id": 10,
        "academic_period_id": 2,
        "date": "2025-09-15",
        "records": [
            {
                "student_id": str(student.student_id),
                "status": "present",
                "remarks": "On time",
            }
        ],
    }
    res = client.post("/api/v1/attendance", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    records = res.json()
    assert len(records) == 1
    assert records[0]["status"] == "present"
    assert records[0]["remarks"] == "On time"


def test_batch_mark_attendance_historical_period_fails(client, attendance_world, attendance_db):
    """Writing attendance to an authorized historical period is rejected with 403 Forbidden."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    student = attendance_db.query(Student).filter(Student.student_lrn == "100000000001").first()
    payload = {
        "class_id": 20,
        "academic_period_id": 1,
        "date": "2024-09-15",
        "records": [
            {
                "student_id": str(student.student_id),
                "status": "absent",
                "remarks": "Historical attempt",
            }
        ],
    }
    res = client.post("/api/v1/attendance", json=payload, headers=headers)
    assert res.status_code == 403
    assert "read-only" in res.json()["detail"].lower()


def test_batch_mark_attendance_future_period_fails(client, attendance_world, attendance_db):
    """Writing attendance to a future academic period/year is rejected with 403 Forbidden."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher1_token']}"}
    student = attendance_db.query(Student).filter(Student.student_lrn == "100000000001").first()
    payload = {
        "class_id": 30,
        "academic_period_id": 3,
        "date": "2027-09-15",
        "records": [
            {
                "student_id": str(student.student_id),
                "status": "present",
            }
        ],
    }
    res = client.post("/api/v1/attendance", json=payload, headers=headers)
    assert res.status_code == 403


def test_batch_mark_attendance_unauthorized_teacher_fails(client, attendance_world, attendance_db):
    """Teacher with no load or advisory cannot write attendance for the active class."""
    headers = {"Authorization": f"Bearer {attendance_world['teacher2_token']}"}
    student = attendance_db.query(Student).filter(Student.student_lrn == "100000000001").first()
    payload = {
        "class_id": 10,
        "academic_period_id": 2,
        "date": "2025-09-15",
        "records": [
            {
                "student_id": str(student.student_id),
                "status": "present",
            }
        ],
    }
    res = client.post("/api/v1/attendance", json=payload, headers=headers)
    assert res.status_code == 403
    assert "not authorized" in res.json()["detail"].lower()

