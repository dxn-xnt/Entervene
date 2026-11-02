from datetime import date
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.Base import Base
from app.db.Session import get_db
from app.core.Security import create_access_token
from decimal import Decimal
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff


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
def dashboard_world(db):
    """Sets up:
    - hist_auth (2023-2024, ID=801): Historical year where teacher1 has a teaching load.
    - hist_unauth (2024-2025, ID=802): Historical year where only teacher2 has a load.
    - hist_empty (2022-2023, ID=803): Historical year with no periods at all.
    - active_yr (2025-2026, ID=804): Active academic year.
    - future_yr (2026-2027, ID=805): Prepared future academic year.
    """
    hist_auth = AcademicYear(
        academic_year_id=801,
        year_label="2023-2024",
        start_date=date(2023, 8, 1),
        end_date=date(2024, 5, 31),
        is_active=False,
    )
    hist_unauth = AcademicYear(
        academic_year_id=802,
        year_label="2024-2025",
        start_date=date(2024, 8, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    hist_empty = AcademicYear(
        academic_year_id=803,
        year_label="2022-2023",
        start_date=date(2022, 8, 1),
        end_date=date(2023, 5, 31),
        is_active=False,
    )
    active_yr = AcademicYear(
        academic_year_id=804,
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=True,
    )
    future_yr = AcademicYear(
        academic_year_id=805,
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=False,
    )
    db.add_all([hist_auth, hist_unauth, hist_empty, active_yr, future_yr])
    db.commit()

    # Academic Periods
    p_hist_auth = AcademicPeriod(
        academic_period_id=1801,
        academic_year_id=hist_auth.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2023, 8, 1),
        end_date=date(2023, 11, 1),
        is_active=False,
    )
    p_hist_unauth = AcademicPeriod(
        academic_period_id=1802,
        academic_year_id=hist_unauth.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2024, 8, 1),
        end_date=date(2024, 11, 1),
        is_active=False,
    )
    p_active = AcademicPeriod(
        academic_period_id=1804,
        academic_year_id=active_yr.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2025, 8, 1),
        end_date=date(2025, 11, 1),
        is_active=True,
    )
    p_future = AcademicPeriod(
        academic_period_id=1805,
        academic_year_id=future_yr.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 11, 1),
        is_active=False,
    )
    db.add_all([p_hist_auth, p_hist_unauth, p_active, p_future])
    db.commit()

    # Academic Level, Grading Template & Subject
    level = AcademicLevel(academic_level_id=1, level_name="Grade 7", grade_level=7)
    gt = GradingTemplate(grading_template_id=1, template_name="Default Math", passing_threshold=Decimal("75.0"), status="active")
    db.add_all([level, gt])
    db.flush()

    c1 = GradingTemplateComponent(grading_template_id=gt.grading_template_id, component_name="Written Work", weight=Decimal("20.00"), display_order=1)
    c2 = GradingTemplateComponent(grading_template_id=gt.grading_template_id, component_name="Performance Tasks", weight=Decimal("50.00"), display_order=2)
    c3 = GradingTemplateComponent(grading_template_id=gt.grading_template_id, component_name="Exams", weight=Decimal("30.00"), display_order=3)
    db.add_all([c1, c2, c3])
    db.commit()

    subject = Subject(
        subject_id=1,
        academic_level_id=level.academic_level_id,
        subject_name="Math",
        subject_codename="M7",
        grading_template_id=gt.grading_template_id,
    )
    db.add(subject)
    db.commit()

    # Classes
    c_hist_auth = Class(
        class_id=10,
        section_name="Diamond-23",
        academic_year_id=hist_auth.academic_year_id,
        academic_level_id=level.academic_level_id,
        class_status="active",
    )
    c_hist_unauth = Class(
        class_id=20,
        section_name="Emerald-24",
        academic_year_id=hist_unauth.academic_year_id,
        academic_level_id=level.academic_level_id,
        class_status="active",
    )
    c_active = Class(
        class_id=30,
        section_name="Ruby-25",
        academic_year_id=active_yr.academic_year_id,
        academic_level_id=level.academic_level_id,
        class_status="active",
    )
    c_future = Class(
        class_id=40,
        section_name="Sapphire-26",
        academic_year_id=future_yr.academic_year_id,
        academic_level_id=level.academic_level_id,
        class_status="active",
    )
    db.add_all([c_hist_auth, c_hist_unauth, c_active, c_future])
    db.commit()

    # Teachers & Users
    t1_uid = uuid.uuid4()
    t1_user = UserAccount(user_id=t1_uid, email="teacher1@entervene.test", password_hash="x")
    t1_staff = AcademicStaff(staff_id="ST-001", user_id=t1_uid, first_name="T1", last_name="Teacher", employment_status="active")

    t2_uid = uuid.uuid4()
    t2_user = UserAccount(user_id=t2_uid, email="teacher2@entervene.test", password_hash="x")
    t2_staff = AcademicStaff(staff_id="ST-002", user_id=t2_uid, first_name="T2", last_name="Teacher", employment_status="active")

    admin_uid = uuid.uuid4()
    admin_user = UserAccount(user_id=admin_uid, email="admin1@entervene.test", password_hash="x")

    db.add_all([t1_user, t1_staff, t2_user, t2_staff, admin_user])
    db.commit()

    # Subject loads:
    # teacher1 taught Math in hist_auth and in active_yr
    load_t1_hist = SubjectLoad(
        class_id=c_hist_auth.class_id,
        subject_id=subject.subject_id,
        staff_id=t1_staff.staff_id,
        academic_period_id=p_hist_auth.academic_period_id,
        is_active_version=True,
        status="active",
    )
    load_t1_active = SubjectLoad(
        class_id=c_active.class_id,
        subject_id=subject.subject_id,
        staff_id=t1_staff.staff_id,
        academic_period_id=p_active.academic_period_id,
        is_active_version=True,
        status="active",
    )
    # teacher2 taught Math in hist_unauth and future_yr
    load_t2_hist = SubjectLoad(
        class_id=c_hist_unauth.class_id,
        subject_id=subject.subject_id,
        staff_id=t2_staff.staff_id,
        academic_period_id=p_hist_unauth.academic_period_id,
        is_active_version=True,
        status="active",
    )
    load_t2_future = SubjectLoad(
        class_id=c_future.class_id,
        subject_id=subject.subject_id,
        staff_id=t2_staff.staff_id,
        academic_period_id=p_future.academic_period_id,
        is_active_version=True,
        status="active",
    )
    db.add_all([load_t1_hist, load_t1_active, load_t2_hist, load_t2_future])
    db.commit()

    return {
        "hist_auth": hist_auth,
        "hist_unauth": hist_unauth,
        "hist_empty": hist_empty,
        "active_yr": active_yr,
        "future_yr": future_yr,
        "p_hist_auth": p_hist_auth,
        "p_hist_unauth": p_hist_unauth,
        "p_active": p_active,
        "p_future": p_future,
        "teacher1": t1_user,
        "teacher1_staff": t1_staff,
        "teacher2": t2_user,
        "teacher2_staff": t2_staff,
        "admin": admin_user,
    }


def auth_header(user: UserAccount, role: str) -> dict:
    token = create_access_token(str(user.user_id), role)
    return {"Authorization": f"Bearer {token}"}


def test_teacher_can_access_active_period(client, dashboard_world):
    headers = auth_header(dashboard_world["teacher1"], "teacher")
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={"academic_period_id": dashboard_world["p_active"].academic_period_id},
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["term_info"]["period_id"] == dashboard_world["p_active"].academic_period_id
    assert data["term_info"]["academic_year_id"] == dashboard_world["active_yr"].academic_year_id
    assert data["term_info"]["is_active"] is True


def test_teacher_can_access_authorized_historical_period(client, dashboard_world):
    headers = auth_header(dashboard_world["teacher1"], "teacher")
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={"academic_period_id": dashboard_world["p_hist_auth"].academic_period_id},
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["term_info"]["period_id"] == dashboard_world["p_hist_auth"].academic_period_id
    assert data["term_info"]["academic_year_id"] == dashboard_world["hist_auth"].academic_year_id
    assert data["term_info"]["is_active"] is False


def test_teacher_forbidden_from_unauthorized_historical_period(client, dashboard_world):
    # teacher1 has no records in hist_unauth (only teacher2 taught there)
    headers = auth_header(dashboard_world["teacher1"], "teacher")
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={"academic_period_id": dashboard_world["p_hist_unauth"].academic_period_id},
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_forbidden_from_future_academic_period(client, dashboard_world):
    headers = auth_header(dashboard_world["teacher1"], "teacher")
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={"academic_period_id": dashboard_world["p_future"].academic_period_id},
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_forbidden_from_future_academic_year_param(client, dashboard_world):
    headers = auth_header(dashboard_world["teacher1"], "teacher")
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={"academic_year_id": dashboard_world["future_yr"].academic_year_id},
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_requesting_year_with_no_periods_returns_404(client, dashboard_world):
    headers = auth_header(dashboard_world["admin"], "admin")  # admin is authorized for all years
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={"academic_year_id": dashboard_world["hist_empty"].academic_year_id},
        headers=headers,
    )
    assert response.status_code == 404
    assert "No academic periods found for this academic year" in response.json()["detail"]


def test_admin_can_access_future_academic_period(client, dashboard_world):
    headers = auth_header(dashboard_world["admin"], "admin")
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={
            "academic_period_id": dashboard_world["p_future"].academic_period_id,
            "staff_id": dashboard_world["teacher1_staff"].staff_id,
        },
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["term_info"]["period_id"] == dashboard_world["p_future"].academic_period_id


def test_mismatched_period_and_year_returns_400(client, dashboard_world):
    headers = auth_header(dashboard_world["admin"], "admin")
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={
            "academic_period_id": dashboard_world["p_active"].academic_period_id,
            "academic_year_id": dashboard_world["hist_auth"].academic_year_id,
            "staff_id": dashboard_world["teacher1_staff"].staff_id,
        },
        headers=headers,
    )
    assert response.status_code == 400
    assert "Academic period does not belong to specified academic year" in response.json()["detail"]


def test_year_id_alone_resolves_period_for_authorized_historical_year(client, dashboard_world):
    headers = auth_header(dashboard_world["teacher1"], "teacher")
    response = client.get(
        "/api/v1/analytics/teacher/dashboard-health",
        params={"academic_year_id": dashboard_world["hist_auth"].academic_year_id},
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["term_info"]["period_id"] == dashboard_world["p_hist_auth"].academic_period_id
    assert data["term_info"]["academic_year_id"] == dashboard_world["hist_auth"].academic_year_id
