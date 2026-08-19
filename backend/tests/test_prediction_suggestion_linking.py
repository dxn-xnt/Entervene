from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

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
from app.models.academic.Subject import Subject
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.TeacherRiskReview import TeacherRiskReview
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.suggestion.SuggestionClasswork import SuggestionClasswork
from app.services.prediction.PredictionSuggestionService import (
    assign_intervention_from_prediction,
    get_suggestions_for_prediction,
)

TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    Lesson.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    AIPrediction.__table__,
    StudentSuggestion.__table__,
    SuggestionClasswork.__table__,
    TeacherRiskReview.__table__,
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

    Base.metadata.create_all(bind=engine)

    for check in regex_checks:
        Student.__table__.append_constraint(check)

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()

    try:
        yield session
    finally:
        session.close()


def test_assign_intervention_from_prediction_creates_suggestion_and_review(db_session):
    student_id = uuid.uuid4()
    student = Student(
        student_id=student_id,
        first_name="Juan",
        last_name="Dela Cruz",
        student_lrn="123456789012",
        dob=datetime.now(timezone.utc).date(),
        gender="MALE",
    )
    db_session.add(student)

    staff = AcademicStaff(
        staff_id="STF001",
        first_name="Maria",
        last_name="Santos",
        email="maria@school.edu.ph",
    )
    db_session.add(staff)

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

    class_obj = Class(
        class_id=1,
        academic_year_id=1,
        academic_level_id=1,
        section_name="Grade 7 - Newton",
    )
    db_session.add(class_obj)

    subject = Subject(subject_id=1, academic_level_id=1, subject_name="Mathematics 7")
    db_session.add(subject)

    lesson = Lesson(
        lesson_id=1,
        subject_id=1,
        title="Quadratic Equations Review",
        order_index=1,
        is_published=True,
        is_draft=False,
        is_locked=False,
    )
    db_session.add(lesson)

    p1 = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Term 1",
        period_sequence=1,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 9, 30),
        is_active=True,
    )
    p2 = AcademicPeriod(
        academic_period_id=2,
        academic_year_id=1,
        period_name="Term 2",
        period_sequence=2,
        start_date=date(2025, 10, 1),
        end_date=date(2025, 12, 31),
        is_active=False,
    )
    db_session.add_all([p1, p2])

    prediction = AIPrediction(
        student_id=student_id,
        class_id=1,
        subject_id=1,
        source_period_id=1,
        target_period_id=2,
        predicted_period_grade=Decimal("71.50"),
        risk_score=Decimal("82.00"),
        risk_level="HIGH_RISK",
        data_status="SUFFICIENT",
    )
    db_session.add(prediction)
    db_session.commit()

    # Assign intervention
    payload = {
        "resource_type": "LESSON",
        "lesson_id": 1,
        "title": "Remedial Quadratic Equations Review",
        "description": "Targeted lesson for high risk student.",
        "priority": "HIGH",
    }

    suggestion = assign_intervention_from_prediction(
        db_session, prediction.prediction_id, staff_id="STF001", payload=payload
    )

    assert suggestion.student_suggestion_id is not None
    assert suggestion.prediction_id == prediction.prediction_id
    assert suggestion.suggestion_type == "AUTOMATED"
    assert suggestion.resource_type == "LESSON"
    assert suggestion.lesson_id == 1
    assert suggestion.title == "Remedial Quadratic Equations Review"
    assert suggestion.priority == "HIGH"
    assert suggestion.status == "ACTIVE"

    # Query linked suggestions
    linked = get_suggestions_for_prediction(db_session, prediction.prediction_id)
    assert len(linked) == 1
    assert linked[0].student_suggestion_id == suggestion.student_suggestion_id
