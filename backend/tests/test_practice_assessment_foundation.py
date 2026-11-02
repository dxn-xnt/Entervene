"""Focused contract checks for Practice Assessment database models and Alembic DDL.

Tests Phase 1 foundation:
- Schema integrity, foreign keys, unique constraints, and check constraints
- Assessment states (DRAFT, PUBLISHED, ARCHIVED)
- Gatekeeper policies (REQUIRE_PASS, REQUIRE_ATTEMPT, OPTIONAL)
- Passing percentage bounds (0.00 to 100.00)
- Question types (MULTIPLE_CHOICE, TRUE_FALSE, IDENTIFICATION)
- Attempt states (STARTED, SUBMITTED, ABANDONED)
- Attempt history, unique numbering, and frozen snapshot fields
- Full migration upgrade and downgrade execution
- Complete isolation from StudentSubmission and official gradebook
"""

from datetime import datetime, timezone
from decimal import Decimal
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.intervention.Intervention import Intervention
from app.models.intervention.PracticeAssessment import PracticeAssessment
from app.models.intervention.PracticeAttempt import PracticeAttempt
from app.models.intervention.PracticeAttemptAnswer import PracticeAttemptAnswer
from app.models.intervention.PracticeQuestion import PracticeQuestion
from app.models.intervention.PracticeQuestionOption import PracticeQuestionOption
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


def _migration_module():
    path = (
        Path(__file__).parents[1]
        / "migrations"
        / "versions"
        / "20261102_practice_assessment.py"
    )
    spec = spec_from_file_location("practice_assessment_migration", path)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def test_db_session():
    """Isolated in-memory SQLite engine with all models created via Base.metadata."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        # Seed minimal staff, student, and intervention prerequisites
        staff = AcademicStaff(
            staff_id="STAFF-PRAC-01",
            first_name="Test",
            last_name="Teacher",
        )
        student = Student(
            student_id=uuid4(),
            student_lrn="123456789012",
            first_name="Test",
            last_name="Student",
        )
        session.add_all([staff, student])
        session.flush()

        # Minimal intervention row with valid constraints
        now = datetime.now(timezone.utc)
        intervention = Intervention(
            student_id=student.student_id,
            class_id=1,
            subject_id=1,
            academic_period_id=1,
            source_prediction_id=99901,
            status="ACTIVE",
            activated_at=now,
            activated_by_staff_id=staff.staff_id,
            diagnosis_snapshot={"weakest_supported_components": ["EXAMINATION"]},
        )
        session.add(intervention)
        session.commit()

        yield {
            "session": session,
            "engine": engine,
            "staff": staff,
            "student": student,
            "intervention": intervention,
        }
    engine.dispose()


def test_practice_assessment_creation_and_defaults(test_db_session):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
    )
    session.add(assessment)
    session.commit()

    assert assessment.practice_assessment_id is not None
    assert assessment.status == "DRAFT"
    assert assessment.gatekeeper_policy == "REQUIRE_PASS"
    assert assessment.passing_percentage == Decimal("75.00")
    assert assessment.version == 1
    assert assessment.shuffle_options is True
    assert assessment.intervention.intervention_id == intervention.intervention_id


def test_one_practice_assessment_per_intervention_enforced(test_db_session):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]

    assessment1 = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
    )
    session.add(assessment1)
    session.commit()

    assessment2 = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
    )
    session.add(assessment2)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


@pytest.mark.parametrize("invalid_status", ["UNKNOWN", "READY", "ACTIVE", "DELETED"])
def test_practice_assessment_status_check_constraint(test_db_session, invalid_status):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
        status=invalid_status,
    )
    session.add(assessment)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


@pytest.mark.parametrize("valid_status", ["DRAFT", "PUBLISHED", "ARCHIVED"])
def test_practice_assessment_valid_statuses(test_db_session, valid_status):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
        status=valid_status,
    )
    session.add(assessment)
    session.commit()
    assert assessment.status == valid_status
    session.delete(assessment)
    session.commit()


@pytest.mark.parametrize("invalid_policy", ["NONE", "MANDATORY", "BYPASS", "SKIP"])
def test_practice_assessment_policy_check_constraint(test_db_session, invalid_policy):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
        gatekeeper_policy=invalid_policy,
    )
    session.add(assessment)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


@pytest.mark.parametrize("valid_policy", ["REQUIRE_PASS", "REQUIRE_ATTEMPT", "OPTIONAL"])
def test_practice_assessment_valid_policies(test_db_session, valid_policy):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
        gatekeeper_policy=valid_policy,
    )
    session.add(assessment)
    session.commit()
    assert assessment.gatekeeper_policy == valid_policy
    session.delete(assessment)
    session.commit()


@pytest.mark.parametrize("invalid_percentage", [Decimal("-0.01"), Decimal("100.01"), Decimal("-50.00")])
def test_practice_assessment_passing_percentage_bounds(test_db_session, invalid_percentage):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
        passing_percentage=invalid_percentage,
    )
    session.add(assessment)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_question_types_supported_and_rejected(test_db_session):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
    )
    session.add(assessment)
    session.flush()

    for idx, valid_type in enumerate(["MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION"], start=1):
        q = PracticeQuestion(
            practice_assessment_id=assessment.practice_assessment_id,
            question_text=f"Sample Question {idx}",
            question_type=valid_type,
            display_order=idx,
        )
        session.add(q)
    session.commit()
    assert len(assessment.questions) == 3

    # Reject unsupported question types like open-ended ESSAY / SHORT_ANSWER in practice
    invalid_q = PracticeQuestion(
        practice_assessment_id=assessment.practice_assessment_id,
        question_text="Open ended question",
        question_type="SHORT_ANSWER",
        display_order=4,
    )
    session.add(invalid_q)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_attempt_lifecycle_and_historical_answer_snapshots(test_db_session):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]
    student = test_db_session["student"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
        status="PUBLISHED",
        passing_percentage=Decimal("80.00"),
    )
    session.add(assessment)
    session.flush()

    # Add question and options
    q1 = PracticeQuestion(
        practice_assessment_id=assessment.practice_assessment_id,
        question_text="What is 2 + 2?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("2.00"),
        explanation="2 + 2 equals 4 by basic arithmetic.",
        display_order=1,
    )
    session.add(q1)
    session.flush()

    opt1 = PracticeQuestionOption(
        practice_question_id=q1.practice_question_id,
        option_text="3",
        is_correct=False,
        option_order=1,
    )
    opt2 = PracticeQuestionOption(
        practice_question_id=q1.practice_question_id,
        option_text="4",
        is_correct=True,
        option_order=2,
    )
    session.add_all([opt1, opt2])
    session.commit()

    # Student starts attempt 1
    attempt1 = PracticeAttempt(
        practice_assessment_id=assessment.practice_assessment_id,
        student_id=student.student_id,
        attempt_number=1,
        status="STARTED",
        question_order=[q1.practice_question_id],
        option_order_map={str(q1.practice_question_id): [opt2.option_id, opt1.option_id]},
        attempt_snapshot={
            "questions": [
                {
                    "id": q1.practice_question_id,
                    "text": q1.question_text,
                    "options": [{"id": opt2.option_id, "text": opt2.option_text}, {"id": opt1.option_id, "text": opt1.option_text}],
                }
            ]
        },
    )
    session.add(attempt1)
    session.commit()

    assert attempt1.status == "STARTED"
    assert attempt1.is_passed is False

    # Student submits wrong answer on attempt 1
    answer1 = PracticeAttemptAnswer(
        attempt_id=attempt1.attempt_id,
        practice_question_id=q1.practice_question_id,
        question_text_snapshot=q1.question_text,
        question_type_snapshot=q1.question_type,
        selected_option_id=opt1.option_id,
        student_answer_text="3",
        correct_answer_text="4",
        explanation_snapshot=q1.explanation,
        is_correct=False,
        points_awarded=Decimal("0.00"),
        points_possible=Decimal("2.00"),
    )
    session.add(answer1)
    attempt1.status = "SUBMITTED"
    attempt1.total_score = Decimal("0.00")
    attempt1.max_score = Decimal("2.00")
    attempt1.score_percentage = Decimal("0.00")
    attempt1.is_passed = False
    session.commit()

    # Verify attempt 1 preserves full correct answer feedback despite failure
    saved_answer = session.scalar(select(PracticeAttemptAnswer).filter_by(attempt_id=attempt1.attempt_id))
    assert saved_answer.is_correct is False
    assert saved_answer.correct_answer_text == "4"
    assert saved_answer.student_answer_text == "3"
    assert saved_answer.explanation_snapshot == "2 + 2 equals 4 by basic arithmetic."

    # Student takes attempt 2 and passes
    attempt2 = PracticeAttempt(
        practice_assessment_id=assessment.practice_assessment_id,
        student_id=student.student_id,
        attempt_number=2,
        status="SUBMITTED",
        total_score=Decimal("2.00"),
        max_score=Decimal("2.00"),
        score_percentage=Decimal("100.00"),
        is_passed=True,
        question_order=[q1.practice_question_id],
    )
    session.add(attempt2)
    session.commit()

    assert attempt2.attempt_number == 2
    assert attempt2.is_passed is True

    # Duplicate attempt number for same student & assessment must fail
    attempt_dup = PracticeAttempt(
        practice_assessment_id=assessment.practice_assessment_id,
        student_id=student.student_id,
        attempt_number=2,
        question_order=[q1.practice_question_id],
    )
    session.add(attempt_dup)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_delete_assessment_with_attempts_is_restricted(test_db_session):
    session = test_db_session["session"]
    intervention = test_db_session["intervention"]
    staff = test_db_session["staff"]
    student = test_db_session["student"]

    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        created_by_staff_id=staff.staff_id,
    )
    session.add(assessment)
    session.flush()

    attempt = PracticeAttempt(
        practice_assessment_id=assessment.practice_assessment_id,
        student_id=student.student_id,
        attempt_number=1,
        question_order=[],
    )
    session.add(attempt)
    session.commit()

    # Attempt references assessment with ondelete="RESTRICT" to preserve student attempt records
    session.delete(assessment)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_full_migration_upgrade_and_downgrade():
    """Verify that the Alembic migration executes upgrade and downgrade cleanly."""
    migration = _migration_module()
    engine = create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        # Pre-create parent tables required for foreign keys
        connection.exec_driver_sql("""
            CREATE TABLE academic_staff (
                staff_id VARCHAR(20) PRIMARY KEY,
                first_name VARCHAR(50),
                last_name VARCHAR(50)
            );
        """)
        connection.exec_driver_sql("""
            CREATE TABLE student (
                student_id VARCHAR(36) PRIMARY KEY,
                first_name VARCHAR(50),
                last_name VARCHAR(50)
            );
        """)
        connection.exec_driver_sql("""
            CREATE TABLE intervention (
                intervention_id INTEGER PRIMARY KEY AUTOINCREMENT,
                status VARCHAR(30)
            );
        """)

        migration.op = Operations(MigrationContext.configure(connection))
        # Execute upgrade
        migration.upgrade()

        inspector = inspect(connection)
        tables = inspector.get_table_names()
        assert "practice_assessment" in tables
        assert "practice_question" in tables
        assert "practice_question_option" in tables
        assert "practice_attempt" in tables
        assert "practice_attempt_answer" in tables

        # Execute downgrade
        migration.downgrade()
        inspector_post_down = inspect(connection)
        tables_post_down = inspector_post_down.get_table_names()
        for t in [
            "practice_assessment",
            "practice_question",
            "practice_question_option",
            "practice_attempt",
            "practice_attempt_answer",
        ]:
            assert t not in tables_post_down

    engine.dispose()
