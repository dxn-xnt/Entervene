import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
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
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.academic.AcademicLifecycleService import (
    activate_academic_period,
    activate_academic_year,
)


@pytest.fixture
def student_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = Session(engine, autoflush=False)

    # 1. Base academic structure
    year_current = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=True,
    )
    year_future = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=False,
    )
    db.add_all([year_current, year_future])
    db.flush()

    period_t1 = AcademicPeriod(
        academic_year_id=year_current.academic_year_id,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2025, 8, 1),
        end_date=date(2025, 11, 15),
        is_active=True,
    )
    period_t2 = AcademicPeriod(
        academic_year_id=year_current.academic_year_id,
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date(2025, 11, 16),
        end_date=date(2026, 2, 15),
        is_active=False,
    )
    period_future_t1 = AcademicPeriod(
        academic_year_id=year_future.academic_year_id,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2026, 8, 1),
        end_date=date(2026, 11, 15),
        is_active=False,
    )
    db.add_all([period_t1, period_t2, period_future_t1])

    # 2. Grading template & Level
    grading_tpl = GradingTemplate(
        template_name="Default Core Template",
        passing_threshold=Decimal("75.0"),
    )
    db.add(grading_tpl)
    db.flush()

    level = AcademicLevel(level_name="Grade 10", grade_level=10)
    db.add(level)
    db.flush()

    # 3. Staff & Subject
    staff_user = UserAccount(email="teacher@example.test", password_hash="hash")
    db.add(staff_user)
    db.flush()

    staff = AcademicStaff(
        staff_id="STAFF001",
        user_id=staff_user.user_id,
        first_name="Maria",
        last_name="Santos",
    )
    db.add(staff)

    subject_math = Subject(
        subject_name="Mathematics 10",
        subject_codename="MATH10",
        academic_level_id=level.academic_level_id,
        grading_template_id=grading_tpl.grading_template_id,
    )
    subject_sci = Subject(
        subject_name="Science 10",
        subject_codename="SCI10",
        academic_level_id=level.academic_level_id,
        grading_template_id=grading_tpl.grading_template_id,
    )
    db.add_all([subject_math, subject_sci])
    db.flush()

    # 4. Class & SubjectLoads
    class_curr = Class(
        section_name="Rizal",
        academic_year_id=year_current.academic_year_id,
        academic_level_id=level.academic_level_id,
        class_status="active",
        adviser_staff_id=staff.staff_id,
    )
    db.add(class_curr)
    db.flush()

    load_math_t1 = SubjectLoad(
        class_id=class_curr.class_id,
        subject_id=subject_math.subject_id,
        staff_id=staff.staff_id,
        academic_period_id=period_t1.academic_period_id,
        status="published",
    )
    load_sci_t2 = SubjectLoad(
        class_id=class_curr.class_id,
        subject_id=subject_sci.subject_id,
        staff_id=staff.staff_id,
        academic_period_id=period_t2.academic_period_id,
        status="published",
    )
    db.add_all([load_math_t1, load_sci_t2])

    # 5. Student & Enrollment
    student_user = UserAccount(email="student@example.test", password_hash="hash")
    db.add(student_user)
    db.flush()

    student = Student(
        student_id=uuid.uuid4(),
        user_id=student_user.user_id,
        student_lrn="123456789012",
        first_name="Juan",
        last_name="Dela Cruz",
        gender="Male",
    )
    db.add(student)
    db.flush()

    enrollment = StudentClass(
        student_id=student.student_id,
        class_id=class_curr.class_id,
        academic_year_id=year_current.academic_year_id,
        enrollment_status="enrolled",
    )
    db.add(enrollment)
    db.commit()

    identity = {"sub": str(student_user.user_id), "role": "student"}

    api = FastAPI()
    api.include_router(students_router, prefix="/api/v1/students")
    api.dependency_overrides[get_db] = lambda: db
    api.dependency_overrides[get_current_user] = lambda: identity

    with TestClient(api) as client:
        yield {
            "db": db,
            "client": client,
            "identity": identity,
            "student": student,
            "student_user": student_user,
            "year_current": year_current,
            "year_future": year_future,
            "period_t1": period_t1,
            "period_t2": period_t2,
            "period_future_t1": period_future_t1,
            "load_math_t1": load_math_t1,
            "load_sci_t2": load_sci_t2,
            "class_curr": class_curr,
        }

    db.close()
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_active_period_returns_verified_metadata(student_context):
    c = student_context
    resp = c["client"].get("/api/v1/students/me/active-period")
    assert resp.status_code == 200
    body = resp.json()
    assert body["period_id"] == c["period_t1"].academic_period_id
    assert body["period_name"] == "Term 1"
    assert body["period_type"] == "TERM"
    assert body["period_sequence"] == 1
    assert body["total_periods_in_year"] == 3
    assert body["period_progress_ratio"] == "0.3333"
    assert body["is_active"] is True
    assert body["year_label"] == "2025-2026"

    # Verify backward-compatible alias
    alias_resp = c["client"].get("/api/v1/students/me/active-quarter")
    assert alias_resp.status_code == 200
    assert alias_resp.json() == body


def test_active_period_returns_empty_when_no_active_period_configured(student_context):
    c = student_context
    # Deactivate period_t1
    p1 = c["db"].get(AcademicPeriod, c["period_t1"].academic_period_id)
    p1.is_active = False
    c["db"].commit()

    resp = c["client"].get("/api/v1/students/me/active-period")
    assert resp.status_code == 200
    body = resp.json()
    assert body["period_id"] is None
    assert body["period_name"] == "No active period"
    assert body["is_active"] is False
    assert body["year_label"] == ""


def test_active_period_raises_409_on_corrupt_multiple_periods(student_context):
    c = student_context
    # Activate period_t2 as well (inconsistent state)
    p2 = c["db"].get(AcademicPeriod, c["period_t2"].academic_period_id)
    p2.is_active = True
    c["db"].commit()

    resp = c["client"].get("/api/v1/students/me/active-period")
    assert resp.status_code == 409
    assert "multiple grading periods are active" in resp.json()["detail"]


def test_active_period_raises_409_on_period_in_inactive_year(student_context):
    c = student_context
    # Deactivate t1, activate future_t1 (in inactive future year)
    p1 = c["db"].get(AcademicPeriod, c["period_t1"].academic_period_id)
    p1.is_active = False
    pf = c["db"].get(AcademicPeriod, c["period_future_t1"].academic_period_id)
    pf.is_active = True
    c["db"].commit()

    resp = c["client"].get("/api/v1/students/me/active-period")
    assert resp.status_code == 409
    assert "not in the active academic year" in resp.json()["detail"]


def test_active_period_reflects_lifecycle_switching(student_context):
    c = student_context
    # 1. Switch period to Term 2 within 2025-2026
    activate_academic_period(c["db"], academic_period_id=c["period_t2"].academic_period_id)

    resp = c["client"].get("/api/v1/students/me/active-period")
    assert resp.status_code == 200
    assert resp.json()["period_id"] == c["period_t2"].academic_period_id
    assert resp.json()["period_sequence"] == 2
    assert resp.json()["year_label"] == "2025-2026"

    # 2. Switch year to 2026-2027
    activate_academic_year(c["db"], academic_year_id=c["year_future"].academic_year_id)

    resp = c["client"].get("/api/v1/students/me/active-period")
    assert resp.status_code == 200
    assert resp.json()["period_id"] == c["period_future_t1"].academic_period_id
    assert resp.json()["period_sequence"] == 1
    assert resp.json()["year_label"] == "2026-2027"


def test_student_subjects_marks_only_verified_active_period(student_context):
    c = student_context
    resp = c["client"].get("/api/v1/students/me/subjects")
    assert resp.status_code == 200
    subjects = resp.json()
    assert len(subjects) == 2

    # Math is Term 1 (currently active)
    math = next(s for s in subjects if s["subject_name"] == "Mathematics 10")
    assert math["period_name"] == "Term 1"
    assert math["is_current_period"] is True
    assert math["is_current_quarter"] is True

    # Science is Term 2 (currently inactive)
    sci = next(s for s in subjects if s["subject_name"] == "Science 10")
    assert sci["period_name"] == "Term 2"
    assert sci["is_current_period"] is False
    assert sci["is_current_quarter"] is False

    # Switch active period to Term 2
    activate_academic_period(c["db"], academic_period_id=c["period_t2"].academic_period_id)

    resp2 = c["client"].get("/api/v1/students/me/subjects")
    assert resp2.status_code == 200
    subjects2 = resp2.json()
    math2 = next(s for s in subjects2 if s["subject_name"] == "Mathematics 10")
    sci2 = next(s for s in subjects2 if s["subject_name"] == "Science 10")
    assert math2["is_current_period"] is False
    assert sci2["is_current_period"] is True


def test_student_subjects_explicit_historical_filter_preserves_selection(student_context):
    c = student_context
    # Explicitly request Term 2
    resp = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_t2'].academic_period_id}"
    )
    assert resp.status_code == 200
    subjects = resp.json()
    assert len(subjects) == 1
    assert subjects[0]["subject_name"] == "Science 10"
    assert subjects[0]["period_name"] == "Term 2"
    # While Term 1 is active, this historical/selected period must be is_current_period=False
    assert subjects[0]["is_current_period"] is False


def test_student_subjects_raises_409_on_inconsistent_lifecycle(student_context):
    c = student_context
    # Corrupt database state: activate both periods
    p2 = c["db"].get(AcademicPeriod, c["period_t2"].academic_period_id)
    p2.is_active = True
    c["db"].commit()

    resp = c["client"].get("/api/v1/students/me/subjects")
    assert resp.status_code == 409
    assert "multiple grading periods are active" in resp.json()["detail"]


def test_teacher_and_admin_can_access_me_active_period(student_context):
    c = student_context
    # Teacher identity
    c["identity"]["role"] = "teacher"
    c["identity"]["sub"] = str(uuid.uuid4())

    resp = c["client"].get("/api/v1/students/me/active-period")
    assert resp.status_code == 200
    assert resp.json()["period_id"] == c["period_t1"].academic_period_id
    assert resp.json()["is_active"] is True
