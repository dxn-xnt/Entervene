from datetime import date
from decimal import Decimal
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
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.LessonDelivery import LessonDelivery
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
def lessons_world(db):
    """Sets up:
    - hist_auth (2023-2024, ID=801): Historical year where teacher1 taught Math.
    - hist_unauth (2024-2025, ID=802): Historical year where only teacher2 taught.
    - active_yr (2025-2026, ID=804): Active academic year where teacher1 teaches Ruby-25.
    - future_yr (2026-2027, ID=805): Future academic year.
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
    p_hist_auth_1 = AcademicPeriod(
        academic_period_id=1801,
        academic_year_id=hist_auth.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2023, 8, 1),
        end_date=date(2023, 11, 1),
        is_active=False,
    )
    p_hist_unauth_1 = AcademicPeriod(
        academic_period_id=1802,
        academic_year_id=hist_unauth.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2024, 8, 1),
        end_date=date(2024, 11, 1),
        is_active=False,
    )
    p_active_1 = AcademicPeriod(
        academic_period_id=1804,
        academic_year_id=active_yr.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2025, 8, 1),
        end_date=date(2025, 11, 1),
        is_active=True,
    )
    p_active_2 = AcademicPeriod(
        academic_period_id=1806,
        academic_year_id=active_yr.academic_year_id,
        period_name="Q2",
        period_sequence=2,
        start_date=date(2025, 11, 2),
        end_date=date(2026, 2, 1),
        is_active=False,
    )
    p_future_1 = AcademicPeriod(
        academic_period_id=1805,
        academic_year_id=future_yr.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 11, 1),
        is_active=False,
    )
    db.add_all([p_hist_auth_1, p_hist_unauth_1, p_active_1, p_active_2, p_future_1])
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

    # Subject Math
    subject = Subject(
        subject_id=10,
        academic_level_id=level.academic_level_id,
        subject_name="Mathematics",
        subject_codename="M7",
        grading_template_id=gt.grading_template_id,
    )
    db.add(subject)
    db.commit()

    # Users and Staff
    u1 = UserAccount(user_id=uuid.uuid4(), email="teacher1@entervene.test", password_hash="x")
    u2 = UserAccount(user_id=uuid.uuid4(), email="teacher2@entervene.test", password_hash="x")
    db.add_all([u1, u2])
    db.flush()

    staff1 = AcademicStaff(staff_id="STF-001", user_id=u1.user_id, first_name="T1", last_name="Teacher", employment_status="active")
    staff2 = AcademicStaff(staff_id="STF-002", user_id=u2.user_id, first_name="T2", last_name="Teacher", employment_status="active")
    db.add_all([staff1, staff2])
    db.commit()

    # Classes
    class_hist_auth = Class(
        class_id=101,
        section_name="Diamond-23",
        academic_level_id=level.academic_level_id,
        academic_year_id=hist_auth.academic_year_id,
        adviser_staff_id=staff1.staff_id,
        class_status="active",
    )
    class_hist_unauth = Class(
        class_id=102,
        section_name="Emerald-24",
        academic_level_id=level.academic_level_id,
        academic_year_id=hist_unauth.academic_year_id,
        adviser_staff_id=staff2.staff_id,
        class_status="active",
    )
    class_active = Class(
        class_id=104,
        section_name="Ruby-25",
        academic_level_id=level.academic_level_id,
        academic_year_id=active_yr.academic_year_id,
        adviser_staff_id=staff1.staff_id,
        class_status="active",
    )
    class_future = Class(
        class_id=105,
        section_name="Sapphire-26",
        academic_level_id=level.academic_level_id,
        academic_year_id=future_yr.academic_year_id,
        adviser_staff_id=staff1.staff_id,
        class_status="active",
    )
    db.add_all([class_hist_auth, class_hist_unauth, class_active, class_future])
    db.commit()

    # Subject Loads
    # teacher1 taught Math in Diamond-23 (hist_auth)
    load_hist_auth = SubjectLoad(
        class_id=class_hist_auth.class_id,
        subject_id=subject.subject_id,
        staff_id=staff1.staff_id,
        academic_period_id=p_hist_auth_1.academic_period_id,
        status="active",
    )
    # teacher2 taught Math in Emerald-24 (hist_unauth)
    load_hist_unauth = SubjectLoad(
        class_id=class_hist_unauth.class_id,
        subject_id=subject.subject_id,
        staff_id=staff2.staff_id,
        academic_period_id=p_hist_unauth_1.academic_period_id,
        status="active",
    )
    # teacher1 teaches Math in Ruby-25 (active) in both Q1 and Q2
    load_active_1 = SubjectLoad(
        class_id=class_active.class_id,
        subject_id=subject.subject_id,
        staff_id=staff1.staff_id,
        academic_period_id=p_active_1.academic_period_id,
        status="active",
    )
    load_active_2 = SubjectLoad(
        class_id=class_active.class_id,
        subject_id=subject.subject_id,
        staff_id=staff1.staff_id,
        academic_period_id=p_active_2.academic_period_id,
        status="active",
    )
    # teacher1 assigned to future class load
    load_future = SubjectLoad(
        class_id=class_future.class_id,
        subject_id=subject.subject_id,
        staff_id=staff1.staff_id,
        academic_period_id=p_future_1.academic_period_id,
        status="active",
    )
    db.add_all([load_hist_auth, load_hist_unauth, load_active_1, load_active_2, load_future])
    db.commit()

    # Competencies
    comp_hist = Competency(
        statement="Historical Competency",
        subject_id=subject.subject_id,
        academic_period_id=p_hist_auth_1.academic_period_id,
        order_index=1,
    )
    comp_q1 = Competency(
        statement="Understand Algebra Basics",
        subject_id=subject.subject_id,
        academic_period_id=p_active_1.academic_period_id,
        order_index=1,
    )
    comp_q2 = Competency(
        statement="Understand Geometry Basics",
        subject_id=subject.subject_id,
        academic_period_id=p_active_2.academic_period_id,
        order_index=2,
    )
    db.add_all([comp_hist, comp_q1, comp_q2])
    db.commit()

    # Lessons
    # Lesson 1: Tied to comp_q1 (Period 1804), assigned to Ruby-25
    lesson1 = Lesson(
        title="Intro to Algebra",
        subject_id=subject.subject_id,
        competency_id=comp_q1.competency_id,
        created_by_staff_id=staff1.staff_id,
        is_published=True,
        is_draft=False,
    )
    # Lesson 2: Tied to comp_q2 (Period 1806), assigned to Ruby-25
    lesson2 = Lesson(
        title="Intro to Geometry",
        subject_id=subject.subject_id,
        competency_id=comp_q2.competency_id,
        created_by_staff_id=staff1.staff_id,
        is_published=True,
        is_draft=False,
    )
    # Lesson 3: No competency (reusable general lesson), owned by teacher1
    lesson3 = Lesson(
        title="General Problem Solving",
        subject_id=subject.subject_id,
        competency_id=None,
        created_by_staff_id=staff1.staff_id,
        is_published=True,
        is_draft=False,
    )
    # Lesson 4: Historical lesson in Diamond-23
    lesson4 = Lesson(
        title="Historical 2023 Math Lesson",
        subject_id=subject.subject_id,
        competency_id=None,
        created_by_staff_id=staff1.staff_id,
        is_published=True,
        is_draft=False,
    )
    db.add_all([lesson1, lesson2, lesson3, lesson4])
    db.commit()

    # Assignments
    assign1 = LessonAssignment(lesson_id=lesson1.lesson_id, class_id=class_active.class_id, assigned_by_staff_id=staff1.staff_id, is_published=True)
    assign2 = LessonAssignment(lesson_id=lesson2.lesson_id, class_id=class_active.class_id, assigned_by_staff_id=staff1.staff_id, is_published=True)
    assign4 = LessonAssignment(lesson_id=lesson4.lesson_id, class_id=class_hist_auth.class_id, assigned_by_staff_id=staff1.staff_id, is_published=True)
    db.add_all([assign1, assign2, assign4])
    db.commit()

    # Tokens
    token_t1 = create_access_token(user_id=str(u1.user_id), role="teacher")
    token_t2 = create_access_token(user_id=str(u2.user_id), role="teacher")

    return {
        "token_t1": token_t1,
        "token_t2": token_t2,
        "class_active": class_active,
        "class_hist_auth": class_hist_auth,
        "class_hist_unauth": class_hist_unauth,
        "class_future": class_future,
        "subject": subject,
        "p_active_1": p_active_1,
        "p_active_2": p_active_2,
        "p_hist_auth_1": p_hist_auth_1,
        "p_hist_unauth_1": p_hist_unauth_1,
        "p_future_1": p_future_1,
        "hist_auth": hist_auth,
        "active_yr": active_yr,
        "future_yr": future_yr,
        "comp_hist": comp_hist,
        "comp_q1": comp_q1,
        "comp_q2": comp_q2,
        "lesson1": lesson1,
        "lesson2": lesson2,
        "lesson3": lesson3,
        "lesson4": lesson4,
    }


def test_active_period_lessons_filtering(client, lessons_world, db):
    """When teacher queries active class for Q1 (1804):
    - Lesson 1 (Q1 competency) and Lesson 3 (no competency, reusable) must appear.
    - Lesson 2 (Q2 competency) must be filtered out.
    When querying Q2 (1806):
    - Lesson 2 (Q2 competency) and Lesson 3 must appear.
    - Lesson 1 must be filtered out.
    """
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    class_id = lessons_world["class_active"].class_id
    subject_id = lessons_world["subject"].subject_id
    p1 = lessons_world["p_active_1"].academic_period_id
    p2 = lessons_world["p_active_2"].academic_period_id
    yr = lessons_world["active_yr"].academic_year_id

    # Query for Q1
    res_q1 = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}?academic_period_id={p1}&academic_year_id={yr}",
        headers=headers,
    )
    assert res_q1.status_code == 200
    data_q1 = res_q1.json()
    titles_q1 = [l["title"] for l in data_q1]
    assert "Intro to Algebra" in titles_q1
    assert "General Problem Solving" in titles_q1
    assert "Intro to Geometry" not in titles_q1

    # Query for Q2
    res_q2 = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}?academic_period_id={p2}&academic_year_id={yr}",
        headers=headers,
    )
    assert res_q2.status_code == 200
    data_q2 = res_q2.json()
    titles_q2 = [l["title"] for l in data_q2]
    assert "Intro to Geometry" in titles_q2
    assert "General Problem Solving" in titles_q2
    assert "Intro to Algebra" not in titles_q2


def test_term_filtering_preserves_delivered_lesson_in_period(client, lessons_world, db):
    """Lesson 1 is tied to Q1 competency, but is delivered to the class in Q2.
    It should then be included when querying Q2.
    """
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    class_id = lessons_world["class_active"].class_id
    subject_id = lessons_world["subject"].subject_id
    p2 = lessons_world["p_active_2"].academic_period_id
    yr = lessons_world["active_yr"].academic_year_id

    # Create delivery of Lesson 1 in Q2
    delivery = LessonDelivery(
        lesson_id=lessons_world["lesson1"].lesson_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=p2,
        delivered_by_staff_id="STF-001",
    )
    db.add(delivery)
    db.commit()

    res = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}?academic_period_id={p2}&academic_year_id={yr}",
        headers=headers,
    )
    assert res.status_code == 200
    titles = [l["title"] for l in res.json()]
    assert "Intro to Algebra" in titles
    assert "Intro to Geometry" in titles
    assert "General Problem Solving" in titles


def test_authorized_historical_year_viewing(client, lessons_world):
    """Teacher1 had load in Diamond-23 (2023-2024). Viewing historical lessons is authorized (200)."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    class_id = lessons_world["class_hist_auth"].class_id
    subject_id = lessons_world["subject"].subject_id
    p_hist = lessons_world["p_hist_auth_1"].academic_period_id
    yr_hist = lessons_world["hist_auth"].academic_year_id

    res = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}?academic_period_id={p_hist}&academic_year_id={yr_hist}",
        headers=headers,
    )
    assert res.status_code == 200
    titles = [l["title"] for l in res.json()]
    assert "Historical 2023 Math Lesson" in titles


def test_unauthorized_historical_year_forbidden(client, lessons_world):
    """Teacher1 had NO load in Emerald-24 (2024-2025). Access must be rejected with 403."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    class_id = lessons_world["class_hist_unauth"].class_id
    subject_id = lessons_world["subject"].subject_id

    res = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}",
        headers=headers,
    )
    assert res.status_code == 403


def test_future_academic_year_forbidden(client, lessons_world):
    """Querying lessons for a future academic year must return 403 Forbidden."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    class_id = lessons_world["class_future"].class_id
    subject_id = lessons_world["subject"].subject_id

    res = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}",
        headers=headers,
    )
    assert res.status_code == 403


def test_year_and_period_mismatch_bad_request(client, lessons_world):
    """Mismatched academic_year_id or academic_period_id returns 400."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    class_id = lessons_world["class_active"].class_id
    subject_id = lessons_world["subject"].subject_id

    # Passing historical year for active class
    res_mismatch_yr = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}?academic_year_id=801",
        headers=headers,
    )
    assert res_mismatch_yr.status_code == 400

    # Passing historical period for active class
    res_mismatch_period = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}?academic_period_id=1801",
        headers=headers,
    )
    assert res_mismatch_period.status_code == 400


def test_nonexistent_class_or_period_not_found(client, lessons_world):
    """Non-existent class or period returns 404."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    subject_id = lessons_world["subject"].subject_id

    res_no_class = client.get(
        f"/api/v1/lessons/my-class/999999/subject/{subject_id}",
        headers=headers,
    )
    assert res_no_class.status_code == 404

    class_id = lessons_world["class_active"].class_id
    res_no_period = client.get(
        f"/api/v1/lessons/my-class/{class_id}/subject/{subject_id}?academic_period_id=999999",
        headers=headers,
    )
    assert res_no_period.status_code == 404


def test_historical_only_teacher_cannot_create_lesson(client, lessons_world):
    """Teacher 2 only has load in historical year (2024-2025). Lesson creation must return 403."""
    token = lessons_world["token_t2"]
    headers = {"Authorization": f"Bearer {token}"}
    subject_id = lessons_world["subject"].subject_id
    res = client.post(
        "/api/v1/lessons/",
        json={"title": "Historical Attempt", "subject_id": subject_id},
        headers=headers,
    )
    assert res.status_code == 403
    assert "Historical records are read-only" in res.json().get("detail", "")


def test_create_lesson_with_historical_competency_forbidden(client, lessons_world):
    """Active teacher cannot create a lesson bound to a historical academic period competency."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    subject_id = lessons_world["subject"].subject_id
    comp_hist = lessons_world["comp_hist"]
    res = client.post(
        "/api/v1/lessons/",
        json={
            "title": "Lesson with Historical Comp",
            "subject_id": subject_id,
            "competency_id": comp_hist.competency_id,
        },
        headers=headers,
    )
    assert res.status_code == 403
    assert "Historical records are read-only" in res.json().get("detail", "")


def test_update_lesson_with_historical_competency_forbidden(client, lessons_world):
    """Active teacher cannot update a lesson to attach a historical competency."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    lesson3 = lessons_world["lesson3"]
    comp_hist = lessons_world["comp_hist"]
    res = client.put(
        f"/api/v1/lessons/{lesson3.lesson_id}",
        json={"competency_id": comp_hist.competency_id},
        headers=headers,
    )
    assert res.status_code == 403
    assert "Historical records are read-only" in res.json().get("detail", "")


def test_update_historical_lesson_forbidden(client, lessons_world):
    """Historical lesson (assigned to historical class) cannot be updated."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    lesson4 = lessons_world["lesson4"]
    res = client.put(
        f"/api/v1/lessons/{lesson4.lesson_id}",
        json={"title": "Changed Historical Title"},
        headers=headers,
    )
    assert res.status_code == 403
    assert "Historical records are read-only" in res.json().get("detail", "")


def test_archive_and_publish_historical_lesson_forbidden(client, lessons_world):
    """Historical lesson cannot be archived or published."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    lesson4 = lessons_world["lesson4"]

    res_del = client.delete(f"/api/v1/lessons/{lesson4.lesson_id}", headers=headers)
    assert res_del.status_code == 403

    res_archive = client.put(f"/api/v1/lessons/{lesson4.lesson_id}/archive", headers=headers)
    assert res_archive.status_code == 403

    res_pub = client.put(f"/api/v1/lessons/{lesson4.lesson_id}/publish", headers=headers)
    assert res_pub.status_code == 403

    res_unarch = client.put(f"/api/v1/lessons/{lesson4.lesson_id}/unarchive", headers=headers)
    assert res_unarch.status_code == 403


def test_update_lesson_with_historical_delivery_forbidden(client, lessons_world, db):
    """Active lesson delivered in a historical class/period cannot be mutated."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    lesson = lessons_world["lesson3"]
    hist_class = lessons_world["class_hist_auth"]
    hist_period = lessons_world["p_hist_auth_1"]

    delivery = LessonDelivery(
        lesson_id=lesson.lesson_id,
        class_id=hist_class.class_id,
        subject_id=lessons_world["subject"].subject_id,
        academic_period_id=hist_period.academic_period_id,
        delivered_by_staff_id="STF-001",
    )
    db.add(delivery)
    db.commit()

    res = client.put(
        f"/api/v1/lessons/{lesson.lesson_id}",
        json={"title": "Attempt to edit delivered historical lesson"},
        headers=headers,
    )
    assert res.status_code == 403
    assert "Historical records are read-only" in res.json().get("detail", "")


def test_assign_lesson_to_historical_or_future_class_forbidden(client, lessons_world):
    """Assigning lesson to historical or future class returns 403."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    lesson3 = lessons_world["lesson3"]
    hist_class = lessons_world["class_hist_auth"]
    future_class = lessons_world["class_future"]

    res_hist = client.post(
        f"/api/v1/lessons/{lesson3.lesson_id}/assign",
        json={"class_ids": [hist_class.class_id]},
        headers=headers,
    )
    assert res_hist.status_code == 403

    res_future = client.post(
        f"/api/v1/lessons/{lesson3.lesson_id}/assign",
        json={"class_ids": [future_class.class_id]},
        headers=headers,
    )
    assert res_future.status_code == 403


def test_assign_historical_lesson_forbidden(client, lessons_world):
    """Assigning a historical lesson to an active class returns 403."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    lesson4 = lessons_world["lesson4"]
    active_class = lessons_world["class_active"]

    res = client.post(
        f"/api/v1/lessons/{lesson4.lesson_id}/assign",
        json={"class_ids": [active_class.class_id]},
        headers=headers,
    )
    assert res.status_code == 403


def test_active_lesson_mutations_succeed(client, lessons_world):
    """Active lesson create, update, assign, archive, and unarchive succeed."""
    token = lessons_world["token_t1"]
    headers = {"Authorization": f"Bearer {token}"}
    subject_id = lessons_world["subject"].subject_id
    comp_q1 = lessons_world["comp_q1"]
    active_class = lessons_world["class_active"]

    # 1. Create lesson with active competency
    res_create = client.post(
        "/api/v1/lessons/",
        json={
            "title": "Brand New Active Lesson",
            "description": "Active lesson description",
            "subject_id": subject_id,
            "competency_id": comp_q1.competency_id,
        },
        headers=headers,
    )
    assert res_create.status_code == 200
    new_id = res_create.json()["lesson_id"]

    # 2. Update lesson
    res_update = client.put(
        f"/api/v1/lessons/{new_id}",
        json={"title": "Updated Active Lesson Title"},
        headers=headers,
    )
    assert res_update.status_code == 200
    assert res_update.json()["title"] == "Updated Active Lesson Title"

    # 3. Assign lesson to active class
    res_assign = client.post(
        f"/api/v1/lessons/{new_id}/assign",
        json={"class_ids": [active_class.class_id]},
        headers=headers,
    )
    assert res_assign.status_code == 200

    # 4. Archive lesson
    res_archive = client.put(
        f"/api/v1/lessons/{new_id}/archive",
        headers=headers,
    )
    assert res_archive.status_code == 200
    assert res_archive.json()["is_archived"] is True

    # 5. Unarchive lesson
    res_unarch = client.put(
        f"/api/v1/lessons/{new_id}/unarchive",
        headers=headers,
    )
    assert res_unarch.status_code == 200
    assert res_unarch.json()["is_archived"] is False
