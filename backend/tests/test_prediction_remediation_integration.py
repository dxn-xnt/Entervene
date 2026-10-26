"""Regression tests for Task 4.7B.4B: Prediction System Effective-Score Integration.

Verifies:
1. Gradebook and live prediction features use the exact same effective score.
2. Linked remediation is excluded from independent activity counts and denominators.
3. Incomplete remediation preserves original prediction evidence.
4. Remediation cannot falsely satisfy prediction-readiness minimums.
5. No score decrease when remediation grade is lower.
6. Multiple separate original targets are resolved independently.
7. Student and period isolation.
8. Refresh occurs when the effective score changes (and is suppressed when unchanged).
9. Existing Examination and historical prediction behavior remains compatible.
10. No future-data leakage into historical/training features via cutoff_at.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.RemedialExamination import effective_grade_changed
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_current_period_features_from_records,
)
from app.services.prediction.PredictionFeatureBuilderService import (
    build_prediction_features_from_records,
)
from app.services.student_record.StudentRecordService import (
    teacher_student_gradebook,
    teacher_student_record_detail,
)


@pytest.fixture
def prediction_remediation_ctx():
    """Sets up an isolated SQLite database fixture for prediction remediation testing."""
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

    db: Session = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()

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
    db.add_all([period1, period2])
    db.flush()

    template = GradingTemplate(
        template_name="Junior High 20-60-20",
        passing_threshold=Decimal("75.00"),
        status="active",
        components=[
            GradingTemplateComponent(component_name="Written Work", weight=Decimal("20.00"), display_order=1),
            GradingTemplateComponent(component_name="Performance Tasks", weight=Decimal("60.00"), display_order=2),
            GradingTemplateComponent(component_name="Exams", weight=Decimal("20.00"), display_order=3),
        ],
    )
    db.add(template)
    db.flush()

    subject = Subject(
        subject_name="Mathematics 7",
        subject_codename="MATH7",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
    )
    db.add(subject)
    db.flush()

    teacher_user = UserAccount(user_id=uuid.uuid4(), email="teacher@school.edu", account_status="active")
    teacher = AcademicStaff(
        staff_id="T001",
        user_id=teacher_user.user_id,
        first_name="Ada",
        last_name="Lovelace",
        email="teacher@school.edu",
    )
    db.add_all([teacher_user, teacher])
    db.flush()

    class_ = Class(
        section_name="7-Newton",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        academic_period_id=period1.academic_period_id,
        adviser_staff_id=teacher.staff_id,
        class_status="active",
    )
    db.add(class_)
    db.flush()

    load = SubjectLoad(
        staff_id=teacher.staff_id,
        subject_id=subject.subject_id,
        class_id=class_.class_id,
        academic_period_id=period1.academic_period_id,
        status="active",
    )
    db.add(load)
    db.flush()

    student_a = Student(
        student_id=uuid.uuid4(),
        student_lrn="111111111111",
        first_name="Alice",
        last_name="Santos",
        gender="Female",
        academic_level_id=level.academic_level_id,
    )
    student_b = Student(
        student_id=uuid.uuid4(),
        student_lrn="222222222222",
        first_name="Bob",
        last_name="Reyes",
        gender="Male",
        academic_level_id=level.academic_level_id,
    )
    db.add_all([student_a, student_b])
    db.flush()

    sc_a = StudentClass(
        student_id=student_a.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    )
    sc_b = StudentClass(
        student_id=student_b.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    )
    db.add_all([sc_a, sc_b])
    db.flush()

    # Pre-seed model version and source prediction for intervention FK
    model = AIModelVersion(
        model_name="test-prediction-fixture",
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="fixture-only",
        is_active=False,
    )
    db.add(model)
    db.flush()

    source_pred = DevelopmentCurrentTermPrediction(
        student_id=student_a.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        source_period_id=period1.academic_period_id,
        target_period_id=period1.academic_period_id,
        model_version_id=model.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("72.00"),
        intervention_level="HIGH_RISK",
        intervention_basis="fixture-only",
        evidence_snapshot={},
    )
    db.add(source_pred)
    db.flush()

    intervention = Intervention(
        student_id=student_a.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period1.academic_period_id,
        source_prediction_id=source_pred.prediction_id,
        status="CANDIDATE",
        diagnosis_snapshot={},
    )
    db.add(intervention)
    db.flush()
    db.commit()

    ctx = {
        "db": db,
        "year": year,
        "level": level,
        "period1": period1,
        "period2": period2,
        "template": template,
        "subject": subject,
        "teacher": teacher,
        "class": class_,
        "student_a": student_a,
        "student_b": student_b,
        "intervention": intervention,
    }
    yield ctx
    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _create_assignment(
    ctx,
    title: str,
    category: str,
    total_points: float,
    *,
    period=None,
    recipient_student_id=None,
    classwork_type="ACTIVITY",
    exam_subtype=None,
    original_exam_assignment_id=None,
) -> tuple[Classwork, ClassworkAssignment]:
    db: Session = ctx["db"]
    period = period or ctx["period1"]
    cw = Classwork(
        title=title,
        subject_id=ctx["subject"].subject_id,
        classwork_category=category,
        classwork_type=classwork_type,
        exam_subtype=exam_subtype,
        total_points=Decimal(str(total_points)),
        created_by_staff_id=ctx["teacher"].staff_id,
        is_graded=True,
        is_published=True,
        is_archived=False,
    )
    db.add(cw)
    db.flush()

    asgn = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=ctx["teacher"].staff_id,
        is_published=True,
        recipient_student_id=recipient_student_id,
        source_intervention_id=ctx["intervention"].intervention_id if recipient_student_id else None,
        remediation_request_id=uuid.uuid4() if recipient_student_id else None,
        original_exam_assignment_id=original_exam_assignment_id,
    )
    db.add(asgn)
    db.flush()
    db.commit()
    return cw, asgn


def _create_submission(
    ctx,
    assignment: ClassworkAssignment,
    student: Student,
    grade: float | None,
    status: str = "graded",
    submitted_at: datetime | None = None,
) -> StudentSubmission:
    db: Session = ctx["db"]
    now = submitted_at or datetime.now(timezone.utc)
    sub = StudentSubmission(
        classwork_assignment_id=assignment.classwork_assignment_id,
        student_id=student.student_id,
        status=status,
        grade=Decimal(str(grade)) if grade is not None else None,
        submitted_at=now,
        graded_at=now if status == "graded" else None,
        graded_by_staff_id=ctx["teacher"].staff_id if status == "graded" else None,
    )
    db.add(sub)
    db.flush()
    db.commit()
    return sub


def _create_remediation_link(
    ctx,
    original_asgn: ClassworkAssignment,
    remedial_asgn: ClassworkAssignment,
    student: Student,
    cap: Decimal = Decimal("75.00"),
    created_at: datetime | None = None,
) -> RemediationAssignmentLink:
    db: Session = ctx["db"]
    link = RemediationAssignmentLink(
        original_assignment_id=original_asgn.classwork_assignment_id,
        remediation_assignment_id=remedial_asgn.classwork_assignment_id,
        student_id=student.student_id,
        component=original_asgn.classwork.classwork_category if original_asgn.classwork else "PERFORMANCE_TASK",
        score_adjustment_cap=cap,
        source_intervention_id=ctx["intervention"].intervention_id,
        created_by_staff_id=ctx["teacher"].staff_id,
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(link)
    db.flush()
    db.commit()
    return link


def test_req1_gradebook_and_live_predictions_use_same_effective_score(prediction_remediation_ctx):
    """Req 1: Original PT: 10/40, Remediation PT: 36/40, Cap: 75% -> Effective 30/40 (75%).

    Both official gradebook and prediction builders must see exactly 30/40 (75%).
    """
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    # 1. Original PT: 10/40
    cw_orig, asgn_orig = _create_assignment(ctx, "PT 1: Original Project", "PERFORMANCE_TASK", 40.0)
    _create_submission(ctx, asgn_orig, ctx["student_a"], 10.0)

    # 2. Remediation PT: 36/40 targeted to Student A
    cw_rem, asgn_rem = _create_assignment(
        ctx,
        "Remedial PT 1",
        "PERFORMANCE_TASK",
        40.0,
        recipient_student_id=ctx["student_a"].student_id,
    )
    _create_submission(ctx, asgn_rem, ctx["student_a"], 36.0)

    # 3. Link with 75% cap
    _create_remediation_link(ctx, asgn_orig, asgn_rem, ctx["student_a"], cap=Decimal("75.00"))

    # Verify Gradebook
    gb = teacher_student_gradebook(
        db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    rows = {row.student_id: row for row in gb.studentGrades}
    row_a = rows[str(ctx["student_a"].student_id)]
    # Effective gradebook score for PT 1 should be 30.0
    assert row_a.performanceTask == [30.0]

    # Verify CurrentPeriodFeatureBuilder
    current_features = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    f = current_features["features"]
    assert f["pt_points_earned_so_far"] == 30.0
    assert f["pt_points_possible_so_far"] == 40.0
    assert f["pt_percent_so_far"] == 75.0

    # Verify PredictionFeatureBuilder (Next Period)
    next_features = build_prediction_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    nf = next_features["features"]
    assert nf["performance_task_percent"] == 75.0
    # Audit observation reflects effective score 30.0
    obs = next_features["evidence_summary"]["assignment_observations"]
    orig_obs = next(o for o in obs if o["assignment_id"] == asgn_orig.classwork_assignment_id)
    assert orig_obs["selected_submission_grade"] == 30.0


def test_req2_linked_remediation_excluded_from_counts_and_denominators(prediction_remediation_ctx):
    """Req 2: Exactly ONE PT activity counted, denominator is 40 (not 80)."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    cw_orig, asgn_orig = _create_assignment(ctx, "PT 1: Project", "PERFORMANCE_TASK", 40.0)
    _create_submission(ctx, asgn_orig, ctx["student_a"], 10.0)

    cw_rem, asgn_rem = _create_assignment(
        ctx, "Remedial PT 1", "PERFORMANCE_TASK", 40.0, recipient_student_id=ctx["student_a"].student_id
    )
    _create_submission(ctx, asgn_rem, ctx["student_a"], 36.0)
    _create_remediation_link(ctx, asgn_orig, asgn_rem, ctx["student_a"], cap=Decimal("75.00"))

    current_features = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    f = current_features["features"]
    assert f["pt_available_activity_count"] == 1.0
    assert f["overall_available_activity_count"] == 1.0
    assert f["pt_points_possible_so_far"] == 40.0

    next_features = build_prediction_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    es = next_features["evidence_summary"]
    assert es["expected_count"] == 1
    assert es["graded_count"] == 1
    assert len(es["assignment_observations"]) == 1


def test_req3_incomplete_remediation_preserves_original_evidence(prediction_remediation_ctx):
    """Req 3: When remediation is pending/ungraded, original 10/40 is preserved."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    cw_orig, asgn_orig = _create_assignment(ctx, "PT 1: Project", "PERFORMANCE_TASK", 40.0)
    _create_submission(ctx, asgn_orig, ctx["student_a"], 10.0)

    # Remediation created and submitted, but NOT graded yet (grade=None, status="submitted")
    cw_rem, asgn_rem = _create_assignment(
        ctx, "Remedial PT 1", "PERFORMANCE_TASK", 40.0, recipient_student_id=ctx["student_a"].student_id
    )
    _create_submission(ctx, asgn_rem, ctx["student_a"], None, status="submitted")
    _create_remediation_link(ctx, asgn_orig, asgn_rem, ctx["student_a"], cap=Decimal("75.00"))

    current_features = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    f = current_features["features"]
    # Unaffected: still 10.0 earned, 40.0 possible, 25.0%
    assert f["pt_points_earned_so_far"] == 10.0
    assert f["pt_points_possible_so_far"] == 40.0
    assert f["pt_percent_so_far"] == 25.0
    assert f["pt_available_activity_count"] == 1.0


def test_req4_remediation_cannot_falsely_satisfy_readiness_minimums(prediction_remediation_ctx):
    """Req 4: Remediation activity does NOT increment counted activities or artificially create readiness."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    # 1 WW + 1 PT (insufficient for full readiness)
    cw_ww, asgn_ww = _create_assignment(ctx, "WW 1", "WRITTEN_WORK", 20.0)
    _create_submission(ctx, asgn_ww, ctx["student_a"], 15.0)

    cw_pt, asgn_pt = _create_assignment(ctx, "PT 1", "PERFORMANCE_TASK", 40.0)
    _create_submission(ctx, asgn_pt, ctx["student_a"], 10.0)

    # Before remediation link
    res_before = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    count_before = res_before["features"]["overall_available_activity_count"]
    assert count_before == 2.0

    # Create remedial PT and link
    cw_rem, asgn_rem = _create_assignment(
        ctx, "Remedial PT 1", "PERFORMANCE_TASK", 40.0, recipient_student_id=ctx["student_a"].student_id
    )
    _create_submission(ctx, asgn_rem, ctx["student_a"], 36.0)
    _create_remediation_link(ctx, asgn_pt, asgn_rem, ctx["student_a"], cap=Decimal("75.00"))

    # After remediation
    res_after = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    count_after = res_after["features"]["overall_available_activity_count"]
    # Total activity count MUST REMAIN 2.0 (1 WW + 1 PT), NOT 3.0
    assert count_after == 2.0
    assert res_after["features"]["pt_available_activity_count"] == 1.0


def test_req5_no_score_decrease(prediction_remediation_ctx):
    """Req 5: If remedial score is lower than original, effective score remains original."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    cw_orig, asgn_orig = _create_assignment(ctx, "PT 1: Project", "PERFORMANCE_TASK", 40.0)
    _create_submission(ctx, asgn_orig, ctx["student_a"], 20.0)

    cw_rem, asgn_rem = _create_assignment(
        ctx, "Remedial PT 1", "PERFORMANCE_TASK", 40.0, recipient_student_id=ctx["student_a"].student_id
    )
    # Student scores 12/40 on remediation (worse than original 20/40)
    _create_submission(ctx, asgn_rem, ctx["student_a"], 12.0)
    _create_remediation_link(ctx, asgn_orig, asgn_rem, ctx["student_a"], cap=Decimal("75.00"))

    res = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    # Effective score stays 20.0 (50.0%)
    assert res["features"]["pt_points_earned_so_far"] == 20.0
    assert res["features"]["pt_percent_so_far"] == 50.0


def test_req6_multiple_targets_resolved_independently(prediction_remediation_ctx):
    """Req 6: WW1 and PT1 each have independent remediation links and resolve separately."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    # Original WW: 8/20. Rem WW: 18/20, cap 75% -> 15/20 (75%)
    cw_ww, asgn_ww = _create_assignment(ctx, "WW 1", "WRITTEN_WORK", 20.0)
    _create_submission(ctx, asgn_ww, ctx["student_a"], 8.0)
    cw_ww_rem, asgn_ww_rem = _create_assignment(ctx, "Rem WW 1", "WRITTEN_WORK", 20.0, recipient_student_id=ctx["student_a"].student_id)
    _create_submission(ctx, asgn_ww_rem, ctx["student_a"], 18.0)
    _create_remediation_link(ctx, asgn_ww, asgn_ww_rem, ctx["student_a"], cap=Decimal("75.00"))

    # Original PT: 10/40. Rem PT: 36/40, cap 75% -> 30/40 (75%)
    cw_pt, asgn_pt = _create_assignment(ctx, "PT 1", "PERFORMANCE_TASK", 40.0)
    _create_submission(ctx, asgn_pt, ctx["student_a"], 10.0)
    cw_pt_rem, asgn_pt_rem = _create_assignment(ctx, "Rem PT 1", "PERFORMANCE_TASK", 40.0, recipient_student_id=ctx["student_a"].student_id)
    _create_submission(ctx, asgn_pt_rem, ctx["student_a"], 36.0)
    _create_remediation_link(ctx, asgn_pt, asgn_pt_rem, ctx["student_a"], cap=Decimal("75.00"))

    res = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    f = res["features"]
    assert f["ww_available_activity_count"] == 1.0
    assert f["ww_points_earned_so_far"] == 15.0
    assert f["ww_percent_so_far"] == 75.0

    assert f["pt_available_activity_count"] == 1.0
    assert f["pt_points_earned_so_far"] == 30.0
    assert f["pt_percent_so_far"] == 75.0


def test_req7_student_and_period_isolation(prediction_remediation_ctx):
    """Req 7: Student B is completely unaffected by Student A's remediation."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    cw_pt, asgn_pt = _create_assignment(ctx, "PT 1", "PERFORMANCE_TASK", 40.0)
    # Both students submit 10/40 on the original assignment
    _create_submission(ctx, asgn_pt, ctx["student_a"], 10.0)
    _create_submission(ctx, asgn_pt, ctx["student_b"], 10.0)

    # Remediation only for Student A
    cw_rem, asgn_rem = _create_assignment(ctx, "Rem PT 1", "PERFORMANCE_TASK", 40.0, recipient_student_id=ctx["student_a"].student_id)
    _create_submission(ctx, asgn_rem, ctx["student_a"], 36.0)
    _create_remediation_link(ctx, asgn_pt, asgn_rem, ctx["student_a"], cap=Decimal("75.00"))

    # Student A has 30/40
    res_a = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    assert res_a["features"]["pt_points_earned_so_far"] == 30.0

    # Student B MUST remain 10/40
    res_b = build_current_period_features_from_records(
        db, ctx["student_b"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    assert res_b["features"]["pt_points_earned_so_far"] == 10.0
    assert res_b["features"]["pt_percent_so_far"] == 25.0


def test_req8_prediction_refresh_effective_score_change(prediction_remediation_ctx):
    """Req 8: effective_grade_changed triggers only when the effective score actually changes."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    cw_orig, asgn_orig = _create_assignment(ctx, "PT 1", "PERFORMANCE_TASK", 40.0)
    _create_submission(ctx, asgn_orig, ctx["student_a"], 10.0)

    cw_rem, asgn_rem = _create_assignment(
        ctx, "Rem PT 1", "PERFORMANCE_TASK", 40.0, recipient_student_id=ctx["student_a"].student_id
    )
    link = _create_remediation_link(ctx, asgn_orig, asgn_rem, ctx["student_a"], cap=Decimal("75.00"))

    # Case A: Grading remediation 36/40 (effective score goes from 10 to 30) -> True!
    assert effective_grade_changed(db, asgn_rem, ctx["student_a"].student_id, None, 36.0) is True

    # Case B: Scoring 8/40 on remediation (effective score stays 10.0) -> False!
    assert effective_grade_changed(db, asgn_rem, ctx["student_a"].student_id, None, 8.0) is False

    # Case C: Scoring 32/40 (capped at 30) vs updating to 35/40 (still capped at 30) -> False!
    assert effective_grade_changed(db, asgn_rem, ctx["student_a"].student_id, 32.0, 35.0) is False

    # Case D: Updating remediation from 20/40 (effective 20) to 25/40 (effective 25) -> True!
    assert effective_grade_changed(db, asgn_rem, ctx["student_a"].student_id, 20.0, 25.0) is True


def test_req9_existing_examination_behavior_compatible(prediction_remediation_ctx):
    """Req 9: Existing examination remediation still works correctly."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    # Summative 1: 27/30 (90%)
    cw_s1, asgn_s1 = _create_assignment(
        ctx, "Summative 1", "EXAMS", 30.0, exam_subtype="SUMMATIVE_1", classwork_type="EXAM"
    )
    _create_submission(ctx, asgn_s1, ctx["student_a"], 27.0)

    # Summative 2: 21/30 (70%)
    cw_s2, asgn_s2 = _create_assignment(
        ctx, "Summative 2", "EXAMS", 30.0, exam_subtype="SUMMATIVE_2", classwork_type="EXAM"
    )
    _create_submission(ctx, asgn_s2, ctx["student_a"], 21.0)

    # Term exam original: 20/40 (50%)
    cw_exam, asgn_exam = _create_assignment(
        ctx, "Term Exam", "EXAMS", 40.0, exam_subtype="TERM_EXAM", classwork_type="EXAM"
    )
    _create_submission(ctx, asgn_exam, ctx["student_a"], 20.0)

    # Remedial exam: 35/40 (87.5%, linked via original_exam_assignment_id)
    cw_rem_exam, asgn_rem_exam = _create_assignment(
        ctx,
        "Remedial Term Exam",
        "EXAMS",
        40.0,
        exam_subtype="TERM_EXAM",
        classwork_type="EXAM",
        recipient_student_id=ctx["student_a"].student_id,
        original_exam_assignment_id=asgn_exam.classwork_assignment_id,
    )
    _create_submission(ctx, asgn_rem_exam, ctx["student_a"], 35.0)

    # effective_grade_changed recognizes exam remediation
    assert effective_grade_changed(db, asgn_rem_exam, ctx["student_a"].student_id, None, 35.0) is True

    # CurrentPeriodFeatureBuilder recognizes examination effective score
    res = build_current_period_features_from_records(
        db, ctx["student_a"].student_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period1"].academic_period_id
    )
    # The examination component is computed using effective_exam_scores
    assert res["features"]["qa_has_evidence"] == 1.0
    exam_pres = res["evidence_summary"]["examination"]["presentation"]
    assert exam_pres["status"] == "COMPLETE"
    assert exam_pres["components"]["TERM_EXAM"] == 87.5


def test_req10_no_future_data_leakage_into_historical_features(prediction_remediation_ctx):
    """Req 10: Point-in-time cutoff ignores remediation links created after cutoff."""
    ctx = prediction_remediation_ctx
    db = ctx["db"]

    t0 = datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc)
    t_cutoff = datetime(2026, 7, 10, 10, 0, 0, tzinfo=timezone.utc)
    t_remedial = datetime(2026, 7, 15, 10, 0, 0, tzinfo=timezone.utc)

    # Original assignment and submission at t0
    cw_orig, asgn_orig = _create_assignment(ctx, "PT 1: Project", "PERFORMANCE_TASK", 40.0)
    _create_submission(ctx, asgn_orig, ctx["student_a"], 10.0, submitted_at=t0)

    # Remediation created at t_remedial (after t_cutoff)
    cw_rem, asgn_rem = _create_assignment(
        ctx, "Remedial PT 1", "PERFORMANCE_TASK", 40.0, recipient_student_id=ctx["student_a"].student_id
    )
    _create_submission(ctx, asgn_rem, ctx["student_a"], 36.0, submitted_at=t_remedial)
    _create_remediation_link(
        ctx, asgn_orig, asgn_rem, ctx["student_a"], cap=Decimal("75.00"), created_at=t_remedial
    )

    # Feature extraction with cutoff_at = t_cutoff
    historical_features = build_current_period_features_from_records(
        db,
        ctx["student_a"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period1"].academic_period_id,
        cutoff_at=t_cutoff,
    )

    # At cutoff, remediation did NOT exist: earned score must be original 10.0, NOT 30.0!
    assert historical_features["features"]["pt_points_earned_so_far"] == 10.0
    assert historical_features["features"]["pt_percent_so_far"] == 25.0

    # Live extraction (no cutoff) sees 30.0
    live_features = build_current_period_features_from_records(
        db,
        ctx["student_a"].student_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        ctx["period1"].academic_period_id,
    )
    assert live_features["features"]["pt_points_earned_so_far"] == 30.0
    assert live_features["features"]["pt_percent_so_far"] == 75.0

