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
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    MODEL_PURPOSE,
    build_current_period_features_from_records,
    load_current_period_feature_schema,
    prepare_current_period_frame,
    score_current_period_staging,
)
from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME
from app.services.prediction.PredictionFeatureBuilderService import build_prediction_features_from_records


@pytest.fixture
def current_period_context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    lrn_check = next((c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"), None)
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()
    year = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add_all([year, level])
    db.flush()
    account = UserAccount(user_id=uuid.uuid4(), email="teacher@example.test")
    staff = AcademicStaff(staff_id="T-CURRENT", first_name="Current", last_name="Teacher", user_id=account.user_id)
    student = Student(student_id=uuid.uuid4(), student_lrn="300000000001", first_name="Current", last_name="Learner", academic_level_id=level.academic_level_id)
    period1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    period2 = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        academic_year_id=year.academic_year_id,
        is_active=False,
    )
    class_ = Class(section_name="Archimedes", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    subject = Subject(subject_name="Science", subject_codename="SCIENCE", academic_level_id=level.academic_level_id)
    db.add_all([account, staff, student, period1, period2, class_, subject])
    db.flush()
    template = GradingTemplate(template_name="Current 40-40-20", academic_level_id=level.academic_level_id, subject_id=subject.subject_id, status="active")
    db.add(template)
    db.flush()
    db.add_all([
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Written Works", weight=Decimal("40"), display_order=1),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Performance Tasks", weight=Decimal("40"), display_order=2),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("20"), display_order=3),
    ])
    subject.default_grading_template = str(template.grading_template_id)
    db.commit()
    yield {"db": db, "student": student, "class": class_, "subject": subject, "staff": staff, "period": period1, "next_period": period2, "template": template, "level": level}
    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def add_activity(
    ctx,
    category: str,
    score: float | None,
    total: float = 100,
    *,
    period=None,
    status="graded",
    graded_at=None,
    title="Activity",
    classwork_type: str | None = None,
    exam_subtype: str | None = None,
):
    db = ctx["db"]
    period = period or ctx["period"]
    cw = Classwork(
        title=title,
        classwork_type=classwork_type or ("QUIZ" if category == "WRITTEN_WORK" else "ACTIVITY"),
        classwork_category=category,
        exam_subtype=exam_subtype,
        total_points=Decimal(str(total)),
        is_graded=True,
        is_published=True,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
    )
    db.add(cw)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    if status is not None:
        db.add(StudentSubmission(
            student_id=ctx["student"].student_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            status=status,
            grade=Decimal(str(score)) if score is not None else None,
            submitted_at=graded_at,
            graded_at=graded_at,
            graded_by_staff_id=ctx["staff"].staff_id if status == "graded" else None,
        ))
    db.commit()
    return assignment


def build_current(ctx, **kwargs):
    return build_current_period_features_from_records(
        ctx["db"], ctx["student"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id, **kwargs
    )


def test_exact_registered_raw_feature_schema_is_produced(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 18, 20)
    add_activity(ctx, "WRITTEN_WORK", 7, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 17, 20)
    schema = load_current_period_feature_schema()

    result = build_current(ctx)

    assert list(result["features"].keys()) == schema["raw_feature_columns"]
    assert len(result["features"]) == 31
    assert result["model_purpose"] == MODEL_PURPOSE
    prepare_current_period_frame(result["features"], schema)


def test_historical_equivalent_and_live_db_evidence_feature_vector(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "WRITTEN_WORK", 7, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 18, 20)
    add_activity(ctx, "PERFORMANCE_TASK", 17, 20)
    add_activity(ctx, "QUARTERLY_ASSESSMENT", 32, 40)

    features = build_current(ctx)["features"]

    expected_subset = {
        "subject": "SCIENCE",
        "grade_level": 9.0,
        "ww_weight": 40.0,
        "pt_weight": 40.0,
        "qa_weight": 20.0,
        "ww_available_activity_count": 2.0,
        "pt_available_activity_count": 2.0,
        "qa_available_activity_count": 1.0,
        "overall_available_activity_count": 5.0,
        "ww_points_earned_so_far": 15.0,
        "ww_points_possible_so_far": 20.0,
        "ww_percent_so_far": 75.0,
        "ww_weighted_score_so_far": 30.0,
        "pt_points_earned_so_far": 35.0,
        "pt_points_possible_so_far": 40.0,
        "pt_percent_so_far": 87.5,
        "pt_weighted_score_so_far": 35.0,
        "qa_points_earned_so_far": 32.0,
        "qa_points_possible_so_far": 40.0,
        "qa_percent_so_far": 80.0,
        "qa_weighted_score_so_far": 16.0,
        "observed_component_weight_sum": 100.0,
        "overall_weighted_score_so_far": 81.0,
        "overall_partial_percent": 81.0,
        "ww_has_evidence": 1.0,
        "pt_has_evidence": 1.0,
        "qa_has_evidence": 1.0,
        "has_any_input_evidence": 1.0,
    }
    for key, value in expected_subset.items():
        assert features[key] == pytest.approx(value) if isinstance(value, float) else value


def test_no_future_activity_or_finalized_grade_enters_vector(current_period_context):
    ctx = current_period_context
    cutoff = datetime(2026, 7, 1, tzinfo=timezone.utc)
    add_activity(ctx, "WRITTEN_WORK", 8, 10, graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10, graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "WRITTEN_WORK", 100, 100, graded_at=cutoff + timedelta(days=1), title="Future graded work")
    add_activity(ctx, "PERFORMANCE_TASK", None, 100, status=None, title="Future ungraded work")
    ctx["db"].add(StudentPeriodGrade(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        final_period_grade=Decimal("99"),
        transmuted_grade=Decimal("99"),
        is_finalized=True,
    ))
    ctx["db"].commit()

    features = build_current(ctx, cutoff_at=cutoff)["features"]

    assert features["overall_available_activity_count"] == 2
    assert features["ww_points_possible_so_far"] == 10
    assert features["pt_points_possible_so_far"] == 10
    assert "source_period_grade" not in features
    assert "final_period_grade" not in features


def test_qa_missing_and_actual_zero_are_distinct(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    missing_qa = build_current(ctx)["features"]
    add_activity(ctx, "QUARTERLY_ASSESSMENT", 0, 40)
    zero_qa = build_current(ctx)["features"]

    assert missing_qa["qa_has_evidence"] == 0
    assert missing_qa["qa_available_activity_count"] == 0
    assert missing_qa["qa_points_possible_so_far"] == 0
    assert missing_qa["qa_points_earned_so_far"] == 0
    assert build_current(ctx)["evidence_summary"]["examination"]["presentation"]["status"] == "AGGREGATE"
    assert zero_qa["qa_has_evidence"] == 1
    assert zero_qa["qa_available_activity_count"] == 1
    assert zero_qa["qa_points_possible_so_far"] == 40
    assert zero_qa["qa_points_earned_so_far"] == 0
    assert zero_qa["qa_percent_so_far"] == 0


def test_partial_exam_components_do_not_create_fake_qa_evidence(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "EXAMS", 27, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1")
    add_activity(ctx, "EXAMS", 24, 30, title="Summative 2", classwork_type="EXAM", exam_subtype="SUMMATIVE_2")

    result = build_current(ctx)
    features = result["features"]
    warning_codes = {warning["code"] for warning in result["domain_warnings"]}

    assert features["qa_has_evidence"] == 0
    assert features["qa_available_activity_count"] == 0
    assert features["qa_points_earned_so_far"] == 0
    assert features["qa_points_possible_so_far"] == 0
    assert features["qa_percent_so_far"] == 0
    assert features["qa_weighted_score_so_far"] == 0
    assert features["observed_component_weight_sum"] == 80
    assert features["overall_available_activity_count"] == 4
    assert features["overall_weighted_score_so_far"] == pytest.approx(68)
    assert features["overall_partial_percent"] == pytest.approx(85)
    assert "QA_PARTIAL_COMPONENTS_AVAILABLE" in warning_codes
    assert result["evidence_summary"]["examination"]["presentation"] == {
        "status": "PARTIAL",
        "completed_count": 2,
        "components": {"SUMMATIVE_1": 90.0, "SUMMATIVE_2": 80.0, "TERM_EXAM": None},
    }


def test_exam_presentation_distinguishes_no_evidence_and_first_summative(current_period_context):
    ctx = current_period_context
    before = build_current(ctx)
    assert before["evidence_summary"]["examination"]["presentation"]["status"] == "NOT_STARTED"
    assert before["features"]["qa_has_evidence"] == 0

    add_activity(ctx, "EXAMS", 24, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1")
    after = build_current(ctx)
    assert after["evidence_summary"]["examination"]["presentation"] == {
        "status": "PARTIAL",
        "completed_count": 1,
        "components": {"SUMMATIVE_1": 80.0, "SUMMATIVE_2": None, "TERM_EXAM": None},
    }
    assert after["features"]["qa_has_evidence"] == 0
    assert after["features"]["qa_percent_so_far"] == 0


def test_complete_exam_composite_becomes_one_model_compatible_qa_observation(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "EXAMS", 27, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1")
    add_activity(ctx, "EXAMS", 21, 30, title="Summative 2", classwork_type="EXAM", exam_subtype="SUMMATIVE_2")
    add_activity(ctx, "EXAMS", 32, 40, title="Term Exam", classwork_type="EXAM", exam_subtype="TERM_EXAM")

    result = build_current(ctx)
    features = result["features"]

    assert features["qa_has_evidence"] == 1
    assert features["qa_available_activity_count"] == 1
    assert features["qa_points_possible_so_far"] == 40
    # Composite PS = .30*90 + .30*70 + .40*80 = 80; canonical earned = 80% of 40.
    assert features["qa_points_earned_so_far"] == pytest.approx(32)
    assert features["qa_percent_so_far"] == pytest.approx(80)
    assert features["qa_weighted_score_so_far"] == pytest.approx(16)
    assert features["overall_available_activity_count"] == 5
    assert features["observed_component_weight_sum"] == 100
    assert not any(warning["code"] == "QA_PARTIAL_COMPONENTS_AVAILABLE" for warning in result["domain_warnings"])
    assert result["evidence_summary"]["examination"]["presentation"] == {
        "status": "COMPLETE",
        "completed_count": 3,
        "components": {"SUMMATIVE_1": 90.0, "SUMMATIVE_2": 70.0, "TERM_EXAM": 80.0},
    }


def test_complete_exam_composite_zero_is_low_performance_not_missing(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "EXAMS", 0, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1")
    add_activity(ctx, "EXAMS", 0, 30, title="Summative 2", classwork_type="EXAM", exam_subtype="SUMMATIVE_2")
    add_activity(ctx, "EXAMS", 0, 40, title="Term Exam", classwork_type="EXAM", exam_subtype="TERM_EXAM")

    features = build_current(ctx)["features"]

    assert features["qa_has_evidence"] == 1
    assert features["qa_available_activity_count"] == 1
    assert features["qa_points_possible_so_far"] == 40
    assert features["qa_points_earned_so_far"] == 0
    assert features["qa_percent_so_far"] == 0


def test_future_exam_component_does_not_leak_into_current_qa_composite(current_period_context):
    ctx = current_period_context
    cutoff = datetime(2026, 7, 1, tzinfo=timezone.utc)
    add_activity(ctx, "WRITTEN_WORK", 8, 10, graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "WRITTEN_WORK", 8, 10, graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10, graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10, graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "EXAMS", 27, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1", graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "EXAMS", 21, 30, title="Summative 2", classwork_type="EXAM", exam_subtype="SUMMATIVE_2", graded_at=cutoff - timedelta(days=1))
    add_activity(ctx, "EXAMS", 40, 40, title="Term Exam", classwork_type="EXAM", exam_subtype="TERM_EXAM", graded_at=cutoff + timedelta(days=1))

    result = build_current(ctx, cutoff_at=cutoff)

    assert result["features"]["qa_has_evidence"] == 0
    assert result["features"]["qa_available_activity_count"] == 0
    assert "QA_PARTIAL_COMPONENTS_AVAILABLE" in {warning["code"] for warning in result["domain_warnings"]}
    assert result["evidence_summary"]["examination"]["presentation"]["status"] == "PARTIAL"
    assert result["evidence_summary"]["examination"]["presentation"]["components"]["TERM_EXAM"] is None


def test_counts_use_only_graded_numeric_evidence(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10, status="graded")
    add_activity(ctx, "WRITTEN_WORK", None, 10, status="submitted")
    add_activity(ctx, "PERFORMANCE_TASK", None, 10, status=None)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10, status="graded")

    features = build_current(ctx)["features"]

    assert features["ww_available_activity_count"] == 1
    assert features["ww_points_possible_so_far"] == 10
    assert features["pt_available_activity_count"] == 1
    assert features["overall_available_activity_count"] == 2


def test_readiness_states(current_period_context):
    ctx = current_period_context
    assert build_current(ctx)["readiness_level"] == "INSUFFICIENT_EVIDENCE"
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "WRITTEN_WORK", 7, 10)
    assert build_current(ctx)["readiness_level"] == "LIMITED_EVIDENCE"
    add_activity(ctx, "PERFORMANCE_TASK", 8, 10)
    standard = build_current(ctx)
    assert standard["readiness_level"] == "STANDARD_READY"
    assert standard["ready"] is True
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "QUARTERLY_ASSESSMENT", 35, 40)
    assert build_current(ctx)["readiness_level"] == "HIGH_EVIDENCE"


def test_domain_warnings_for_unsupported_subject_weights_and_ranges(current_period_context):
    ctx = current_period_context
    ctx["subject"].subject_codename = "PHILOSOPHY"
    ctx["level"].grade_level = 12
    # Mutate template to an unsupported 25/50/25 pattern.
    components = ctx["db"].query(GradingTemplateComponent).filter(GradingTemplateComponent.grading_template_id == ctx["template"].grading_template_id).order_by(GradingTemplateComponent.display_order).all()
    components[0].weight = Decimal("25")
    components[1].weight = Decimal("50")
    components[2].weight = Decimal("25")
    ctx["db"].commit()
    add_activity(ctx, "WRITTEN_WORK", 1000, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)

    warnings = build_current(ctx)["domain_warnings"]
    codes = {warning["code"] for warning in warnings}

    assert "UNSUPPORTED_SUBJECT" in codes
    assert "UNSUPPORTED_WEIGHT_PATTERN" in codes
    assert "FEATURE_ABOVE_TRAINING_RANGE" in codes


def test_current_and_next_builders_remain_separate(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 9, 10)
    current = build_current(ctx)

    assert current["model_name"] == "entervene_current_period_grade_rf_v1"
    assert current["model_purpose"] == MODEL_PURPOSE
    assert DEFAULT_MODEL_NAME == "entervene_next_period_grade_rf"
    next_result = build_prediction_features_from_records(
        ctx["db"], ctx["student"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id, ctx["next_period"].academic_period_id
    )
    assert next_result["features"] != current["features"]
    assert "source_period_grade" in next_result["features"]
    assert "source_period_grade" not in current["features"]


def test_staging_score_can_execute_without_route_integration(current_period_context):
    ctx = current_period_context
    add_activity(ctx, "WRITTEN_WORK", 8, 10)
    add_activity(ctx, "WRITTEN_WORK", 7, 10)
    add_activity(ctx, "PERFORMANCE_TASK", 18, 20)
    add_activity(ctx, "PERFORMANCE_TASK", 17, 20)
    features = build_current(ctx)["features"]

    prediction = score_current_period_staging(features)

    assert isinstance(prediction, float)
    assert 0 <= prediction <= 100
