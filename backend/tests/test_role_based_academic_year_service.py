from datetime import date
from decimal import Decimal
import uuid
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.Base import Base
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

from app.services.academic.AcademicYearService import (
    get_authorized_academic_years,
    is_academic_year_authorized,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def academic_world(db):
    """Sets up a comprehensive academic world with out-of-order IDs to verify classification:
    - hist_old (2023-2024, ID=901): Closed historical
    - hist_recent (2024-2025, ID=902): Closed historical
    - active_yr (2025-2026, ID=101): Active school year
    - future_yr (2026-2027, ID=201): Prepared future year
    - future_far (2027-2028, ID=202): Prepared future year
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
    future_far = AcademicYear(
        academic_year_id=202,
        year_label="2027-2028",
        start_date=date(2027, 8, 1),
        end_date=date(2028, 5, 31),
        is_active=False,
    )
    db.add_all([hist_old, hist_recent, active_yr, future_yr, future_far])
    db.flush()

    # Periods for each year
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
    subject = Subject(subject_id=10, subject_name="Science", academic_level_id=7, status="active")
    db.add_all([level, subject])
    db.flush()

    # Users and Staff
    u_admin = UserAccount(user_id=uuid.uuid4(), email="admin@test.com", password_hash="x")
    u_teacher_a = UserAccount(user_id=uuid.uuid4(), email="teacher_a@test.com", password_hash="x")
    u_teacher_b = UserAccount(user_id=uuid.uuid4(), email="teacher_b@test.com", password_hash="x")
    u_student_x = UserAccount(user_id=uuid.uuid4(), email="student_x@test.com", password_hash="x")
    u_student_y = UserAccount(user_id=uuid.uuid4(), email="student_y@test.com", password_hash="x")
    db.add_all([u_admin, u_teacher_a, u_teacher_b, u_student_x, u_student_y])
    db.flush()

    staff_a = AcademicStaff(staff_id="STAFF-A", first_name="Alice", last_name="Tan", user_id=u_teacher_a.user_id)
    staff_b = AcademicStaff(staff_id="STAFF-B", first_name="Bob", last_name="Cruz", user_id=u_teacher_b.user_id)
    student_x = Student(student_id=uuid.uuid4(), student_lrn="100000000001", first_name="Xavier", last_name="Reyes", user_id=u_student_x.user_id)
    student_y = Student(student_id=uuid.uuid4(), student_lrn="100000000002", first_name="Yara", last_name="Santos", user_id=u_student_y.user_id)
    db.add_all([staff_a, staff_b, student_x, student_y])
    db.flush()

    # Classes in different years
    c_hist_old = Class(class_id=1, section_name="Section A-2023", academic_year_id=hist_old.academic_year_id, academic_level_id=7)
    c_hist_recent = Class(class_id=2, section_name="Section A-2024", academic_year_id=hist_recent.academic_year_id, academic_level_id=7)
    c_active = Class(class_id=3, section_name="Section A-2025", academic_year_id=active_yr.academic_year_id, academic_level_id=7)
    c_future = Class(class_id=4, section_name="Section A-2026", academic_year_id=future_yr.academic_year_id, academic_level_id=7)
    db.add_all([c_hist_old, c_hist_recent, c_active, c_future])
    db.flush()

    db.commit()

    return {
        "hist_old": hist_old,
        "hist_recent": hist_recent,
        "active_yr": active_yr,
        "future_yr": future_yr,
        "future_far": future_far,
        "p_hist_old": p_hist_old,
        "p_hist_recent": p_hist_recent,
        "p_active": p_active,
        "p_future": p_future,
        "level": level,
        "subject": subject,
        "u_admin": u_admin,
        "u_teacher_a": u_teacher_a,
        "u_teacher_b": u_teacher_b,
        "u_student_x": u_student_x,
        "u_student_y": u_student_y,
        "staff_a": staff_a,
        "staff_b": staff_b,
        "student_x": student_x,
        "student_y": student_y,
        "c_hist_old": c_hist_old,
        "c_hist_recent": c_hist_recent,
        "c_active": c_active,
        "c_future": c_future,
    }


# ============================================================================
# Admin Tests
# ============================================================================

def test_admin_can_view_all_academic_years(db, academic_world):
    """Admin must view historical, active, and prepared future academic years."""
    w = academic_world
    admin_user = {"sub": str(w["u_admin"].user_id), "role": "admin"}
    years = get_authorized_academic_years(db, admin_user)

    year_ids = [y.academic_year_id for y in years]
    # Expect all 5 years in chronological descending order
    assert year_ids == [
        w["future_far"].academic_year_id,
        w["future_yr"].academic_year_id,
        w["active_yr"].academic_year_id,
        w["hist_recent"].academic_year_id,
        w["hist_old"].academic_year_id,
    ]
    for y in years:
        assert is_academic_year_authorized(db, y.academic_year_id, admin_user) is True


# ============================================================================
# Teacher Tests
# ============================================================================

def test_teacher_views_active_year_even_without_loads(db, academic_world):
    """A teacher with no historical or active loads must still see the active academic year."""
    w = academic_world
    teacher_user = {"sub": str(w["u_teacher_a"].user_id), "role": "teacher"}
    years = get_authorized_academic_years(db, teacher_user)

    assert len(years) == 1
    assert years[0].academic_year_id == w["active_yr"].academic_year_id
    assert is_academic_year_authorized(db, w["active_yr"].academic_year_id, teacher_user) is True
    assert is_academic_year_authorized(db, w["hist_recent"].academic_year_id, teacher_user) is False
    assert is_academic_year_authorized(db, w["future_yr"].academic_year_id, teacher_user) is False


def test_teacher_views_historical_year_with_primary_teaching_load(db, academic_world):
    """Teacher with an active/published load in 2024-2025 sees active year + 2024-2025 only."""
    w = academic_world
    load = SubjectLoad(
        staff_id=w["staff_a"].staff_id,
        class_id=w["c_hist_recent"].class_id,
        subject_id=w["subject"].subject_id,
        academic_period_id=w["p_hist_recent"].academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add(load)
    db.commit()

    teacher_user = {"sub": str(w["u_teacher_a"].user_id), "role": "teacher"}
    years = get_authorized_academic_years(db, teacher_user)

    year_ids = [y.academic_year_id for y in years]
    assert year_ids == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]
    assert w["hist_old"].academic_year_id not in year_ids
    assert w["future_yr"].academic_year_id not in year_ids


def test_teacher_views_historical_year_with_substitution(db, academic_world):
    """Teacher who was a substitute in a historical year gains access to that historical year."""
    w = academic_world
    # Staff B is primary teacher, Staff A is substitute in 2023-2024
    load = SubjectLoad(
        staff_id=w["staff_b"].staff_id,
        class_id=w["c_hist_old"].class_id,
        subject_id=w["subject"].subject_id,
        academic_period_id=w["p_hist_old"].academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add(load)
    db.flush()

    sub = TeacherSubstitution(
        subject_load_id=load.subject_load_id,
        original_staff_id=w["staff_b"].staff_id,
        substitute_staff_id=w["staff_a"].staff_id,
        start_date=date(2023, 9, 1),
        end_date=date(2023, 10, 1),
        status="completed",
    )
    db.add(sub)
    db.commit()

    teacher_user = {"sub": str(w["u_teacher_a"].user_id), "role": "teacher"}
    years = get_authorized_academic_years(db, teacher_user)

    year_ids = [y.academic_year_id for y in years]
    assert w["active_yr"].academic_year_id in year_ids
    assert w["hist_old"].academic_year_id in year_ids
    assert w["hist_recent"].academic_year_id not in year_ids


def test_teacher_views_historical_year_with_advisory(db, academic_world):
    """Teacher who was an adviser of a class in a historical year gains access to that year."""
    w = academic_world
    # Set Staff A as adviser for 2023-2024 class
    w["c_hist_old"].adviser_staff_id = w["staff_a"].staff_id
    db.commit()

    teacher_user = {"sub": str(w["u_teacher_a"].user_id), "role": "teacher"}
    years = get_authorized_academic_years(db, teacher_user)

    year_ids = [y.academic_year_id for y in years]
    assert year_ids == [w["active_yr"].academic_year_id, w["hist_old"].academic_year_id]


def test_teacher_never_views_future_years_even_with_assigned_loads(db, academic_world):
    """Teacher pre-assigned to future loads must NEVER view future academic years."""
    w = academic_world
    # Pre-assign Staff A to a future load in 2026-2027
    future_load = SubjectLoad(
        staff_id=w["staff_a"].staff_id,
        class_id=w["c_future"].class_id,
        subject_id=w["subject"].subject_id,
        academic_period_id=w["p_future"].academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add(future_load)
    db.commit()

    teacher_user = {"sub": str(w["u_teacher_a"].user_id), "role": "teacher"}
    years = get_authorized_academic_years(db, teacher_user)

    year_ids = [y.academic_year_id for y in years]
    # Future year 2026-2027 MUST be strictly excluded
    assert w["future_yr"].academic_year_id not in year_ids
    assert w["future_far"].academic_year_id not in year_ids
    assert is_academic_year_authorized(db, w["future_yr"].academic_year_id, teacher_user) is False


def test_unrelated_teacher_records_do_not_leak_access(db, academic_world):
    """Staff B's historical records must never grant access to Staff A."""
    w = academic_world
    load = SubjectLoad(
        staff_id=w["staff_b"].staff_id,
        class_id=w["c_hist_recent"].class_id,
        subject_id=w["subject"].subject_id,
        academic_period_id=w["p_hist_recent"].academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add(load)
    db.commit()

    # Staff A has no loads
    years_a = get_authorized_academic_years(db, {"sub": str(w["u_teacher_a"].user_id), "role": "teacher"})
    assert [y.academic_year_id for y in years_a] == [w["active_yr"].academic_year_id]

    # Staff B has the load
    years_b = get_authorized_academic_years(db, {"sub": str(w["u_teacher_b"].user_id), "role": "teacher"})
    assert [y.academic_year_id for y in years_b] == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]


# ============================================================================
# Student Tests
# ============================================================================

def test_student_views_active_year_even_without_enrollment(db, academic_world):
    """A student with no historical or active records still sees the active academic year."""
    w = academic_world
    student_user = {"sub": str(w["u_student_x"].user_id), "role": "student"}
    years = get_authorized_academic_years(db, student_user)

    assert len(years) == 1
    assert years[0].academic_year_id == w["active_yr"].academic_year_id
    assert is_academic_year_authorized(db, w["active_yr"].academic_year_id, student_user) is True
    assert is_academic_year_authorized(db, w["hist_recent"].academic_year_id, student_user) is False


def test_student_views_historical_year_with_valid_enrollment(db, academic_world):
    """Student with enrollment in 2024-2025 sees active year + 2024-2025."""
    w = academic_world
    enrollment = StudentClass(
        student_id=w["student_x"].student_id,
        class_id=w["c_hist_recent"].class_id,
        academic_year_id=w["hist_recent"].academic_year_id,
        enrollment_status="enrolled",
    )
    db.add(enrollment)
    db.commit()

    student_user = {"sub": str(w["u_student_x"].user_id), "role": "student"}
    years = get_authorized_academic_years(db, student_user)

    year_ids = [y.academic_year_id for y in years]
    assert year_ids == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]
    assert w["hist_old"].academic_year_id not in year_ids


def test_student_views_historical_year_with_academic_grades(db, academic_world):
    """Student with historical StudentPeriodGrade records in 2023-2024 sees that year."""
    w = academic_world
    grade = StudentPeriodGrade(
        student_id=w["student_x"].student_id,
        class_id=w["c_hist_old"].class_id,
        subject_id=w["subject"].subject_id,
        academic_period_id=w["p_hist_old"].academic_period_id,
        final_period_grade=Decimal("92.50"),
    )
    db.add(grade)
    db.commit()

    student_user = {"sub": str(w["u_student_x"].user_id), "role": "student"}
    years = get_authorized_academic_years(db, student_user)

    year_ids = [y.academic_year_id for y in years]
    assert year_ids == [w["active_yr"].academic_year_id, w["hist_old"].academic_year_id]


def test_student_never_views_future_years_even_with_pre_enrollment(db, academic_world):
    """Student pre-enrolled in a future year must NEVER view future academic years."""
    w = academic_world
    future_enrollment = StudentClass(
        student_id=w["student_x"].student_id,
        class_id=w["c_future"].class_id,
        academic_year_id=w["future_yr"].academic_year_id,
        enrollment_status="enrolled",
    )
    db.add(future_enrollment)
    db.commit()

    student_user = {"sub": str(w["u_student_x"].user_id), "role": "student"}
    years = get_authorized_academic_years(db, student_user)

    year_ids = [y.academic_year_id for y in years]
    assert w["future_yr"].academic_year_id not in year_ids
    assert w["future_far"].academic_year_id not in year_ids
    assert is_academic_year_authorized(db, w["future_yr"].academic_year_id, student_user) is False


def test_unrelated_student_records_do_not_leak_access(db, academic_world):
    """Student Y's enrollment in 2024-2025 must never grant access to Student X."""
    w = academic_world
    enrollment_y = StudentClass(
        student_id=w["student_y"].student_id,
        class_id=w["c_hist_recent"].class_id,
        academic_year_id=w["hist_recent"].academic_year_id,
        enrollment_status="enrolled",
    )
    db.add(enrollment_y)
    db.commit()

    years_x = get_authorized_academic_years(db, {"sub": str(w["u_student_x"].user_id), "role": "student"})
    assert [y.academic_year_id for y in years_x] == [w["active_yr"].academic_year_id]

    years_y = get_authorized_academic_years(db, {"sub": str(w["u_student_y"].user_id), "role": "student"})
    assert [y.academic_year_id for y in years_y] == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]


# ============================================================================
# Unauthenticated & Lifecycle Fallback Tests
# ============================================================================

def test_unauthenticated_or_unknown_caller_views_active_year_only(db, academic_world):
    """Unauthenticated caller receives active year only, never future or historical records."""
    w = academic_world
    years_none = get_authorized_academic_years(db, None)
    assert [y.academic_year_id for y in years_none] == [w["active_yr"].academic_year_id]

    years_anon = get_authorized_academic_years(db, {})
    assert [y.academic_year_id for y in years_anon] == [w["active_yr"].academic_year_id]


def test_no_active_year_configured_uses_as_of_date_classification(db):
    """When no academic year has is_active=True, lifecycle classification uses as_of date."""
    hist = AcademicYear(
        academic_year_id=1,
        year_label="2023-2024",
        start_date=date(2023, 8, 1),
        end_date=date(2024, 5, 31),
        is_active=False,
    )
    curr = AcademicYear(
        academic_year_id=2,
        year_label="2024-2025",
        start_date=date(2024, 8, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    fut = AcademicYear(
        academic_year_id=3,
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=False,
    )
    db.add_all([hist, curr, fut])
    db.commit()

    # as_of date inside 2024-2025: fut (2025-2026) must be excluded for Teacher/Student
    as_of = date(2024, 10, 15)
    # Teacher with load in hist (2023-2024)
    p_hist = AcademicPeriod(
        academic_period_id=11,
        academic_year_id=hist.academic_year_id,
        period_sequence=1,
        period_name="Term 1",
        start_date=date(2023, 8, 1),
        end_date=date(2023, 11, 1),
        is_active=False,
    )
    db.add(p_hist)
    db.flush()
    load = SubjectLoad(
        staff_id="T-SPEC",
        class_id=1,
        subject_id=1,
        academic_period_id=p_hist.academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add(load)
    db.commit()

    years = get_authorized_academic_years(db, role="teacher", staff_id="T-SPEC", as_of=as_of)
    year_ids = [y.academic_year_id for y in years]
    assert hist.academic_year_id in year_ids
    assert fut.academic_year_id not in year_ids


def test_explicit_staff_and_student_id_kwargs(db, academic_world):
    """Calling get_authorized_academic_years with explicit staff_id or student_id kwargs works without user dict."""
    w = academic_world
    load = SubjectLoad(
        staff_id=w["staff_a"].staff_id,
        class_id=w["c_hist_recent"].class_id,
        subject_id=w["subject"].subject_id,
        academic_period_id=w["p_hist_recent"].academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add(load)
    enrollment = StudentClass(
        student_id=w["student_x"].student_id,
        class_id=w["c_hist_recent"].class_id,
        academic_year_id=w["hist_recent"].academic_year_id,
        enrollment_status="enrolled",
    )
    db.add(enrollment)
    db.commit()

    teacher_years = get_authorized_academic_years(db, staff_id=w["staff_a"].staff_id)
    assert [y.academic_year_id for y in teacher_years] == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]

    student_years = get_authorized_academic_years(db, student_id=w["student_x"].student_id)
    assert [y.academic_year_id for y in student_years] == [w["active_yr"].academic_year_id, w["hist_recent"].academic_year_id]


def test_original_teacher_retains_access_when_substituted(db, academic_world):
    """Original teacher on a load still retains historical visibility even when a substitute taught the class."""
    w = academic_world
    load = SubjectLoad(
        staff_id=w["staff_a"].staff_id,
        class_id=w["c_hist_old"].class_id,
        subject_id=w["subject"].subject_id,
        academic_period_id=w["p_hist_old"].academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add(load)
    db.flush()

    sub = TeacherSubstitution(
        subject_load_id=load.subject_load_id,
        original_staff_id=w["staff_a"].staff_id,
        substitute_staff_id=w["staff_b"].staff_id,
        start_date=date(2023, 9, 1),
        end_date=date(2023, 10, 1),
        status="completed",
    )
    db.add(sub)
    db.commit()

    # Both original Staff A and substitute Staff B retain historical access
    years_a = get_authorized_academic_years(db, staff_id=w["staff_a"].staff_id)
    assert w["hist_old"].academic_year_id in [y.academic_year_id for y in years_a]

    years_b = get_authorized_academic_years(db, staff_id=w["staff_b"].staff_id)
    assert w["hist_old"].academic_year_id in [y.academic_year_id for y in years_b]


def test_read_only_invariance_no_database_mutations(db, academic_world):
    """Calling authorization query must never mutate is_active or academic lifecycle states."""
    w = academic_world
    initial_active_state = {
        w["hist_old"].academic_year_id: w["hist_old"].is_active,
        w["hist_recent"].academic_year_id: w["hist_recent"].is_active,
        w["active_yr"].academic_year_id: w["active_yr"].is_active,
        w["future_yr"].academic_year_id: w["future_yr"].is_active,
        w["future_far"].academic_year_id: w["future_far"].is_active,
    }

    # Query for admin, teacher, student
    get_authorized_academic_years(db, role="admin")
    get_authorized_academic_years(db, role="teacher", staff_id=w["staff_a"].staff_id)
    get_authorized_academic_years(db, role="student", student_id=w["student_x"].student_id)

    db.expire_all()
    final_active_state = {
        w["hist_old"].academic_year_id: db.get(AcademicYear, w["hist_old"].academic_year_id).is_active,
        w["hist_recent"].academic_year_id: db.get(AcademicYear, w["hist_recent"].academic_year_id).is_active,
        w["active_yr"].academic_year_id: db.get(AcademicYear, w["active_yr"].academic_year_id).is_active,
        w["future_yr"].academic_year_id: db.get(AcademicYear, w["future_yr"].academic_year_id).is_active,
        w["future_far"].academic_year_id: db.get(AcademicYear, w["future_far"].academic_year_id).is_active,
    }

    assert initial_active_state == final_active_state
    # Only active_yr is active
    assert final_active_state[w["active_yr"].academic_year_id] is True
    assert final_active_state[w["hist_old"].academic_year_id] is False
    assert final_active_state[w["future_yr"].academic_year_id] is False

