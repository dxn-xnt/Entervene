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
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.suggestion.SuggestionClasswork import SuggestionClasswork
from app.services.suggestion.SuggestionService import (
    complete_student_suggestion,
    list_student_suggestions,
)

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
    LessonAssignment.__table__,
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


def test_student_suggestions_workflow_isolation(db_session):
    s1_id = uuid.uuid4()
    s2_id = uuid.uuid4()

    s1 = Student(
        student_id=s1_id,
        first_name="Alice",
        last_name="Student",
        student_lrn="200000000001",
        dob=datetime.now(timezone.utc).date(),
        gender="FEMALE",
    )
    s2 = Student(
        student_id=s2_id,
        first_name="Bob",
        last_name="Student",
        student_lrn="200000000002",
        dob=datetime.now(timezone.utc).date(),
        gender="MALE",
    )
    db_session.add_all([s1, s2])

    year = AcademicYear(
        academic_year_id=1,
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
    )
    db_session.add(year)

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
    db_session.add(c1)

    sc1 = StudentClass(student_id=s1_id, class_id=1, academic_year_id=1, enrollment_status="enrolled")
    sc2 = StudentClass(student_id=s2_id, class_id=1, academic_year_id=1, enrollment_status="enrolled")
    db_session.add_all([sc1, sc2])

    sub1 = Subject(subject_id=1, academic_level_id=1, subject_name="Math")
    db_session.add(sub1)

    l1 = Lesson(lesson_id=1, subject_id=1, title="Fraction Basics", is_published=True, is_draft=False)
    db_session.add(l1)

    la1 = LessonAssignment(lesson_id=1, class_id=1, is_published=True)
    db_session.add(la1)

    sug1 = StudentSuggestion(
        student_suggestion_id=10,
        student_id=s1_id,
        subject_id=1,
        lesson_id=1,
        suggestion_type="AUTOMATED",
        resource_type="LESSON",
        title="Remedial Fractions",
        priority="HIGH",
        status="ACTIVE",
    )
    sug2 = StudentSuggestion(
        student_suggestion_id=20,
        student_id=s2_id,
        subject_id=1,
        lesson_id=1,
        suggestion_type="AUTOMATED",
        resource_type="LESSON",
        title="Remedial Decimals",
        priority="URGENT",
        status="ACTIVE",
    )
    db_session.add_all([sug1, sug2])
    db_session.commit()

    # Query suggestions for S1 -> receives ONLY sug1
    s1_list = list_student_suggestions(db_session, s1, status=None)
    assert [s.student_suggestion_id for s in s1_list.suggestions] == [10]

    # Query suggestions for S2 -> receives ONLY sug2
    s2_list = list_student_suggestions(db_session, s2, status=None)
    assert [s.student_suggestion_id for s in s2_list.suggestions] == [20]

    # Student S1 completes suggestion 10
    completed = complete_student_suggestion(db_session, s1, 10)
    assert completed.status == "COMPLETED"

    # Verify active suggestions query for S1 is now empty
    s1_active = list_student_suggestions(db_session, s1, status="ACTIVE")
    assert len(s1_active.suggestions) == 0
