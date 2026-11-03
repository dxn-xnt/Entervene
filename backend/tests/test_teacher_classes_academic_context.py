from datetime import date
import uuid
import pytest
from decimal import Decimal
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.Base import Base
from app.db.Session import get_db
from app.core.Security import create_access_token
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.services.academic.SubjectLoadAuthorizationService import (
    SubjectLoadAuthorizationService,
    SubjectAccessLevel,
)


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
def classes_world(db):
    """Sets up:
    - hist_auth (2023-2024, ID=801): Historical year where teacher1 taught Math and advised Diamond-23.
      Also Teacher2 had a completed substitution for Teacher1 on Math in Q1.
    - hist_unauth (2024-2025, ID=802): Historical year where only teacher2 taught.
    - active_yr (2025-2026, ID=804): Active academic year where teacher1 teaches Ruby-25 and advises it.
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
    db.add_all([hist_auth, hist_unauth, active_yr, future_yr])
    db.commit()

    # Periods
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

    # Classes
    c_hist_auth = Class(
        class_id=10,
        section_name="Diamond-23",
        academic_year_id=hist_auth.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=t1_staff.staff_id,
        class_status="active",
    )
    c_hist_unauth = Class(
        class_id=20,
        section_name="Emerald-24",
        academic_year_id=hist_unauth.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=t2_staff.staff_id,
        class_status="active",
    )
    c_active = Class(
        class_id=30,
        section_name="Ruby-25",
        academic_year_id=active_yr.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=t1_staff.staff_id,
        class_status="active",
    )
    c_future = Class(
        class_id=40,
        section_name="Sapphire-26",
        academic_year_id=future_yr.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=t1_staff.staff_id,
        class_status="active",
    )
    db.add_all([c_hist_auth, c_hist_unauth, c_active, c_future])
    db.commit()

    # Subject loads
    load_t1_hist = SubjectLoad(
        subject_load_id=101,
        class_id=c_hist_auth.class_id,
        subject_id=subject.subject_id,
        staff_id=t1_staff.staff_id,
        academic_period_id=p_hist_auth.academic_period_id,
        is_active_version=True,
        status="active",
    )
    load_t1_active = SubjectLoad(
        subject_load_id=102,
        class_id=c_active.class_id,
        subject_id=subject.subject_id,
        staff_id=t1_staff.staff_id,
        academic_period_id=p_active.academic_period_id,
        is_active_version=True,
        status="active",
    )
    load_t2_unauth = SubjectLoad(
        subject_load_id=103,
        class_id=c_hist_unauth.class_id,
        subject_id=subject.subject_id,
        staff_id=t2_staff.staff_id,
        academic_period_id=p_hist_unauth.academic_period_id,
        is_active_version=True,
        status="active",
    )
    load_future = SubjectLoad(
        subject_load_id=104,
        class_id=c_future.class_id,
        subject_id=subject.subject_id,
        staff_id=t1_staff.staff_id,
        academic_period_id=p_future.academic_period_id,
        is_active_version=True,
        status="active",
    )
    db.add_all([load_t1_hist, load_t1_active, load_t2_unauth, load_future])
    db.commit()

    # Teacher2 had a completed substitution on load_t1_hist in 2023-2024
    sub_t2_hist = TeacherSubstitution(
        substitution_id=1,
        subject_load_id=load_t1_hist.subject_load_id,
        original_staff_id=t1_staff.staff_id,
        substitute_staff_id=t2_staff.staff_id,
        start_date=date(2023, 9, 1),
        end_date=date(2023, 10, 15),
        status="completed",
    )
    db.add(sub_t2_hist)
    db.commit()

    return {
        "hist_auth": hist_auth,
        "hist_unauth": hist_unauth,
        "active_yr": active_yr,
        "future_yr": future_yr,
        "p_hist_auth": p_hist_auth,
        "p_hist_unauth": p_hist_unauth,
        "p_active": p_active,
        "p_future": p_future,
        "c_hist_auth": c_hist_auth,
        "c_hist_unauth": c_hist_unauth,
        "c_active": c_active,
        "c_future": c_future,
        "load_t1_hist": load_t1_hist,
        "load_t1_active": load_t1_active,
        "load_t2_unauth": load_t2_unauth,
        "load_future": load_future,
        "teacher1": t1_user,
        "t1_staff": t1_staff,
        "teacher2": t2_user,
        "t2_staff": t2_staff,
        "admin": admin_user,
    }


def auth_header(user: UserAccount, role: str) -> dict[str, str]:
    token = create_access_token(str(user.user_id), role)
    return {"Authorization": f"Bearer {token}"}


def test_teacher_classes_in_active_year(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/teacher/classes?academic_year_id={classes_world['active_yr'].academic_year_id}&academic_period_id={classes_world['p_active'].academic_period_id}",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["class_id"] == classes_world["c_active"].class_id
    assert data[0]["academic_year_id"] == classes_world["active_yr"].academic_year_id


def test_teacher_classes_in_authorized_historical_year(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/teacher/classes?academic_year_id={classes_world['hist_auth'].academic_year_id}&academic_period_id={classes_world['p_hist_auth'].academic_period_id}",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["class_id"] == classes_world["c_hist_auth"].class_id
    assert data[0]["academic_year_id"] == classes_world["hist_auth"].academic_year_id


def test_teacher_substitute_historical_class_access(client, classes_world):
    """Teacher 2 substituted for Teacher 1 in 2023-2024 and should see the historical class."""
    headers = auth_header(classes_world["teacher2"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/teacher/classes?academic_year_id={classes_world['hist_auth'].academic_year_id}&academic_period_id={classes_world['p_hist_auth'].academic_period_id}",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["class_id"] == classes_world["c_hist_auth"].class_id


def test_teacher_classes_forbidden_from_future_academic_year(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/teacher/classes?academic_year_id={classes_world['future_yr'].academic_year_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_classes_forbidden_from_future_academic_period(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/teacher/classes?academic_period_id={classes_world['p_future'].academic_period_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_classes_forbidden_from_unauthorized_historical_year(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/teacher/classes?academic_year_id={classes_world['hist_unauth'].academic_year_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_classes_mismatched_period_and_year_returns_400(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/teacher/classes?academic_period_id={classes_world['p_hist_auth'].academic_period_id}&academic_year_id={classes_world['active_yr'].academic_year_id}",
        headers=headers,
    )
    assert response.status_code == 400
    assert "Academic period does not belong to specified academic year" in response.json()["detail"]


def test_teacher_advisory_classes_scoped_to_year(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    # Active year advisory classes
    res_active = client.get(
        f"/api/v1/classes/teacher/advisory?academic_year_id={classes_world['active_yr'].academic_year_id}",
        headers=headers,
    )
    assert res_active.status_code == 200
    active_data = res_active.json()
    assert len(active_data) == 1
    assert active_data[0]["class_id"] == classes_world["c_active"].class_id

    # Historical year advisory classes
    res_hist = client.get(
        f"/api/v1/classes/teacher/advisory?academic_year_id={classes_world['hist_auth'].academic_year_id}",
        headers=headers,
    )
    assert res_hist.status_code == 200
    hist_data = res_hist.json()
    assert len(hist_data) == 1
    assert hist_data[0]["class_id"] == classes_world["c_hist_auth"].class_id


def test_teacher_advisory_classes_forbidden_from_future_year(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classes/teacher/advisory?academic_year_id={classes_world['future_yr'].academic_year_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_advisory_class_detail_forbidden_future_year(client, classes_world):
    headers = auth_header(classes_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classes/teacher/advisory/{classes_world['c_future'].class_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "You do not have permission to view this class." in response.json()["detail"]


def test_teacher_historical_operations_read_only(db, classes_world):
    """Historical context write assertion must fail, preserving read-only rule."""
    t1_staff_id = classes_world["t1_staff"].staff_id
    class_id = classes_world["c_hist_auth"].class_id
    subject_id = 1
    period_id = classes_world["p_hist_auth"].academic_period_id

    # View access is granted
    level = SubjectLoadAuthorizationService.get_teacher_access_level(
        db, t1_staff_id, class_id, subject_id, period_id
    )
    assert level == SubjectAccessLevel.VIEW_ONLY

    # Write access is blocked with 403
    with pytest.raises(HTTPException) as exc_info:
        SubjectLoadAuthorizationService.assert_can_write(
            db, t1_staff_id, class_id, subject_id, period_id
        )
    assert exc_info.value.status_code == 403
