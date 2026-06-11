import importlib.util
import uuid
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import CheckConstraint, ForeignKeyConstraint, create_engine, event, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassService import build_student_class_assignment


MIGRATION_PATH = (
    Path(__file__).parents[1]
    / "migrations"
    / "versions"
    / "20260606_student_class_academic_year_integrity.py"
)
TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    AcademicPeriod.__table__,
    Student.__table__,
    Class.__table__,
    StudentClass.__table__,
]


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, connection_record):
        connection.execute("PRAGMA foreign_keys=ON")

    lrn_check = next(
        constraint
        for constraint in Student.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    Student.__table__.constraints.remove(lrn_check)
    Base.metadata.create_all(bind=engine, tables=TABLES)
    Student.__table__.append_constraint(lrn_check)

    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


@pytest.fixture
def assignment_records(db):
    year_a = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    year_b = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=False,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year_a, year_b, level])
    db.flush()

    class_a1 = Class(
        section_name="Sapphire",
        academic_year_id=year_a.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    class_a2 = Class(
        section_name="Emerald",
        academic_year_id=year_a.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    class_b = Class(
        section_name="Ruby",
        academic_year_id=year_b.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Alex",
        last_name="Student",
        academic_level_id=level.academic_level_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000002",
        first_name="Blair",
        last_name="Student",
        academic_level_id=level.academic_level_id,
    )
    db.add_all([class_a1, class_a2, class_b, student, other_student])
    db.commit()
    return student, other_student, class_a1, class_a2, class_b


def load_migration_module():
    spec = importlib.util.spec_from_file_location("student_class_year_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_student_class_orm_declares_student_year_uniqueness():
    unique_column_sets = {
        tuple(constraint.columns.keys())
        for constraint in StudentClass.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("student_id", "academic_year_id") in unique_column_sets


def test_student_class_orm_declares_matching_class_year_foreign_key():
    composite_foreign_keys = [
        constraint
        for constraint in StudentClass.__table__.constraints
        if isinstance(constraint, ForeignKeyConstraint)
        and tuple(constraint.columns.keys()) == ("class_id", "academic_year_id")
    ]

    assert len(composite_foreign_keys) == 1
    assert composite_foreign_keys[0].ondelete == "CASCADE"


def test_class_orm_declares_composite_unique_target():
    unique_column_sets = {
        tuple(constraint.columns.keys())
        for constraint in Class.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("class_id", "academic_year_id") in unique_column_sets


def test_student_class_requires_academic_year_id():
    assert StudentClass.__table__.c.academic_year_id.nullable is False


def test_assignment_builder_copies_academic_year_from_class(assignment_records):
    student, _, class_a1, _, _ = assignment_records

    assignment = build_student_class_assignment(student.student_id, class_a1)

    assert assignment.class_id == class_a1.class_id
    assert assignment.academic_year_id == class_a1.academic_year_id


def test_student_cannot_join_two_classes_in_the_same_year(db, assignment_records):
    student, _, class_a1, class_a2, _ = assignment_records
    db.add(build_student_class_assignment(student.student_id, class_a1))
    db.commit()

    db.add(build_student_class_assignment(student.student_id, class_a2))

    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_student_can_join_classes_in_different_years(db, assignment_records):
    student, _, class_a1, _, class_b = assignment_records
    db.add(build_student_class_assignment(student.student_id, class_a1))
    db.add(build_student_class_assignment(student.student_id, class_b))

    db.commit()

    assert db.query(StudentClass).filter(StudentClass.student_id == student.student_id).count() == 2


def test_assignment_cannot_use_year_that_differs_from_class(db, assignment_records):
    _, other_student, class_a1, _, class_b = assignment_records
    db.add(
        StudentClass(
            student_id=other_student.student_id,
            class_id=class_a1.class_id,
            academic_year_id=class_b.academic_year_id,
            enrollment_status="enrolled",
        )
    )

    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_migration_reports_duplicate_student_year_assignments():
    migration = load_migration_module()
    bind = Mock()
    bind.execute.return_value.fetchall.return_value = [
        SimpleNamespace(
            student_id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
            academic_year_id=1,
            class_ids=[10, 11],
        )
    ]

    with pytest.raises(RuntimeError) as exc_info:
        migration._validate_no_duplicate_student_years(bind)

    message = str(exc_info.value)
    assert "student_id=00000000-0000-0000-0000-000000000001" in message
    assert "academic_year_id=1" in message
    assert "conflicting class_ids=[10, 11]" in message
    assert "Review these records manually" in message


def test_migration_reports_orphaned_class_assignments():
    migration = load_migration_module()
    bind = Mock()
    bind.execute.return_value.fetchall.return_value = [
        SimpleNamespace(student_class_id=7, class_id=99)
    ]

    with pytest.raises(RuntimeError) as exc_info:
        migration._validate_no_orphaned_classes(bind)

    message = str(exc_info.value)
    assert "student_class_id=7, class_id=99" in message
    assert "Review these records manually" in message
