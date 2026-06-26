import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.suggestion.SuggestionClasswork import SuggestionClasswork


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    Class.__table__,
    Lesson.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSuggestion.__table__,
    SuggestionClasswork.__table__,
]


@pytest.fixture
def suggestion_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        constraint
        for constraint in Student.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    Student.__table__.constraints.remove(lrn_check)
    Base.metadata.create_all(bind=engine, tables=TABLES)
    Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


def _base_suggestion_graph(db):
    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()

    staff = AcademicStaff(staff_id="T-SUG", first_name="Suggest", last_name="Teacher")
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Study",
        last_name="Student",
        academic_level_id=level.academic_level_id,
    )
    subject = Subject(subject_name="English", academic_level_id=level.academic_level_id)
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([staff, student, subject, class_])
    db.flush()

    lesson = Lesson(
        title="Nouns",
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_draft=False,
    )
    classwork = Classwork(
        title="Nouns Reading",
        classwork_type="READING",
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
    )
    db.add_all([lesson, classwork])
    db.flush()

    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=class_.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()

    return {
        "staff": staff,
        "student": student,
        "subject": subject,
        "lesson": lesson,
        "assignment": assignment,
    }


def _lesson_suggestion(data, **overrides):
    values = {
        "resource_type": "LESSON",
        "title": "Review nouns",
        "description": "Practice identifying nouns.",
        "student_id": data["student"].student_id,
        "subject_id": data["subject"].subject_id,
        "lesson_id": data["lesson"].lesson_id,
        "created_by_staff_id": data["staff"].staff_id,
    }
    values.update(overrides)
    return StudentSuggestion(**values)


def _classwork_suggestion(data, **overrides):
    values = {
        "resource_type": "CLASSWORK",
        "title": "Open the reading material",
        "student_id": data["student"].student_id,
        "subject_id": data["subject"].subject_id,
        "created_by_staff_id": data["staff"].staff_id,
        "resource_links": {
            "resource_type": "CLASSWORK",
            "classwork_assignment_id": data["assignment"].classwork_assignment_id,
        },
    }
    values.update(overrides)
    return StudentSuggestion(**values)


def test_suggestion_models_register_and_persist_relationships(suggestion_db):
    data = _base_suggestion_graph(suggestion_db)
    suggestion = _classwork_suggestion(data, priority="HIGH")
    suggestion.classwork_link = SuggestionClasswork(
        classwork_assignment_id=data["assignment"].classwork_assignment_id,
        score_before=Decimal("62.50"),
    )
    suggestion_db.add(suggestion)
    suggestion_db.commit()

    saved = suggestion_db.query(StudentSuggestion).one()
    assert saved.suggestion_type == "MANUAL"
    assert saved.status == "ACTIVE"
    assert saved.priority == "HIGH"
    assert saved.student.student_id == data["student"].student_id
    assert saved.subject.subject_id == data["subject"].subject_id
    assert saved.created_by_staff.staff_id == data["staff"].staff_id
    assert saved.classwork_link.classwork_assignment_id == data["assignment"].classwork_assignment_id
    assert saved.classwork_link.score_before == Decimal("62.50")


def test_suggestion_status_priority_and_resource_checks_are_enforced(suggestion_db):
    data = _base_suggestion_graph(suggestion_db)

    suggestion_db.add(_lesson_suggestion(data, status="PENDING"))
    with pytest.raises(IntegrityError):
        suggestion_db.commit()
    suggestion_db.rollback()

    suggestion_db.add(_lesson_suggestion(data, priority="CRITICAL"))
    with pytest.raises(IntegrityError):
        suggestion_db.commit()
    suggestion_db.rollback()

    suggestion_db.add(_lesson_suggestion(data, resource_type="CLASSWORK"))
    with pytest.raises(IntegrityError):
        suggestion_db.commit()


def test_duplicate_active_lesson_suggestions_are_blocked(suggestion_db):
    data = _base_suggestion_graph(suggestion_db)
    first = _lesson_suggestion(data)
    suggestion_db.add(first)
    suggestion_db.commit()

    suggestion_db.add(_lesson_suggestion(data))
    with pytest.raises(IntegrityError):
        suggestion_db.commit()
    suggestion_db.rollback()

    first.status = "COMPLETED"
    suggestion_db.add(first)
    suggestion_db.commit()

    suggestion_db.add(_lesson_suggestion(data))
    suggestion_db.commit()
    assert suggestion_db.query(StudentSuggestion).count() == 2


def test_classwork_link_constraints_are_enforced(suggestion_db):
    data = _base_suggestion_graph(suggestion_db)
    suggestion = _classwork_suggestion(data)
    suggestion_db.add(suggestion)
    suggestion_db.flush()
    suggestion_db.add_all([
        SuggestionClasswork(
            student_suggestion_id=suggestion.student_suggestion_id,
            classwork_assignment_id=data["assignment"].classwork_assignment_id,
        ),
        SuggestionClasswork(
            student_suggestion_id=suggestion.student_suggestion_id,
            classwork_assignment_id=data["assignment"].classwork_assignment_id,
        ),
    ])

    with pytest.raises(IntegrityError):
        suggestion_db.commit()


def test_classwork_score_constraints_are_enforced(suggestion_db):
    data = _base_suggestion_graph(suggestion_db)
    suggestion = _classwork_suggestion(data)
    suggestion.classwork_link = SuggestionClasswork(
        classwork_assignment_id=data["assignment"].classwork_assignment_id,
        score_before=Decimal("-1.00"),
    )
    suggestion_db.add(suggestion)

    with pytest.raises(IntegrityError):
        suggestion_db.commit()
