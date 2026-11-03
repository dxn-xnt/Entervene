import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-12345678901234567890")

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

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
from app.models.academic.AcademicYearPassingPolicy import AcademicYearPassingPolicy
from app.models.academic.Class_ import Class
from app.models.academic.GradeSubmissionLog import GradeSubmissionLog
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


@pytest.fixture
def gradebook_db():
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
def client(gradebook_db):
    app.dependency_overrides[get_db] = lambda: gradebook_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def gradebook_world(gradebook_db):
    db = gradebook_db

    # 1. Academic Years
    hist_auth_yr = AcademicYear(
        academic_year_id=901,
        year_label="2023-2024",
        start_date=date(2023, 8, 1),
        end_date=date(2024, 5, 31),
        is_active=False,
    )
    hist_unauth_yr = AcademicYear(
        academic_year_id=902,
        year_label="2024-2025",
        start_date=date(2024, 8, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    active_yr = AcademicYear(
        academic_year_id=903,
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=True,
    )
    future_yr = AcademicYear(
        academic_year_id=904,
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=False,
    )
    db.add_all([hist_auth_yr, hist_unauth_yr, active_yr, future_yr])
    db.flush()

    # Passing policies
    admin_uuid = uuid.uuid4()
    for yr in [hist_auth_yr, hist_unauth_yr, active_yr, future_yr]:
        policy = AcademicYearPassingPolicy(
            academic_year_id=yr.academic_year_id,
            general_average_threshold=Decimal("75.00"),
            version=1,
            updated_by=admin_uuid,
        )
        db.add(policy)

    # 2. Periods
    p_hist_auth = AcademicPeriod(
        academic_period_id=1901,
        academic_year_id=hist_auth_yr.academic_year_id,
        period_name="Q1 2023",
        period_sequence=1,
        start_date=date(2023, 8, 1),
        end_date=date(2023, 11, 1),
        is_active=False,
    )
    p_hist_unauth = AcademicPeriod(
        academic_period_id=1902,
        academic_year_id=hist_unauth_yr.academic_year_id,
        period_name="Q1 2024",
        period_sequence=1,
        start_date=date(2024, 8, 1),
        end_date=date(2024, 11, 1),
        is_active=False,
    )
    p_active = AcademicPeriod(
        academic_period_id=1903,
        academic_year_id=active_yr.academic_year_id,
        period_name="Q1 2025",
        period_sequence=1,
        start_date=date(2025, 8, 1),
        end_date=date.today() + timedelta(days=30),
        is_active=True,
    )
    p_future = AcademicPeriod(
        academic_period_id=1904,
        academic_year_id=future_yr.academic_year_id,
        period_name="Q1 2026",
        period_sequence=1,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 11, 1),
        is_active=False,
    )
    db.add_all([p_hist_auth, p_hist_unauth, p_active, p_future])
    db.flush()

    # 3. Academic Level & Grading Template
    level = AcademicLevel(academic_level_id=101, level_name="Grade 7", grade_level=7)
    db.add(level)
    db.flush()

    template = GradingTemplate(
        grading_template_id=201,
        template_name="DepEd Standard",
        passing_threshold=Decimal("75.00"),
        status="active",
    )
    db.add(template)
    db.flush()

    db.add_all([
        GradingTemplateComponent(
            grading_template_id=template.grading_template_id,
            component_name="Written Work",
            weight=Decimal("30.00"),
            display_order=1,
        ),
        GradingTemplateComponent(
            grading_template_id=template.grading_template_id,
            component_name="Performance Task",
            weight=Decimal("50.00"),
            display_order=2,
        ),
        GradingTemplateComponent(
            grading_template_id=template.grading_template_id,
            component_name="Quarterly Assessment",
            weight=Decimal("20.00"),
            display_order=3,
        ),
    ])

    # 4. Subjects
    subj_math = Subject(
        subject_id=301,
        subject_name="Mathematics",
        subject_codename="MATH-7",
        grading_template_id=template.grading_template_id,
    )
    db.add(subj_math)
    db.flush()

    # 5. Users & Staff
    user_teacher1_id = uuid.uuid4()
    user_teacher2_id = uuid.uuid4()
    user_admin_id = uuid.uuid4()

    user_teacher1 = UserAccount(
        user_id=user_teacher1_id,
        email="teacher1@school.edu",
        password_hash="x",
        account_status="active",
    )
    user_teacher2 = UserAccount(
        user_id=user_teacher2_id,
        email="teacher2@school.edu",
        password_hash="x",
        account_status="active",
    )
    user_admin = UserAccount(
        user_id=user_admin_id,
        email="admin@school.edu",
        password_hash="x",
        account_status="active",
    )
    db.add_all([user_teacher1, user_teacher2, user_admin])
    db.flush()

    teacher1 = AcademicStaff(
        staff_id="STF-001",
        user_id=user_teacher1_id,
        first_name="Alice",
        last_name="Teacher",
        email="teacher1@school.edu",
    )
    teacher2 = AcademicStaff(
        staff_id="STF-002",
        user_id=user_teacher2_id,
        first_name="Bob",
        last_name="Other",
        email="teacher2@school.edu",
    )
    admin_staff = AcademicStaff(
        staff_id="STF-ADM",
        user_id=user_admin_id,
        first_name="Admin",
        last_name="User",
        email="admin@school.edu",
    )
    db.add_all([teacher1, teacher2, admin_staff])
    db.flush()

    # 6. Classes
    class_hist_auth = Class(
        class_id=401,
        section_name="Grade 7 - Diamond (2023)",
        academic_year_id=hist_auth_yr.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=teacher1.staff_id,
        class_status="active",
    )
    class_hist_unauth = Class(
        class_id=402,
        section_name="Grade 7 - Pearl (2024)",
        academic_year_id=hist_unauth_yr.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=teacher2.staff_id,
        class_status="active",
    )
    class_active = Class(
        class_id=403,
        section_name="Grade 7 - Emerald (2025)",
        academic_year_id=active_yr.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=teacher1.staff_id,
        class_status="active",
    )
    class_future = Class(
        class_id=404,
        section_name="Grade 7 - Ruby (2026)",
        academic_year_id=future_yr.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=teacher1.staff_id,
        class_status="active",
    )
    db.add_all([class_hist_auth, class_hist_unauth, class_active, class_future])
    db.flush()

    # 7. SubjectLoads
    load_hist_auth = SubjectLoad(
        subject_load_id=501,
        class_id=class_hist_auth.class_id,
        subject_id=subj_math.subject_id,
        academic_period_id=p_hist_auth.academic_period_id,
        staff_id=teacher1.staff_id,
        is_active_version=True,
        status="published",
    )
    load_hist_unauth = SubjectLoad(
        subject_load_id=502,
        class_id=class_hist_unauth.class_id,
        subject_id=subj_math.subject_id,
        academic_period_id=p_hist_unauth.academic_period_id,
        staff_id=teacher2.staff_id,  # Only teacher2 taught here
        is_active_version=True,
        status="published",
    )
    load_active = SubjectLoad(
        subject_load_id=503,
        class_id=class_active.class_id,
        subject_id=subj_math.subject_id,
        academic_period_id=p_active.academic_period_id,
        staff_id=teacher1.staff_id,
        is_active_version=True,
        status="active",
    )
    load_future = SubjectLoad(
        subject_load_id=504,
        class_id=class_future.class_id,
        subject_id=subj_math.subject_id,
        academic_period_id=p_future.academic_period_id,
        staff_id=teacher1.staff_id,
        is_active_version=True,
        status="published",
    )
    db.add_all([load_hist_auth, load_hist_unauth, load_active, load_future])
    db.flush()

    # 8. Students and enrollments
    s1_id = uuid.uuid4()
    s2_id = uuid.uuid4()
    student1 = Student(
        student_id=s1_id,
        student_lrn="100000000001",
        first_name="Juan",
        last_name="Dela Cruz",
        gender="Male",
        email="juan@school.edu",
    )
    student2 = Student(
        student_id=s2_id,
        student_lrn="100000000002",
        first_name="Maria",
        last_name="Clara",
        gender="Female",
        email="maria.c@school.edu",
    )
    db.add_all([student1, student2])
    db.flush()

    # Enrollments
    db.add_all([
        StudentClass(
            student_id=student1.student_id,
            class_id=class_hist_auth.class_id,
            academic_year_id=hist_auth_yr.academic_year_id,
            enrollment_status="enrolled",
        ),
        StudentClass(
            student_id=student2.student_id,
            class_id=class_active.class_id,
            academic_year_id=active_yr.academic_year_id,
            enrollment_status="enrolled",
        ),
    ])
    db.flush()

    # 9. Classwork assignments for active class
    cw_ww = Classwork(
        classwork_id=601,
        title="Quiz 1",
        classwork_type="ASSIGNMENT",
        classwork_category="QUIZ",
        total_points=Decimal("20.00"),
        is_graded=True,
        subject_id=subj_math.subject_id,
        created_by_staff_id=teacher1.staff_id,
    )
    db.add(cw_ww)
    db.flush()

    asgn_active = ClassworkAssignment(
        classwork_assignment_id=701,
        classwork_id=cw_ww.classwork_id,
        class_id=class_active.class_id,
        academic_period_id=p_active.academic_period_id,
        assigned_by_staff_id=teacher1.staff_id,
        is_published=True,
    )
    db.add(asgn_active)
    db.flush()

    sub_active = StudentSubmission(
        classwork_assignment_id=asgn_active.classwork_assignment_id,
        student_id=student2.student_id,
        grade=Decimal("18.00"),
        status="graded",
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
    )
    db.add(sub_active)

    # Classwork for historical auth class
    cw_hist = Classwork(
        classwork_id=602,
        title="Historical Quiz",
        classwork_type="ASSIGNMENT",
        classwork_category="QUIZ",
        total_points=Decimal("20.00"),
        is_graded=True,
        subject_id=subj_math.subject_id,
        created_by_staff_id=teacher1.staff_id,
    )
    db.add(cw_hist)
    db.flush()

    asgn_hist = ClassworkAssignment(
        classwork_assignment_id=702,
        classwork_id=cw_hist.classwork_id,
        class_id=class_hist_auth.class_id,
        academic_period_id=p_hist_auth.academic_period_id,
        assigned_by_staff_id=teacher1.staff_id,
        is_published=True,
    )
    db.add(asgn_hist)
    db.flush()

    sub_hist = StudentSubmission(
        classwork_assignment_id=asgn_hist.classwork_assignment_id,
        student_id=student1.student_id,
        grade=Decimal("19.00"),
        status="graded",
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
    )
    db.add(sub_hist)

    # Stored period grade for historical auth
    pg_hist = StudentPeriodGrade(
        student_id=student1.student_id,
        class_id=class_hist_auth.class_id,
        subject_id=subj_math.subject_id,
        academic_period_id=p_hist_auth.academic_period_id,
        initial_grade=Decimal("95.00"),
        transmuted_grade=Decimal("97.00"),
        final_period_grade=Decimal("97.00"),
        is_finalized=True,
    )
    db.add(pg_hist)
    db.commit()

    return {
        "teacher1": teacher1,
        "teacher2": teacher2,
        "admin": admin_staff,
        "token_teacher1": create_access_token(str(user_teacher1_id), "teacher"),
        "token_teacher2": create_access_token(str(user_teacher2_id), "teacher"),
        "token_admin": create_access_token(str(user_admin_id), "admin"),
        "hist_auth_yr": hist_auth_yr,
        "hist_unauth_yr": hist_unauth_yr,
        "active_yr": active_yr,
        "future_yr": future_yr,
        "p_hist_auth": p_hist_auth,
        "p_hist_unauth": p_hist_unauth,
        "p_active": p_active,
        "p_future": p_future,
        "class_hist_auth": class_hist_auth,
        "class_hist_unauth": class_hist_unauth,
        "class_active": class_active,
        "class_future": class_future,
        "subj_math": subj_math,
        "student1": student1,
        "student2": student2,
        "pg_hist": pg_hist,
    }


def test_teacher_gradebook_active_period(client, gradebook_world):
    """Teacher accesses active period gradebook: returns 200 and writable scope (is_view_only=False)."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_teacher1']}"}
    class_id = gradebook_world["class_active"].class_id
    subject_id = gradebook_world["subj_math"].subject_id
    period_id = gradebook_world["p_active"].academic_period_id
    year_id = gradebook_world["active_yr"].academic_year_id

    res = client.get(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/gradebook?academic_period_id={period_id}&academic_year_id={year_id}",
        headers=headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["scope"]["is_view_only"] is False
    assert data["scope"]["class_id"] == class_id
    assert data["scope"]["subject_id"] == subject_id
    assert len(data["studentGrades"]) == 1
    assert data["studentGrades"][0]["student_id"] == str(gradebook_world["student2"].student_id)


def test_teacher_gradebook_authorized_historical_period(client, gradebook_world):
    """Teacher accesses historical period they taught: returns 200 and read-only scope (is_view_only=True)."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_teacher1']}"}
    class_id = gradebook_world["class_hist_auth"].class_id
    subject_id = gradebook_world["subj_math"].subject_id
    period_id = gradebook_world["p_hist_auth"].academic_period_id
    year_id = gradebook_world["hist_auth_yr"].academic_year_id

    res = client.get(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/gradebook?academic_period_id={period_id}&academic_year_id={year_id}",
        headers=headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["scope"]["is_view_only"] is True
    assert len(data["studentGrades"]) == 1
    assert data["studentGrades"][0]["student_id"] == str(gradebook_world["student1"].student_id)


def test_teacher_gradebook_forbidden_future_year(client, gradebook_world):
    """Teacher attempting to access future year gradebook returns 403 Forbidden."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_teacher1']}"}
    class_id = gradebook_world["class_future"].class_id
    subject_id = gradebook_world["subj_math"].subject_id
    period_id = gradebook_world["p_future"].academic_period_id
    year_id = gradebook_world["future_yr"].academic_year_id

    res = client.get(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/gradebook?academic_period_id={period_id}&academic_year_id={year_id}",
        headers=headers,
    )
    assert res.status_code == 403, res.text
    assert "Not authorized to access this academic year" in res.json()["detail"]


def test_teacher_gradebook_forbidden_unauthorized_historical_year(client, gradebook_world):
    """Teacher attempting to access historical year where they didn't teach returns 403 Forbidden."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_teacher1']}"}
    class_id = gradebook_world["class_hist_unauth"].class_id
    subject_id = gradebook_world["subj_math"].subject_id
    period_id = gradebook_world["p_hist_unauth"].academic_period_id
    year_id = gradebook_world["hist_unauth_yr"].academic_year_id

    res = client.get(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/gradebook?academic_period_id={period_id}&academic_year_id={year_id}",
        headers=headers,
    )
    assert res.status_code == 403, res.text
    assert "Not authorized to access this academic year" in res.json()["detail"]


def test_teacher_gradebook_mismatched_period_and_class_year_returns_400(client, gradebook_world):
    """Passing a period from a different academic year than the target class returns 400 Bad Request."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_teacher1']}"}
    # class_active belongs to 2025-2026, but p_hist_auth belongs to 2023-2024
    class_id = gradebook_world["class_active"].class_id
    subject_id = gradebook_world["subj_math"].subject_id
    period_id = gradebook_world["p_hist_auth"].academic_period_id

    res = client.get(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/gradebook?academic_period_id={period_id}",
        headers=headers,
    )
    assert res.status_code == 400, res.text
    assert "Academic period does not belong to specified class academic year" in res.json()["detail"]


def test_teacher_gradebook_mismatched_year_query_param_returns_400(client, gradebook_world):
    """Passing academic_year_id query param that mismatches the class year returns 400 Bad Request."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_teacher1']}"}
    class_id = gradebook_world["class_active"].class_id
    subject_id = gradebook_world["subj_math"].subject_id
    mismatched_year = gradebook_world["hist_auth_yr"].academic_year_id

    res = client.get(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/gradebook?academic_year_id={mismatched_year}",
        headers=headers,
    )
    assert res.status_code == 400, res.text
    assert "Academic year does not match class academic year" in res.json()["detail"]


def test_teacher_gradebook_historical_mutations_blocked(client, gradebook_world):
    """Mutating grades in a closed/historical period returns 403 Forbidden."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_teacher1']}"}
    class_id = gradebook_world["class_hist_auth"].class_id
    subject_id = gradebook_world["subj_math"].subject_id
    student_id = gradebook_world["student1"].student_id
    period_id = gradebook_world["p_hist_auth"].academic_period_id

    # 1. Send single grade
    res_single = client.post(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/students/{student_id}/send-to-adviser",
        headers=headers,
        json={"academic_period_id": period_id},
    )
    assert res_single.status_code == 403, res_single.text
    assert any(w in res_single.json()["detail"].lower() for w in ["view-only", "read-only", "closed"])

    # 2. Bulk send grades
    res_bulk = client.post(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/periods/{period_id}/send-to-adviser",
        headers=headers,
        json={"remarks": "test"},
    )
    assert res_bulk.status_code == 403, res_bulk.text
    assert any(w in res_bulk.json()["detail"].lower() for w in ["view-only", "read-only", "closed"])

    # 3. Finalize period grade
    pg_id = gradebook_world["pg_hist"].period_grade_id
    res_finalize = client.post(
        f"/api/v1/student-records/period-grades/{pg_id}/finalize",
        headers=headers,
        json={"final_period_grade": 98.0},
    )
    assert res_finalize.status_code == 403, res_finalize.text


def test_teacher_period_options_excludes_future_and_unauthorized_years(client, gradebook_world):
    """Teacher period options lists only authorized historical and active periods, omitting future and unauthorized ones."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_teacher1']}"}
    res = client.get("/api/v1/student-records/teacher/periods", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    returned_year_ids = {p["academic_year_id"] for p in data["periods"]}

    # teacher1 taught in hist_auth_yr (901) and active_yr (903)
    assert gradebook_world["active_yr"].academic_year_id in returned_year_ids
    assert gradebook_world["hist_auth_yr"].academic_year_id in returned_year_ids

    # future_yr (904) and hist_unauth_yr (902) must NOT be present
    assert gradebook_world["future_yr"].academic_year_id not in returned_year_ids
    assert gradebook_world["hist_unauth_yr"].academic_year_id not in returned_year_ids


def test_admin_can_access_gradebook_for_any_year(client, gradebook_world):
    """Admin is authorized across all academic years including future and unassigned ones."""
    headers = {"Authorization": f"Bearer {gradebook_world['token_admin']}"}
    class_id = gradebook_world["class_future"].class_id
    subject_id = gradebook_world["subj_math"].subject_id
    period_id = gradebook_world["p_future"].academic_period_id
    year_id = gradebook_world["future_yr"].academic_year_id

    res = client.get(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/gradebook?academic_period_id={period_id}&academic_year_id={year_id}",
        headers=headers,
    )
    # Admin access returns 200 OK
    assert res.status_code == 200, res.text
