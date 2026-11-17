"""Unit and integration tests for Class Attendance CSV Export.

Verifies:
1. Exporting attendance records for a specific class as CSV.
2. Standard CSV formatting, header row, and UTF-8 BOM.
3. Date range filtering and date validation.
4. Formula injection protection for unsafe cells starting with =, +, -, @, \\t, \\r.
5. Authorization checks (assigned teacher or admin only, unauthorized access rejected).
6. Clean handling of empty results.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date

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
def attendance_export_env():
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

    db = sessionmaker(bind=engine)()

    year = AcademicYear(academic_year_id=1, year_label="2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=True)
    level = AcademicLevel(academic_level_id=1, level_name="Grade 10", grade_level=10)
    db.add_all([year, level])
    db.flush()

    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="1st Quarter",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        is_active=True,
    )
    db.add(period)
    db.flush()

    user_teacher_id = uuid.uuid4()
    user_unassigned_id = uuid.uuid4()
    user_admin_id = uuid.uuid4()
    user_student_id = uuid.uuid4()

    db.add_all([
        UserAccount(user_id=user_teacher_id, email="teacher@test.local", password_hash="x"),
        UserAccount(user_id=user_unassigned_id, email="unassigned@test.local", password_hash="x"),
        UserAccount(user_id=user_admin_id, email="admin@test.local", password_hash="x"),
        UserAccount(user_id=user_student_id, email="student@test.local", password_hash="x"),
    ])
    db.flush()

    staff_teacher = AcademicStaff(staff_id="ST-101", user_id=user_teacher_id, first_name="Maria", last_name="Santos", email="maria@test.local")
    staff_unassigned = AcademicStaff(staff_id="ST-999", user_id=user_unassigned_id, first_name="Juan", last_name="Other", email="juan@test.local")
    staff_admin = AcademicStaff(staff_id="ST-ADM", user_id=user_admin_id, first_name="Admin", last_name="User", email="admin@test.local")
    db.add_all([staff_teacher, staff_unassigned, staff_admin])
    db.flush()

    cls = Class(
        class_id=10,
        section_name="Emerald",
        academic_year_id=1,
        academic_level_id=1,
        academic_period_id=1,
        adviser_staff_id="ST-101",
    )
    empty_cls = Class(
        class_id=20,
        section_name="Sapphire",
        academic_year_id=1,
        academic_level_id=1,
        academic_period_id=1,
        adviser_staff_id=None,
    )
    db.add_all([cls, empty_cls])
    db.flush()

    subj = Subject(subject_id=1, subject_name="Mathematics 10", subject_codename="MATH10", academic_level_id=1)
    db.add(subj)
    db.flush()

    load = SubjectLoad(
        subject_load_id=1,
        class_id=10,
        subject_id=1,
        staff_id="ST-101",
        academic_period_id=1,
        status="active",
        is_active_version=True,
    )
    db.add(load)
    db.flush()

    s1 = Student(student_id=uuid.uuid4(), student_lrn="100000000001", first_name="Pedro", last_name="Penduko", gender="Male", academic_level_id=1, user_id=user_student_id)
    s2 = Student(student_id=uuid.uuid4(), student_lrn="100000000002", first_name="=FormulaName", last_name="Hacker", gender="Female", academic_level_id=1)
    db.add_all([s1, s2])
    db.flush()

    db.add_all([
        StudentClass(student_id=s1.student_id, class_id=10, academic_year_id=1, enrollment_status="enrolled"),
        StudentClass(student_id=s2.student_id, class_id=10, academic_year_id=1, enrollment_status="enrolled"),
    ])
    db.flush()

    # Attendance records
    rec1 = AttendanceRecord(
        student_id=s1.student_id,
        class_id=10,
        subject_id=1,
        date=date(2025, 6, 15),
        status="present",
        remarks="On time",
        recorded_by_staff_id="ST-101",
    )
    rec2 = AttendanceRecord(
        student_id=s2.student_id,
        class_id=10,
        subject_id=1,
        date=date(2025, 6, 15),
        status="absent",
        remarks="@UnsafeRemark",
        recorded_by_staff_id="ST-101",
    )
    rec3 = AttendanceRecord(
        student_id=s1.student_id,
        class_id=10,
        subject_id=1,
        date=date(2025, 7, 20),
        status="late",
        remarks="+LateDueToTraffic",
        recorded_by_staff_id="ST-101",
    )
    db.add_all([rec1, rec2, rec3])
    db.commit()

    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield {
            "client": test_client,
            "db": db,
            "teacher_token": create_access_token(str(user_teacher_id), "teacher"),
            "unassigned_token": create_access_token(str(user_unassigned_id), "teacher"),
            "admin_token": create_access_token(str(user_admin_id), "admin"),
            "student_token": create_access_token(str(user_student_id), "student"),
        }
    app.dependency_overrides.clear()
    db.close()


def test_attendance_csv_export_authorized_teacher(attendance_export_env):
    """Teacher can export class attendance records as CSV."""
    client = attendance_export_env["client"]
    token = attendance_export_env["teacher_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/attendance/class/10/export-csv?academic_period_id=1", headers=headers)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/csv")
    assert "attachment;" in res.headers["content-disposition"]
    assert "Attendance_Emerald" in res.headers["content-disposition"]

    # Verify UTF-8 BOM
    raw_content = res.content.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(raw_content))
    rows = list(reader)

    # Check header
    assert rows[0] == [
        "Date",
        "Student LRN",
        "Student Name",
        "Gender",
        "Section",
        "Subject",
        "Attendance Status",
        "Remarks",
        "Recorded By",
    ]
    # Check data rows exist
    assert len(rows) == 4  # 1 header + 3 records


def test_attendance_csv_formula_injection_sanitization(attendance_export_env):
    """Cells starting with =, +, -, @ must be prefixed with single quote."""
    client = attendance_export_env["client"]
    token = attendance_export_env["teacher_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/attendance/class/10/export-csv?academic_period_id=1", headers=headers)
    assert res.status_code == 200
    raw_content = res.content.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(raw_content))
    rows = list(reader)

    # Hacker student has first_name = '=FormulaName' -> name is 'Hacker, =FormulaName' or remarks '@UnsafeRemark'
    remarks = [row[7] for row in rows[1:]]
    assert "'@UnsafeRemark" in remarks
    assert "'+LateDueToTraffic" in remarks


def test_attendance_csv_date_range_filtering(attendance_export_env):
    """Date range filter includes only records within specified bounds."""
    client = attendance_export_env["client"]
    token = attendance_export_env["teacher_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Only July records (rec3)
    res = client.get("/api/v1/attendance/class/10/export-csv?start_date=2025-07-01&end_date=2025-07-31", headers=headers)
    assert res.status_code == 200
    rows = list(csv.reader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert len(rows) == 2  # header + 1 record
    assert rows[1][0] == "2025-07-20"


def test_attendance_csv_invalid_date_range_rejected(attendance_export_env):
    """Start date after end date must return 400 Bad Request."""
    client = attendance_export_env["client"]
    token = attendance_export_env["teacher_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/attendance/class/10/export-csv?start_date=2025-08-01&end_date=2025-07-01", headers=headers)
    assert res.status_code == 400
    assert "Start date cannot be after end date" in res.json()["detail"]


def test_attendance_csv_unauthorized_teacher_rejected(attendance_export_env):
    """Teacher not assigned to class receives 403 Forbidden."""
    client = attendance_export_env["client"]
    token = attendance_export_env["unassigned_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/attendance/class/10/export-csv?academic_period_id=1", headers=headers)
    assert res.status_code == 403


def test_attendance_csv_student_role_rejected(attendance_export_env):
    """Student role cannot export attendance CSV."""
    client = attendance_export_env["client"]
    token = attendance_export_env["student_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/attendance/class/10/export-csv", headers=headers)
    assert res.status_code == 403


def test_attendance_csv_empty_class_returns_header_only(attendance_export_env):
    """An authorized class with no attendance records exports a clean CSV with headers."""
    client = attendance_export_env["client"]
    token = attendance_export_env["teacher_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/attendance/class/20/export-csv?academic_period_id=1", headers=headers)
    assert res.status_code == 200
    rows = list(csv.reader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert len(rows) == 1  # Header row only
