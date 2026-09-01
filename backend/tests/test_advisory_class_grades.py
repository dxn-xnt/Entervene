"""
Tests for Step 6b: Adviser-facing finalized subject grades view.
Endpoint: GET /api/v1/classes/teacher/advisory/{class_id}/grades
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassQueryService import get_teacher_advisory_class_grades_data


@pytest.fixture
def advisory_grades_setup():
    """Seed a test environment with an advisory class, 2 subjects, 2 teachers, and enrolled students."""
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

    # 1. Academic Year & Periods
    ay = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(ay)
    db.flush()

    p1 = AcademicPeriod(
        academic_year_id=ay.academic_year_id,
        period_name="Term 1",
        period_sequence=1,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=True,
    )
    p2 = AcademicPeriod(
        academic_year_id=ay.academic_year_id,
        period_name="Term 2",
        period_sequence=2,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        is_active=False,
    )
    db.add_all([p1, p2])
    db.flush()

    # 2. Academic Level
    level = AcademicLevel(
        level_name="Grade 7",
        grade_level=7,
    )
    db.add(level)
    db.flush()

    # 3. Staff / Teachers
    uid_adv = uuid.uuid4()
    u_adv = UserAccount(user_id=uid_adv, email=f"adviser_{uuid.uuid4().hex[:6]}@school.edu", account_status="active")
    staff_adv = AcademicStaff(
        staff_id=f"T-ADV-{uuid.uuid4().hex[:4]}",
        user_id=uid_adv,
        first_name="Maria",
        last_name="Santos",
    )

    uid_sub = uuid.uuid4()
    u_sub = UserAccount(user_id=uid_sub, email=f"sub_{uuid.uuid4().hex[:6]}@school.edu", account_status="active")
    staff_sub = AcademicStaff(
        staff_id=f"T-SUB-{uuid.uuid4().hex[:4]}",
        user_id=uid_sub,
        first_name="Juan",
        last_name="Reyes",
    )

    uid_oth = uuid.uuid4()
    u_oth = UserAccount(user_id=uid_oth, email=f"oth_{uuid.uuid4().hex[:6]}@school.edu", account_status="active")
    staff_oth = AcademicStaff(
        staff_id=f"T-OTH-{uuid.uuid4().hex[:4]}",
        user_id=uid_oth,
        first_name="Pedro",
        last_name="Cruz",
    )
    db.add_all([u_adv, staff_adv, u_sub, staff_sub, u_oth, staff_oth])
    db.flush()

    # 4. Class (Section) advised by staff_adv
    cls = Class(
        section_name="7-Diamond",
        academic_year_id=ay.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=staff_adv.staff_id,
    )
    db.add(cls)
    db.flush()

    # 5. Subjects & SubjectLoads
    s1 = Subject(subject_name="Mathematics 7", subject_codename="MATH-7", academic_level_id=level.academic_level_id)
    s2 = Subject(subject_name="Science 7", subject_codename="SCI-7", academic_level_id=level.academic_level_id)
    db.add_all([s1, s2])
    db.flush()

    sl1 = SubjectLoad(
        class_id=cls.class_id,
        subject_id=s1.subject_id,
        staff_id=staff_adv.staff_id,
        academic_period_id=p1.academic_period_id,
        status="active",
    )
    sl2 = SubjectLoad(
        class_id=cls.class_id,
        subject_id=s2.subject_id,
        staff_id=staff_sub.staff_id,
        academic_period_id=p1.academic_period_id,
        status="active",
    )
    db.add_all([sl1, sl2])
    db.flush()

    # 6. Students & Enrollment
    uid_stu1 = uuid.uuid4()
    u_stu1 = UserAccount(user_id=uid_stu1, email=f"stu1_{uuid.uuid4().hex[:6]}@school.edu", account_status="active")
    stu1 = Student(
        student_id=uuid.uuid4(),
        user_id=uid_stu1,
        student_lrn="123456789001",
        first_name="Ana",
        last_name="Alcantara",
        gender="Female",
        academic_level_id=level.academic_level_id,
    )
    uid_stu2 = uuid.uuid4()
    u_stu2 = UserAccount(user_id=uid_stu2, email=f"stu2_{uuid.uuid4().hex[:6]}@school.edu", account_status="active")
    stu2 = Student(
        student_id=uuid.uuid4(),
        user_id=uid_stu2,
        student_lrn="123456789002",
        first_name="Ben",
        last_name="Bautista",
        gender="Male",
        academic_level_id=level.academic_level_id,
    )
    db.add_all([u_stu1, stu1, u_stu2, stu2])
    db.flush()

    sc1 = StudentClass(
        student_id=stu1.student_id,
        class_id=cls.class_id,
        academic_year_id=ay.academic_year_id,
        enrollment_status="enrolled",
    )
    sc2 = StudentClass(
        student_id=stu2.student_id,
        class_id=cls.class_id,
        academic_year_id=ay.academic_year_id,
        enrollment_status="enrolled",
    )
    db.add_all([sc1, sc2])
    db.commit()

    return {
        "db": db,
        "ay": ay,
        "p1": p1,
        "p2": p2,
        "level": level,
        "staff_adv": staff_adv,
        "staff_sub": staff_sub,
        "staff_oth": staff_oth,
        "cls": cls,
        "s1": s1,
        "s2": s2,
        "stu1": stu1,
        "stu2": stu2,
    }


def test_adviser_access_success(advisory_grades_setup):
    """Assigned adviser can view advisory grades for the section."""
    env = advisory_grades_setup
    db = env["db"]
    res = get_teacher_advisory_class_grades_data(
        db=db,
        class_id=env["cls"].class_id,
        staff_id=env["staff_adv"].staff_id,
        academic_period_id=env["p1"].academic_period_id,
    )
    assert res["class_id"] == env["cls"].class_id
    assert res["section_name"] == "7-Diamond"
    assert res["academic_period_id"] == env["p1"].academic_period_id
    assert len(res["periods"]) == 2
    assert len(res["subjects"]) == 2
    assert len(res["students"]) == 2
    assert res["total_students"] == 2


def test_non_adviser_access_forbidden(advisory_grades_setup):
    """Unassigned teacher gets 403 Forbidden."""
    env = advisory_grades_setup
    db = env["db"]
    with pytest.raises(HTTPException) as exc:
        get_teacher_advisory_class_grades_data(
            db=db,
            class_id=env["cls"].class_id,
            staff_id=env["staff_oth"].staff_id,
        )
    assert exc.value.status_code == 403


def test_subject_teacher_not_adviser_access_forbidden(advisory_grades_setup):
    """Teacher who teaches a subject in the class but is not the adviser gets 403 Forbidden."""
    env = advisory_grades_setup
    db = env["db"]
    with pytest.raises(HTTPException) as exc:
        get_teacher_advisory_class_grades_data(
            db=db,
            class_id=env["cls"].class_id,
            staff_id=env["staff_sub"].staff_id,
        )
    assert exc.value.status_code == 403


def test_advisory_grades_matrix_finalized_and_pending(advisory_grades_setup):
    """Student with finalized Subject 1 and pending Subject 2 reflects both states correctly."""
    env = advisory_grades_setup
    db = env["db"]

    # Finalize Subject 1 for stu1 (Score = 92.0 -> Advancing)
    pg1 = StudentPeriodGrade(
        student_id=env["stu1"].student_id,
        class_id=env["cls"].class_id,
        subject_id=env["s1"].subject_id,
        academic_period_id=env["p1"].academic_period_id,
        final_period_grade=Decimal("92.00"),
        is_finalized=True,
        finalized_at=datetime.now(timezone.utc),
        finalized_by_staff_id=env["staff_adv"].staff_id,
    )
    db.add(pg1)
    db.commit()

    res = get_teacher_advisory_class_grades_data(
        db=db,
        class_id=env["cls"].class_id,
        staff_id=env["staff_adv"].staff_id,
        academic_period_id=env["p1"].academic_period_id,
    )

    stu1_row = next(s for s in res["students"] if s["student_id"] == str(env["stu1"].student_id))
    assert stu1_row["finalized_count"] == 1
    assert stu1_row["total_subjects_count"] == 2
    assert stu1_row["is_all_finalized"] is False
    assert stu1_row["gwa"] == 92.0
    assert stu1_row["gwa_descriptor"] == "Advancing"

    # Subject 1 is finalized
    s1_grade = stu1_row["grades"][env["s1"].subject_id]
    assert s1_grade["is_finalized"] is True
    assert s1_grade["status"] == "finalized"
    assert s1_grade["final_period_grade"] == 92.0
    assert s1_grade["performance_descriptor"] == "Advancing"

    # Subject 2 is pending
    s2_grade = stu1_row["grades"][env["s2"].subject_id]
    assert s2_grade["is_finalized"] is False
    assert s2_grade["status"] == "pending"
    assert s2_grade["final_period_grade"] is None
    assert s2_grade["performance_descriptor"] is None


def test_send_grade_and_advisory_view_sync(advisory_grades_setup):
    """Finalizing a subject grade immediately reflects in advisory view."""
    env = advisory_grades_setup
    db = env["db"]

    # Finalize Subject 2 for stu1 (Score = 84.0 -> Benchmarking)
    pg2 = StudentPeriodGrade(
        student_id=env["stu1"].student_id,
        class_id=env["cls"].class_id,
        subject_id=env["s2"].subject_id,
        academic_period_id=env["p1"].academic_period_id,
        final_period_grade=Decimal("84.00"),
        is_finalized=True,
        finalized_at=datetime.now(timezone.utc),
        finalized_by_staff_id=env["staff_sub"].staff_id,
    )
    db.add(pg2)
    db.commit()

    res = get_teacher_advisory_class_grades_data(
        db=db,
        class_id=env["cls"].class_id,
        staff_id=env["staff_adv"].staff_id,
        academic_period_id=env["p1"].academic_period_id,
    )

    stu1_row = next(s for s in res["students"] if s["student_id"] == str(env["stu1"].student_id))
    s2_grade = stu1_row["grades"][env["s2"].subject_id]
    assert s2_grade["is_finalized"] is True
    assert s2_grade["status"] == "finalized"
    assert s2_grade["final_period_grade"] == 84.0
    assert s2_grade["performance_descriptor"] == "Benchmarking"
    assert stu1_row["finalized_count"] == 1
    assert stu1_row["is_all_finalized"] is False
    assert stu1_row["gwa"] == 84.0
    assert stu1_row["gwa_descriptor"] == "Benchmarking"

    # Now finalize Subject 1 for stu1 (Score = 92.0 -> Advancing)
    pg1 = StudentPeriodGrade(
        student_id=env["stu1"].student_id,
        class_id=env["cls"].class_id,
        subject_id=env["s1"].subject_id,
        academic_period_id=env["p1"].academic_period_id,
        final_period_grade=Decimal("92.00"),
        is_finalized=True,
        finalized_at=datetime.now(timezone.utc),
        finalized_by_staff_id=env["staff_adv"].staff_id,
    )
    db.add(pg1)
    db.commit()

    res2 = get_teacher_advisory_class_grades_data(
        db=db,
        class_id=env["cls"].class_id,
        staff_id=env["staff_adv"].staff_id,
        academic_period_id=env["p1"].academic_period_id,
    )
    stu1_row2 = next(s for s in res2["students"] if s["student_id"] == str(env["stu1"].student_id))
    assert stu1_row2["finalized_count"] == 2
    assert stu1_row2["is_all_finalized"] is True
    assert stu1_row2["gwa"] == 88.0
    assert stu1_row2["gwa_descriptor"] == "Benchmarking"
