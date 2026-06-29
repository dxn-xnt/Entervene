from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AssessmentItem import AssessmentItem
from app.models.academic.Class_ import Class
from app.models.academic.StudentAssessmentScore import StudentAssessmentScore
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.PredictionFeatureBuilderService import (
    build_prediction_features_from_records,
    check_prediction_readiness,
)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    AssessmentItem.__table__,
    StudentAssessmentScore.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    StudentPeriodGrade.__table__,
]


@pytest.fixture
def feature_context():
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

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add_all([year, level])
    db.flush()
    account = UserAccount(user_id=uuid.uuid4(), email="teacher@example.test")
    staff = AcademicStaff(staff_id="T-ML", first_name="Model", last_name="Teacher", user_id=account.user_id)
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Feature",
        last_name="Learner",
        academic_level_id=level.academic_level_id,
    )
    periods = [
        AcademicPeriod(
            period_name=f"Quarter {index}",
            period_type="QUARTER",
            period_sequence=index,
            total_periods_in_year=4,
            period_progress_ratio=Decimal(str(index / 4)),
            start_date=date(2025, 6, 1) + timedelta(days=(index - 1) * 60),
            end_date=date(2025, 7, 30) + timedelta(days=(index - 1) * 60),
            academic_year_id=year.academic_year_id,
            is_active=(index == 2),
        )
        for index in (1, 2, 3)
    ]
    class_ = Class(section_name="Einstein", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    subject = Subject(subject_name="Science", subject_codename="SCIENCE", academic_level_id=level.academic_level_id)
    db.add_all([account, staff, student, *periods, class_, subject])
    db.commit()

    yield {
        "db": db,
        "student": student,
        "class": class_,
        "subject": subject,
        "staff": staff,
        "periods": periods,
    }
    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def add_period_grade(context, period, grade=86, **overrides):
    row = StudentPeriodGrade(
        student_id=context["student"].student_id,
        class_id=context["class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=period.academic_period_id,
        final_period_grade=grade,
        written_work_percent=overrides.pop("written_work_percent", None),
        performance_task_percent=overrides.pop("performance_task_percent", None),
        periodical_assessment_percent=overrides.pop("periodical_assessment_percent", None),
        **overrides,
    )
    context["db"].add(row)
    context["db"].commit()
    return row


def add_assessment(context, component, item_number, max_score=100, raw_score=None, status="RECORDED", period=None):
    period = period or context["periods"][1]
    assessment = AssessmentItem(
        class_id=context["class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=period.academic_period_id,
        component_type=component,
        item_number=item_number,
        max_score=max_score,
    )
    context["db"].add(assessment)
    context["db"].flush()
    if raw_score is not None or status != "MISSING_NOT_ENCODED":
        context["db"].add(
            StudentAssessmentScore(
                assessment_id=assessment.assessment_id,
                student_id=context["student"].student_id,
                raw_score=raw_score,
                score_status=status,
            )
        )
    context["db"].commit()
    return assessment


def build(context, period=None, target=None):
    period = period or context["periods"][1]
    return build_prediction_features_from_records(
        context["db"],
        context["student"].student_id,
        context["class"].class_id,
        context["subject"].subject_id,
        period.academic_period_id,
        target.academic_period_id if target else context["periods"][2].academic_period_id,
    )


def test_builds_source_period_grade_from_student_period_grade(feature_context):
    add_period_grade(feature_context, feature_context["periods"][1], grade=86)

    result = build(feature_context)

    assert result["features"]["source_period_grade"] == 86.0


def test_computes_component_percentages_from_assessment_scores(feature_context):
    add_assessment(feature_context, "WRITTEN_WORK", 1, max_score=50, raw_score=42)
    add_assessment(feature_context, "PERFORMANCE_TASK", 1, max_score=40, raw_score=35.2)
    add_assessment(feature_context, "PERIODICAL_ASSESSMENT", 1, max_score=60, raw_score=49.2)

    result = build(feature_context)

    assert result["features"]["written_work_percent"] == 84.0
    assert result["features"]["performance_task_percent"] == 88.0
    assert result["features"]["periodical_assessment_percent"] == 82.0


def test_handles_missing_periodical_assessment_during_early_projection(feature_context):
    add_assessment(feature_context, "WRITTEN_WORK", 1, raw_score=84)
    add_assessment(feature_context, "PERFORMANCE_TASK", 1, raw_score=88)

    result = build(feature_context, target=feature_context["periods"][1])

    assert result["prediction_mode"] == "CURRENT_PERIOD_PROJECTION"
    assert result["features"]["periodical_assessment_percent"] is None
    assert "PERIODICAL_ASSESSMENT" in result["evidence_summary"]["components_missing"]


def test_computes_completion_missing_and_coverage(feature_context):
    add_period_grade(feature_context, feature_context["periods"][1], grade=86)
    add_assessment(feature_context, "WRITTEN_WORK", 1, raw_score=80)
    add_assessment(feature_context, "WRITTEN_WORK", 2, raw_score=None, status="MISSING_NOT_ENCODED")
    add_assessment(feature_context, "PERFORMANCE_TASK", 1, raw_score=90)
    add_assessment(feature_context, "PERIODICAL_ASSESSMENT", 1, raw_score=85)

    result = build(feature_context)

    assert result["features"]["assessment_completion_rate"] == pytest.approx(0.75)
    assert result["features"]["data_coverage_ratio"] == pytest.approx(0.75)
    assert result["features"]["missing_activity_count"] == 1
    assert result["evidence_summary"]["expected_assessment_count"] == 4
    assert result["evidence_summary"]["recorded_assessment_count"] == 3


def test_computes_late_submission_count_when_due_dates_exist(feature_context):
    classwork = Classwork(
        title="Late task",
        classwork_type="ACTIVITY",
        classwork_category="PERFORMANCE_TASK",
        total_points=100,
        is_published=True,
        subject_id=feature_context["subject"].subject_id,
        created_by_staff_id=feature_context["staff"].staff_id,
    )
    feature_context["db"].add(classwork)
    feature_context["db"].flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=feature_context["class"].class_id,
        assigned_by_staff_id=feature_context["staff"].staff_id,
        due_date=datetime.now(timezone.utc) - timedelta(days=1),
        is_published=True,
    )
    feature_context["db"].add(assignment)
    feature_context["db"].flush()
    feature_context["db"].add(
        StudentSubmission(
            student_id=feature_context["student"].student_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            submitted_at=datetime.now(timezone.utc),
            status="late",
            grade=90,
        )
    )
    feature_context["db"].commit()
    add_period_grade(feature_context, feature_context["periods"][1], grade=86)

    result = build(feature_context)

    assert result["features"]["late_submission_count"] == 1
    assert result["evidence_summary"]["late_submission_count"] == 1


def test_computes_grade_trend_when_previous_period_exists(feature_context):
    add_period_grade(feature_context, feature_context["periods"][0], grade=88)
    add_period_grade(feature_context, feature_context["periods"][1], grade=86)

    result = build(feature_context)

    assert result["features"]["grade_trend_vs_previous_period"] == -2.0
    assert result["features"]["has_previous_period"] is True


def test_has_previous_period_false_for_first_period(feature_context):
    add_period_grade(feature_context, feature_context["periods"][0], grade=88)

    result = build(feature_context, period=feature_context["periods"][0], target=feature_context["periods"][1])

    assert result["features"]["has_previous_period"] is False
    assert result["features"]["grade_trend_vs_previous_period"] is None


@pytest.mark.parametrize(
    ("coverage", "completion", "source_grade", "expected_ready", "expected_level"),
    [
        (0.49, 0.90, 86, False, "INSUFFICIENT"),
        (0.50, 0.90, 86, True, "MINIMUM"),
        (0.70, 0.90, 86, True, "GOOD"),
        (0.85, 0.90, 86, True, "STRONG"),
        (0.90, 0.49, 86, False, "INSUFFICIENT"),
        (0.90, 0.90, None, False, "INSUFFICIENT"),
    ],
)
def test_prediction_readiness_thresholds(coverage, completion, source_grade, expected_ready, expected_level):
    result = check_prediction_readiness(
        {
            "features": {
                "data_coverage_ratio": coverage,
                "assessment_completion_rate": completion,
                "source_period_grade": source_grade,
            }
        }
    )

    assert result["ready"] is expected_ready
    assert result["readiness_level"] == expected_level
