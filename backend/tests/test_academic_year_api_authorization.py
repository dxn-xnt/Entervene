from datetime import date
from decimal import Decimal
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.db.Base import Base
from app.db.Session import get_db
from app.core.Security import create_access_token
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


from sqlalchemy.pool import StaticPool


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def api_world(db):
    """Sets up:
    - hist_old (2023-2024, ID=901): Closed historical
    - hist_recent (2024-2025, ID=902): Closed historical
    - active_yr (2025-2026, ID=101): Active school year
    - future_yr (2026-2027, ID=201): Prepared future year
    """
    hist_old = AcademicYear(
        academic_year_id=901,
        year_label="2023-2024",
        start_date=date(2023, 8, 1),
        end_date=date(2024, 5, 31),
        is_active=False,
    )
    hist_recent = AcademicYear(
        academic_year_id=902,
        year_label="2024-2025",
        start_date=date(2024, 8, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    active_yr = AcademicYear(
        academic_year_id=101,
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=True,
    )
    future_yr = AcademicYear(
        academic_year_id=201,
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=False,
    )
    db.add_all([hist_old, hist_recent, active_yr, future_yr])
    db.flush()

    # Periods
    p_hist_old = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=hist_old.academic_year_id,
        period_sequence=1,
        period_name="Term 1",
        start_date=date(2023, 8, 1),
        end_date=date(2023, 11, 1),
        is_active=False,
    )
    p_hist_recent = AcademicPeriod(
        academic_period_id=2,
        academic_year_id=hist_recent.academic_year_id,
        period_sequence=1,
        period_name="Term 1",
        start_date=date(2024, 8, 1),
        end_date=date(2024, 11, 1),
        is_active=False,
    )
    p_active = AcademicPeriod(
        academic_period_id=3,
        academic_year_id=active_yr.academic_year_id,
        period_sequence=1,
        period_name="Term 1",
        start_date=date(2025, 8, 1),
        end_date=date(2025, 11, 1),
        is_active=True,
    )
    p_future = AcademicPeriod(
        academic_period_id=4,
        academic_year_id=future_yr.academic_year_id,
        period_sequence=1,
        period_name="Term 1",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 11, 1),
        is_active=False,
    )
    db.add_all([p_hist_old, p_hist_recent, p_active, p_future])
    db.flush()

    # Academic level & Subject
    level = AcademicLevel(academic_level_id=7, level_name="Grade 7", grade_level=7)
    subject = Subject(subject_id=10, subject_name="Math", academic_level_id=7, status="active")
    db.add_all([level, subject])
    db.flush()

    # User Accounts
    u_admin = UserAccount(user_id=uuid.uuid4(), email="admin@test.com", password_hash="x")
    u_teacher = UserAccount(user_id=uuid.uuid4(), email="teacher@test.com", password_hash="x")
    u_student = UserAccount(user_id=uuid.uuid4(), email="student@test.com", password_hash="x")
    db.add_all([u_admin, u_teacher, u_student])
    db.flush()

    staff = AcademicStaff(staff_id="T-001", first_name="Teresa", last_name="Mendoza", user_id=u_teacher.user_id)
    student = Student(student_id=uuid.uuid4(), student_lrn="100000000001", first_name="Sam", last_name="Cruz", user_id=u_student.user_id)
    db.add_all([staff, student])
    db.flush()

    # Classes
    c_hist_recent = Class(class_id=1, section_name="Section 2024", academic_year_id=hist_recent.academic_year_id, academic_level_id=7)
    c_future = Class(class_id=2, section_name="Section 2026", academic_year_id=future_yr.academic_year_id, academic_level_id=7)
    db.add_all([c_hist_recent, c_future])
    db.flush()

    # Teacher has teaching load in hist_recent (2024-2025) and pre-assigned load in future_yr (2026-2027)
    load_hist = SubjectLoad(
        staff_id=staff.staff_id,
        class_id=c_hist_recent.class_id,
        subject_id=subject.subject_id,
        academic_period_id=p_hist_recent.academic_period_id,
        status="published",
        is_active_version=True,
    )
    load_future = SubjectLoad(
        staff_id=staff.staff_id,
        class_id=c_future.class_id,
        subject_id=subject.subject_id,
        academic_period_id=p_future.academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add_all([load_hist, load_future])

    # Student has enrollment in hist_recent (2024-2025) and pre-enrollment in future_yr (2026-2027)
    enr_hist = StudentClass(
        student_id=student.student_id,
        class_id=c_hist_recent.class_id,
        academic_year_id=hist_recent.academic_year_id,
        enrollment_status="enrolled",
    )
    enr_future = StudentClass(
        student_id=student.student_id,
        class_id=c_future.class_id,
        academic_year_id=future_yr.academic_year_id,
        enrollment_status="enrolled",
    )
    db.add_all([enr_hist, enr_future])

    db.commit()

    token_admin = create_access_token(str(u_admin.user_id), "admin")
    token_teacher = create_access_token(str(u_teacher.user_id), "teacher")
    token_student = create_access_token(str(u_student.user_id), "student")

    return {
        "hist_old": hist_old,
        "hist_recent": hist_recent,
        "active_yr": active_yr,
        "future_yr": future_yr,
        "p_hist_old": p_hist_old,
        "p_hist_recent": p_hist_recent,
        "p_active": p_active,
        "p_future": p_future,
        "token_admin": token_admin,
        "token_teacher": token_teacher,
        "token_student": token_student,
    }


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# GET /api/v1/settings/academic-years Tests
# ============================================================================

def test_api_academic_years_admin_sees_all(client, api_world):
    w = api_world
    res = client.get("/api/v1/settings/academic-years", headers=_auth_header(w["token_admin"]))
    assert res.status_code == 200
    data = res.json()
    year_ids = [y["academic_year_id"] for y in data["years"]]
    # Admin sees future, active, and both historical years
    assert year_ids == [
        w["future_yr"].academic_year_id,
        w["active_yr"].academic_year_id,
        w["hist_recent"].academic_year_id,
        w["hist_old"].academic_year_id,
    ]


def test_api_academic_years_teacher_sees_active_and_authorized_historical_only(client, api_world):
    w = api_world
    res = client.get("/api/v1/settings/academic-years", headers=_auth_header(w["token_teacher"]))
    assert res.status_code == 200
    data = res.json()
    year_ids = [y["academic_year_id"] for y in data["years"]]
    # Teacher sees active + 2024-2025 (where she taught); NEVER future 2026-2027 or unassigned 2023-2024
    assert year_ids == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]
    assert w["future_yr"].academic_year_id not in year_ids
    assert w["hist_old"].academic_year_id not in year_ids


def test_api_academic_years_student_sees_active_and_authorized_historical_only(client, api_world):
    w = api_world
    res = client.get("/api/v1/settings/academic-years", headers=_auth_header(w["token_student"]))
    assert res.status_code == 200
    data = res.json()
    year_ids = [y["academic_year_id"] for y in data["years"]]
    # Student sees active + 2024-2025 (enrolled); NEVER future 2026-2027 or unassigned 2023-2024
    assert year_ids == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]
    assert w["future_yr"].academic_year_id not in year_ids
    assert w["hist_old"].academic_year_id not in year_ids


def test_api_academic_years_unauthenticated_sees_active_year_only(client, api_world):
    w = api_world
    res = client.get("/api/v1/settings/academic-years")
    assert res.status_code == 200
    data = res.json()
    year_ids = [y["academic_year_id"] for y in data["years"]]
    # Guest only sees active year metadata
    assert year_ids == [w["active_yr"].academic_year_id]


def test_api_academic_years_spoofing_prevented(client, api_world):
    w = api_world
    # Attempting to elevate to admin via query param or headers without valid admin token
    res = client.get("/api/v1/settings/academic-years?role=admin")
    assert res.status_code == 200
    year_ids = [y["academic_year_id"] for y in res.json()["years"]]
    # Still only receives active year
    assert year_ids == [w["active_yr"].academic_year_id]

    # Student trying to pass role=admin in query param
    res_student_spoof = client.get(
        "/api/v1/settings/academic-years?role=admin",
        headers=_auth_header(w["token_student"]),
    )
    assert res_student_spoof.status_code == 200
    student_ids = [y["academic_year_id"] for y in res_student_spoof.json()["years"]]
    # Still only receives student's authorized scope
    assert student_ids == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]


# ============================================================================
# GET /api/v1/settings/academic-periods Tests
# ============================================================================

def test_api_academic_periods_admin_can_access_future_and_historical(client, api_world):
    w = api_world
    # Admin can access future year periods (needed for configuration)
    res_fut = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['future_yr'].academic_year_id}",
        headers=_auth_header(w["token_admin"]),
    )
    assert res_fut.status_code == 200
    assert len(res_fut.json()["periods"]) == 1
    assert res_fut.json()["periods"][0]["id"] == w["p_future"].academic_period_id

    # Admin can access historical year periods
    res_hist = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['hist_old'].academic_year_id}",
        headers=_auth_header(w["token_admin"]),
    )
    assert res_hist.status_code == 200
    assert res_hist.json()["periods"][0]["id"] == w["p_hist_old"].academic_period_id


def test_api_academic_periods_teacher_authorized_and_unauthorized_checks(client, api_world):
    w = api_world
    # 1. Active year periods -> 200 OK
    res_act = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['active_yr'].academic_year_id}",
        headers=_auth_header(w["token_teacher"]),
    )
    assert res_act.status_code == 200
    assert res_act.json()["periods"][0]["id"] == w["p_active"].academic_period_id

    # 2. Authorized historical year (2024-2025) -> 200 OK
    res_auth_hist = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['hist_recent'].academic_year_id}",
        headers=_auth_header(w["token_teacher"]),
    )
    assert res_auth_hist.status_code == 200
    assert res_auth_hist.json()["periods"][0]["id"] == w["p_hist_recent"].academic_period_id

    # 3. Unauthorized historical year (2023-2024) -> 403 Forbidden!
    res_unauth_hist = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['hist_old'].academic_year_id}",
        headers=_auth_header(w["token_teacher"]),
    )
    assert res_unauth_hist.status_code == 403

    # 4. Future year (even with pre-assigned load) -> 403 Forbidden!
    res_future = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['future_yr'].academic_year_id}",
        headers=_auth_header(w["token_teacher"]),
    )
    assert res_future.status_code == 403


def test_api_academic_periods_student_authorized_and_unauthorized_checks(client, api_world):
    w = api_world
    # 1. Active year periods -> 200 OK
    res_act = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['active_yr'].academic_year_id}",
        headers=_auth_header(w["token_student"]),
    )
    assert res_act.status_code == 200

    # 2. Authorized historical year -> 200 OK
    res_auth_hist = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['hist_recent'].academic_year_id}",
        headers=_auth_header(w["token_student"]),
    )
    assert res_auth_hist.status_code == 200

    # 3. Unauthorized historical year -> 403 Forbidden!
    res_unauth_hist = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['hist_old'].academic_year_id}",
        headers=_auth_header(w["token_student"]),
    )
    assert res_unauth_hist.status_code == 403

    # 4. Future year -> 403 Forbidden!
    res_future = client.get(
        f"/api/v1/settings/academic-periods?academic_year_id={w['future_yr'].academic_year_id}",
        headers=_auth_header(w["token_student"]),
    )
    assert res_future.status_code == 403


def test_api_academic_periods_unauthenticated_restrictions(client, api_world):
    w = api_world
    # No query params -> returns active year periods
    res_default = client.get("/api/v1/settings/academic-periods")
    assert res_default.status_code == 200
    assert len(res_default.json()["periods"]) == 1
    assert res_default.json()["periods"][0]["id"] == w["p_active"].academic_period_id

    # Explicit active year id -> 200 OK
    res_active = client.get(f"/api/v1/settings/academic-periods?academic_year_id={w['active_yr'].academic_year_id}")
    assert res_active.status_code == 200

    # Explicit historical year id -> 403 Forbidden!
    res_hist = client.get(f"/api/v1/settings/academic-periods?academic_year_id={w['hist_recent'].academic_year_id}")
    assert res_hist.status_code == 403

    # Explicit future year id -> 403 Forbidden!
    res_future = client.get(f"/api/v1/settings/academic-periods?academic_year_id={w['future_yr'].academic_year_id}")
    assert res_future.status_code == 403
