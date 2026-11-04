from datetime import date
import uuid
import pytest
from decimal import Decimal
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
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment


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
def classworks_world(db):
    """Sets up:
    - hist_auth (2023-2024, ID=801): Historical year where teacher1 taught Math.
    - hist_unauth (2024-2025, ID=802): Historical year where only teacher2 taught.
    - active_yr (2025-2026, ID=804): Active academic year where teacher1 teaches Ruby-25.
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

    # Classworks & Assignments
    cw_active = Classwork(
        classwork_id=501,
        title="Active Classwork",
        classwork_type="ASSIGNMENT",
        subject_id=subject.subject_id,
        created_by_staff_id=t1_staff.staff_id,
        total_points=100.0,
        is_published=True,
    )
    cw_draft = Classwork(
        classwork_id=502,
        title="Active Draft Classwork",
        classwork_type="ASSIGNMENT",
        subject_id=subject.subject_id,
        created_by_staff_id=t1_staff.staff_id,
        total_points=50.0,
        is_published=False,
    )
    cw_hist = Classwork(
        classwork_id=503,
        title="Historical Classwork",
        classwork_type="ASSIGNMENT",
        subject_id=subject.subject_id,
        created_by_staff_id=t1_staff.staff_id,
        total_points=100.0,
        is_published=True,
    )
    cw_future = Classwork(
        classwork_id=504,
        title="Future Classwork",
        classwork_type="ASSIGNMENT",
        subject_id=subject.subject_id,
        created_by_staff_id=t1_staff.staff_id,
        total_points=100.0,
        is_published=True,
    )
    db.add_all([cw_active, cw_draft, cw_hist, cw_future])
    db.commit()

    asgn_active = ClassworkAssignment(
        classwork_assignment_id=601,
        classwork_id=cw_active.classwork_id,
        class_id=c_active.class_id,
        academic_period_id=p_active.academic_period_id,
        assigned_by_staff_id=t1_staff.staff_id,
        is_published=True,
    )
    asgn_hist = ClassworkAssignment(
        classwork_assignment_id=602,
        classwork_id=cw_hist.classwork_id,
        class_id=c_hist_auth.class_id,
        academic_period_id=p_hist_auth.academic_period_id,
        assigned_by_staff_id=t1_staff.staff_id,
        is_published=True,
    )
    asgn_future = ClassworkAssignment(
        classwork_assignment_id=603,
        classwork_id=cw_future.classwork_id,
        class_id=c_future.class_id,
        academic_period_id=p_future.academic_period_id,
        assigned_by_staff_id=t1_staff.staff_id,
        is_published=True,
    )
    db.add_all([asgn_active, asgn_hist, asgn_future])
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
        "cw_active": cw_active,
        "cw_draft": cw_draft,
        "cw_hist": cw_hist,
        "cw_future": cw_future,
        "asgn_active": asgn_active,
        "asgn_hist": asgn_hist,
        "asgn_future": asgn_future,
        "teacher1": t1_user,
        "t1_staff": t1_staff,
        "teacher2": t2_user,
        "t2_staff": t2_staff,
        "admin": admin_user,
    }


def auth_header(user: UserAccount, role: str) -> dict[str, str]:
    token = create_access_token(str(user.user_id), role)
    return {"Authorization": f"Bearer {token}"}


def test_teacher_classworks_in_active_period(client, classworks_world):
    """Active period listing includes active assignments and unassigned drafts,
    but excludes historical and future assignments.
    """
    headers = auth_header(classworks_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/my-classworks?academic_year_id={classworks_world['active_yr'].academic_year_id}&academic_period_id={classworks_world['p_active'].academic_period_id}",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    returned_ids = {cw["classwork_id"] for cw in data}

    assert classworks_world["cw_active"].classwork_id in returned_ids
    assert classworks_world["cw_draft"].classwork_id in returned_ids
    assert classworks_world["cw_hist"].classwork_id not in returned_ids
    assert classworks_world["cw_future"].classwork_id not in returned_ids


def test_teacher_classworks_in_authorized_historical_period(client, classworks_world):
    """Historical period listing includes only authorized historical assignments.
    Unassigned active drafts are NOT leaked into historical periods.
    """
    headers = auth_header(classworks_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/my-classworks?academic_year_id={classworks_world['hist_auth'].academic_year_id}&academic_period_id={classworks_world['p_hist_auth'].academic_period_id}",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json()
    returned_ids = {cw["classwork_id"] for cw in data}

    assert classworks_world["cw_hist"].classwork_id in returned_ids
    assert classworks_world["cw_draft"].classwork_id not in returned_ids
    assert classworks_world["cw_active"].classwork_id not in returned_ids
    assert classworks_world["cw_future"].classwork_id not in returned_ids


def test_teacher_classworks_forbidden_from_future_academic_year(client, classworks_world):
    """Teachers cannot query classworks from future academic years."""
    headers = auth_header(classworks_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/my-classworks?academic_year_id={classworks_world['future_yr'].academic_year_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_classworks_forbidden_from_future_academic_period(client, classworks_world):
    """Teachers cannot query classworks from future academic periods."""
    headers = auth_header(classworks_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/my-classworks?academic_period_id={classworks_world['p_future'].academic_period_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_classworks_forbidden_from_unauthorized_historical_year(client, classworks_world):
    """Teachers cannot query classworks from historical years where they had no load or advisory role."""
    headers = auth_header(classworks_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/my-classworks?academic_year_id={classworks_world['hist_unauth'].academic_year_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_teacher_classworks_mismatched_period_and_year_returns_400(client, classworks_world):
    """Mismatched academic period and year returns 400 Bad Request."""
    headers = auth_header(classworks_world["teacher1"], "teacher")
    response = client.get(
        f"/api/v1/classwork-assignments/my-classworks?academic_year_id={classworks_world['active_yr'].academic_year_id}&academic_period_id={classworks_world['p_hist_auth'].academic_period_id}",
        headers=headers,
    )
    assert response.status_code == 400
    assert "Academic period does not belong to specified academic year" in response.json()["detail"]


def test_teacher_assignments_for_class_subject_scoped_and_authorized(client, classworks_world):
    headers = auth_header(classworks_world["teacher1"], "teacher")

    # 1. Valid active class & period
    res_active = client.get(
        f"/api/v1/classwork-assignments/teacher/class/{classworks_world['c_active'].class_id}/subject/1/assignments?academic_period_id={classworks_world['p_active'].academic_period_id}",
        headers=headers,
    )
    assert res_active.status_code == 200
    assert len(res_active.json()) == 1
    assert res_active.json()[0]["classwork_assignment_id"] == classworks_world["asgn_active"].classwork_assignment_id

    # 2. Future class returns 403 for teacher
    res_future = client.get(
        f"/api/v1/classwork-assignments/teacher/class/{classworks_world['c_future'].class_id}/subject/1/assignments?academic_period_id={classworks_world['p_future'].academic_period_id}",
        headers=headers,
    )
    assert res_future.status_code == 403
    assert "Not authorized to access this academic year" in res_future.json()["detail"]

    # 3. Mismatched period for class returns 400
    res_mismatch = client.get(
        f"/api/v1/classwork-assignments/teacher/class/{classworks_world['c_active'].class_id}/subject/1/assignments?academic_period_id={classworks_world['p_hist_auth'].academic_period_id}",
        headers=headers,
    )
    assert res_mismatch.status_code == 400
    assert "Academic period does not belong to specified class academic year" in res_mismatch.json()["detail"]


def test_teacher_historical_classwork_mutations_blocked_read_only(client, classworks_world):
    headers = auth_header(classworks_world["teacher1"], "teacher")
    hist_cw_id = classworks_world["cw_hist"].classwork_id

    # 1. GET historical classwork details is allowed (viewable)
    res_get = client.get(
        f"/api/v1/classwork-assignments/classwork/{hist_cw_id}",
        headers=headers,
    )
    assert res_get.status_code == 200
    assert res_get.json()["classwork_id"] == hist_cw_id

    # 2. PUT update on historical classwork is blocked (read-only)
    res_put = client.put(
        f"/api/v1/classwork-assignments/classwork/{hist_cw_id}",
        json={"title": "Updated Historical Title", "total_points": 100},
        headers=headers,
    )
    assert res_put.status_code == 403
    assert "read-only" in res_put.json()["detail"].lower()

    # 3. PUT archive on historical classwork is blocked (read-only)
    res_archive = client.put(
        f"/api/v1/classwork-assignments/classwork/{hist_cw_id}/archive",
        headers=headers,
    )
    assert res_archive.status_code == 403
    assert "read-only" in res_archive.json()["detail"].lower()


def test_teacher_cannot_access_future_classwork(client, classworks_world):
    """Teachers cannot view future classworks."""
    headers = auth_header(classworks_world["teacher1"], "teacher")
    future_cw_id = classworks_world["cw_future"].classwork_id

    response = client.get(
        f"/api/v1/classwork-assignments/classwork/{future_cw_id}",
        headers=headers,
    )
    assert response.status_code == 403
    assert "Not authorized to access this academic year" in response.json()["detail"]


def test_admin_can_access_future_classwork(client, classworks_world):
    """Admins can view future classworks."""
    headers = auth_header(classworks_world["admin"], "admin")
    future_cw_id = classworks_world["cw_future"].classwork_id

    response = client.get(
        f"/api/v1/classwork-assignments/classwork/{future_cw_id}",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["classwork_id"] == future_cw_id
