from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.suggestion.SuggestionClasswork import SuggestionClasswork
from app.services.suggestion.SuggestionService import list_teacher_suggestions

TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    SubjectLoad.__table__,
    StudentClass.__table__,
    Lesson.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSuggestion.__table__,
    SuggestionClasswork.__table__,
]


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    regex_checks = [
        c
        for c in Student.__table__.constraints
        if isinstance(c, CheckConstraint) and "~" in str(c.sqltext)
    ]
    for check in regex_checks:
        Student.__table__.constraints.remove(check)

    Base.metadata.create_all(bind=engine, tables=TABLES)

    for check in regex_checks:
        Student.__table__.append_constraint(check)

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()

    try:
        yield session
    finally:
        session.close()


def test_role_based_data_isolation_admin_vs_teacher(db_session):
    # Setup 2 students: S1 (assigned to Teacher T1) and S2 (unassigned to T1)
    s1_id = uuid.uuid4()
    s2_id = uuid.uuid4()

    s1 = Student(
        student_id=s1_id,
        first_name="Juan",
        last_name="Dela Cruz",
        student_lrn="100000000001",
        dob=datetime.now(timezone.utc).date(),
        gender="MALE",
    )
    s2 = Student(
        student_id=s2_id,
        first_name="Maria",
        last_name="Santos",
        student_lrn="100000000002",
        dob=datetime.now(timezone.utc).date(),
        gender="FEMALE",
    )
    db_session.add_all([s1, s2])

    t1 = AcademicStaff(
        staff_id="STF-001",
        first_name="Teacher",
        last_name="One",
        email="teacher1@school.edu.ph",
    )
    db_session.add(t1)

    year = AcademicYear(
        academic_year_id=1,
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
    )
    db_session.add(year)

    p1 = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Term 1",
        period_sequence=1,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 9, 30),
        is_active=True,
    )
    db_session.add(p1)

    level = AcademicLevel(
        academic_level_id=1,
        level_name="Grade 7",
        grade_level=7,
    )
    db_session.add(level)

    c1 = Class(
        class_id=1,
        academic_year_id=1,
        academic_level_id=1,
        section_name="Section A",
    )
    c2 = Class(
        class_id=2,
        academic_year_id=1,
        academic_level_id=1,
        section_name="Section B",
    )
    db_session.add_all([c1, c2])

    sub1 = Subject(subject_id=1, academic_level_id=1, subject_name="Math")
    sub2 = Subject(subject_id=2, academic_level_id=1, subject_name="Science")
    db_session.add_all([sub1, sub2])

    # Enroll S1 in Class 1
    sc1 = StudentClass(student_id=s1_id, class_id=1, academic_year_id=1, enrollment_status="enrolled")
    # Enroll S2 in Class 2
    sc2 = StudentClass(student_id=s2_id, class_id=2, academic_year_id=1, enrollment_status="enrolled")
    db_session.add_all([sc1, sc2])

    # Assign Teacher T1 to Class 1 / Subject 1 only
    load1 = SubjectLoad(
        subject_load_id=1,
        staff_id="STF-001",
        class_id=1,
        subject_id=1,
        academic_period_id=1,
        status="active",
    )
    db_session.add(load1)

    # Lessons
    l1 = Lesson(lesson_id=1, subject_id=1, title="Algebra", is_published=True, is_draft=False)
    l2 = Lesson(lesson_id=2, subject_id=2, title="Physics", is_published=True, is_draft=False)
    db_session.add_all([l1, l2])

    # Suggestion 1 for S1 (Math, Class 1)
    sug1 = StudentSuggestion(
        student_suggestion_id=1,
        student_id=s1_id,
        subject_id=1,
        lesson_id=1,
        suggestion_type="AUTOMATED",
        resource_type="LESSON",
        title="Remedial Math",
        priority="HIGH",
        status="ACTIVE",
    )
    # Suggestion 2 for S2 (Science, Class 2 - not in T1's subject load)
    sug2 = StudentSuggestion(
        student_suggestion_id=2,
        student_id=s2_id,
        subject_id=2,
        lesson_id=2,
        suggestion_type="AUTOMATED",
        resource_type="LESSON",
        title="Remedial Science",
        priority="URGENT",
        status="ACTIVE",
    )
    db_session.add_all([sug1, sug2])
    db_session.commit()

    # Test Teacher View (is_admin=False, staff_id="STF-001")
    teacher_res = list_teacher_suggestions(db_session, staff_id="STF-001", is_admin=False)
    teacher_suggestion_ids = [s.student_suggestion_id for s in teacher_res.suggestions]
    assert teacher_suggestion_ids == [1]  # Only receives S1 suggestion!

    # Test Admin View (is_admin=True)
    admin_res = list_teacher_suggestions(db_session, staff_id=None, is_admin=True)
    admin_suggestion_ids = [s.student_suggestion_id for s in admin_res.suggestions]
    assert set(admin_suggestion_ids) == {1, 2}  # Receives all suggestions school-wide!
