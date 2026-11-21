"""Focused tests for Task 4: read-only unremediated prediction baseline via exclude_intervention_id."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
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
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.RemediationGradeCeiling import apply_remediation_grade_ceiling
from app.services.prediction import DevelopmentCurrentTermScoringService as current_term_scorer
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_current_period_features_from_records,
    load_current_period_feature_schema,
)
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_DEVELOPMENT_PREDICTION_AVAILABLE,
    predict_development_current_term,
)
from app.services.student_record.StudentRecordService import teacher_student_gradebook


@pytest.fixture
def baseline_ctx():
    """Isolated SQLite scope matching V3 current-term requirements (Grade 7, MATH, 20/60/20)."""
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

    period = AcademicPeriod(
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
    db.add(period)
    db.flush()

    template = GradingTemplate(
        template_name="JHS 20-60-20",
        passing_threshold=Decimal("85.00"),
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
        subject_name="Mathematics",
        subject_codename="MATHEMATICS",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
    )
    db.add(subject)
    db.flush()

    teacher_user = UserAccount(user_id=uuid.uuid4(), email="teacher@baseline.test", account_status="active")
    teacher = AcademicStaff(
        staff_id="T-BASE",
        user_id=teacher_user.user_id,
        first_name="Grace",
        last_name="Hopper",
        email="teacher@baseline.test",
    )
    db.add_all([teacher_user, teacher])
    db.flush()

    class_ = Class(
        section_name="7-Euler",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        academic_period_id=period.academic_period_id,
        adviser_staff_id=teacher.staff_id,
        class_status="active",
    )
    db.add(class_)
    db.flush()

    db.add(
        SubjectLoad(
            staff_id=teacher.staff_id,
            subject_id=subject.subject_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
            status="active",
            is_active_version=True,
        )
    )

    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="400000000001",
        first_name="Maya",
        last_name="Lin",
        gender="Female",
        academic_level_id=level.academic_level_id,
    )
    db.add(student)
    db.flush()

    db.add(
        StudentClass(
            student_id=student.student_id,
            class_id=class_.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        )
    )

    model = AIModelVersion(
        model_name="test-unremediated-model",
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="fixture-only",
        is_active=False,
    )
    db.add(model)
    db.flush()

    def _make_intervention(revision: int, status: str = "ACTIVE") -> Intervention:
        pred = DevelopmentCurrentTermPrediction(
            student_id=student.student_id,
            class_id=class_.class_id,
            subject_id=subject.subject_id,
            source_period_id=period.academic_period_id,
            target_period_id=period.academic_period_id,
            model_version_id=model.model_version_id,
            revision=revision,
            predicted_period_grade=Decimal("82.00"),
            intervention_level="MODERATE_RISK",
            intervention_basis="RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE",
            evidence_snapshot={"projected_final_term_grade_raw": 82.0, "readiness": {"status": "READY"}},
        )
        db.add(pred)
        db.flush()
        row = Intervention(
            student_id=student.student_id,
            class_id=class_.class_id,
            subject_id=subject.subject_id,
            academic_period_id=period.academic_period_id,
            source_prediction_id=pred.prediction_id,
            status=status,
            resolution_reason="IMPROVED_PREDICTION" if status == "RESOLVED" else None,
            resolved_at=datetime.now(timezone.utc) if status == "RESOLVED" else None,
            activated_at=datetime.now(timezone.utc) if status == "ACTIVE" else None,
            activated_by_staff_id=teacher.staff_id if status == "ACTIVE" else None,
            diagnosis_snapshot={},
        )
        db.add(row)
        db.flush()
        return row

    historical_intervention = _make_intervention(revision=1, status="RESOLVED")
    current_intervention = _make_intervention(revision=2, status="ACTIVE")

    def _add_regular(
        title: str,
        *,
        category: str,
        cw_type: str,
        total_points: float,
        score: float,
        exam_subtype: str | None = None,
    ) -> ClassworkAssignment:
        cw = Classwork(
            title=title,
            classwork_type=cw_type,
            classwork_category=category,
            exam_subtype=exam_subtype,
            is_graded=True,
            total_points=Decimal(str(total_points)),
            is_published=True,
            is_archived=False,
            subject_id=subject.subject_id,
            created_by_staff_id=teacher.staff_id,
        )
        db.add(cw)
        db.flush()
        asgn = ClassworkAssignment(
            classwork_id=cw.classwork_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=teacher.staff_id,
            is_published=True,
        )
        db.add(asgn)
        db.flush()
        db.add(
            StudentSubmission(
                student_id=student.student_id,
                classwork_assignment_id=asgn.classwork_assignment_id,
                status="graded",
                grade=Decimal(str(score)),
                attempt_count=1,
                submitted_at=datetime.now(timezone.utc),
                graded_at=datetime.now(timezone.utc),
            )
        )
        db.flush()
        return asgn

    def _add_ww_pt_remediation(
        intervention: Intervention,
        original: ClassworkAssignment,
        *,
        remediation_score: float,
        cap: float = 85.0,
    ) -> tuple[ClassworkAssignment, RemediationAssignmentLink]:
        component = original.classwork.classwork_category
        cw = Classwork(
            title=f"Remediation for {original.classwork.title}",
            classwork_type=original.classwork.classwork_type,
            classwork_category=component,
            is_graded=True,
            total_points=original.classwork.total_points,
            is_published=True,
            is_archived=False,
            subject_id=subject.subject_id,
            created_by_staff_id=teacher.staff_id,
        )
        db.add(cw)
        db.flush()
        rem_asgn = ClassworkAssignment(
            classwork_id=cw.classwork_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=teacher.staff_id,
            is_published=True,
            recipient_student_id=student.student_id,
            source_intervention_id=intervention.intervention_id,
            remediation_request_id=uuid.uuid4(),
        )
        db.add(rem_asgn)
        db.flush()
        link = RemediationAssignmentLink(
            source_intervention_id=intervention.intervention_id,
            remediation_assignment_id=rem_asgn.classwork_assignment_id,
            original_assignment_id=original.classwork_assignment_id,
            student_id=student.student_id,
            component=component,
            score_adjustment_cap=Decimal(str(cap)),
            created_by_staff_id=teacher.staff_id,
        )
        db.add(link)
        db.add(
            StudentSubmission(
                student_id=student.student_id,
                classwork_assignment_id=rem_asgn.classwork_assignment_id,
                status="graded",
                grade=Decimal(str(remediation_score)),
                attempt_count=1,
                submitted_at=datetime.now(timezone.utc),
                graded_at=datetime.now(timezone.utc),
            )
        )
        db.flush()
        return rem_asgn, link

    def _add_exam_remediation(
        intervention: Intervention,
        original_exam: ClassworkAssignment,
        *,
        remediation_score: float,
    ) -> ClassworkAssignment:
        cw = Classwork(
            title=f"Remedial {original_exam.classwork.title}",
            classwork_type="QUIZ",
            classwork_category="EXAMS",
            exam_subtype=original_exam.classwork.exam_subtype,
            is_graded=True,
            total_points=original_exam.classwork.total_points,
            is_published=True,
            is_archived=False,
            subject_id=subject.subject_id,
            created_by_staff_id=teacher.staff_id,
        )
        db.add(cw)
        db.flush()
        rem_asgn = ClassworkAssignment(
            classwork_id=cw.classwork_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=teacher.staff_id,
            is_published=True,
            recipient_student_id=student.student_id,
            source_intervention_id=intervention.intervention_id,
            remediation_request_id=uuid.uuid4(),
            original_exam_assignment_id=original_exam.classwork_assignment_id,
        )
        db.add(rem_asgn)
        db.flush()
        db.add(
            StudentSubmission(
                student_id=student.student_id,
                classwork_assignment_id=rem_asgn.classwork_assignment_id,
                status="graded",
                grade=Decimal(str(remediation_score)),
                attempt_count=1,
                submitted_at=datetime.now(timezone.utc),
                graded_at=datetime.now(timezone.utc),
            )
        )
        db.flush()
        return rem_asgn

    # Regular baseline evidence (6 graded items across WW, PT, and full Exams -> HIGH_EVIDENCE ready)
    ww1 = _add_regular("WW 1", category="WRITTEN_WORK", cw_type="QUIZ", total_points=20, score=10)
    ww2 = _add_regular("WW 2", category="WRITTEN_WORK", cw_type="QUIZ", total_points=20, score=12)
    pt1 = _add_regular("PT 1", category="PERFORMANCE_TASK", cw_type="ACTIVITY", total_points=50, score=35)
    pt2 = _add_regular("PT 2", category="PERFORMANCE_TASK", cw_type="ACTIVITY", total_points=50, score=40)
    sum1 = _add_regular("Summative 1", category="EXAMS", cw_type="QUIZ", total_points=30, score=15, exam_subtype="SUMMATIVE_1")
    sum2 = _add_regular("Summative 2", category="EXAMS", cw_type="QUIZ", total_points=30, score=24, exam_subtype="SUMMATIVE_2")
    term = _add_regular("Term Exam", category="EXAMS", cw_type="QUIZ", total_points=40, score=32, exam_subtype="TERM_EXAM")
    db.commit()

    return {
        "db": db,
        "teacher": teacher,
        "student": student,
        "class": class_,
        "subject": subject,
        "period": period,
        "historical_intervention": historical_intervention,
        "current_intervention": current_intervention,
        "ww1": ww1,
        "ww2": ww2,
        "pt1": pt1,
        "pt2": pt2,
        "sum1": sum1,
        "sum2": sum2,
        "term": term,
        "add_regular": _add_regular,
        "add_ww_pt_remediation": _add_ww_pt_remediation,
        "add_exam_remediation": _add_exam_remediation,
    }


def _linear_feature_scorer(features, model_name=None):
    # Deterministic transparent surrogate matching [0, 100] scale so tests verify exact feature sensitivity.
    return round(25.0 + float(features["overall_partial_percent"]) * 0.75, 4)


def test_default_unchanged_and_exclude_reverts_multiple_ww_pt_and_exam_remediations(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    scope = dict(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
    )
    monkeypatch.setattr(current_term_scorer, "score_development_current_term", _linear_feature_scorer)

    # Capture exact pre-remediation 31-feature vector & prediction before any remediation exists.
    pre_features = build_current_period_features_from_records(db, **scope)
    pre_pred = predict_development_current_term(db, **scope)
    assert pre_pred["status"] == STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
    schema_cols = load_current_period_feature_schema()["raw_feature_columns"]
    assert list(pre_features["features"].keys()) == schema_cols
    assert len(schema_cols) == 31

    # Add multiple remediation attempts (2 WW/PT + 1 Exam) under current_intervention.
    ctx["add_ww_pt_remediation"](ctx["current_intervention"], ctx["ww1"], remediation_score=20, cap=85.0)  # 10 -> 17/20
    ctx["add_ww_pt_remediation"](ctx["current_intervention"], ctx["pt1"], remediation_score=50, cap=85.0)  # 35 -> 42.5/50
    ctx["add_exam_remediation"](ctx["current_intervention"], ctx["sum1"], remediation_score=30)            # 15 -> 30/30
    db.commit()

    # 1. Default prediction (no exclude_intervention_id) includes all remediation gains.
    default_features = build_current_period_features_from_records(db, **scope)
    default_pred = predict_development_current_term(db, **scope)
    assert default_features["features"]["ww_points_earned_so_far"] == 29.0   # 17 + 12
    assert default_features["features"]["pt_points_earned_so_far"] == 82.5   # 42.5 + 40
    assert default_features["features"]["qa_percent_so_far"] > pre_features["features"]["qa_percent_so_far"]
    assert default_pred["projected_final_term_grade"] > pre_pred["projected_final_term_grade"]

    # 2. Excluding current_intervention restores the EXACT pre-remediation 31-feature vector and prediction.
    excluded_features = build_current_period_features_from_records(
        db, **scope, exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )
    excluded_pred = predict_development_current_term(
        db, **scope, exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )
    assert excluded_features["features"] == pre_features["features"]
    assert excluded_features["evidence_summary"]["remedial_classworks"] == []
    assert excluded_features["evidence_summary"]["examination"]["subtype_percentages"] == (
        pre_features["evidence_summary"]["examination"]["subtype_percentages"]
    )
    assert excluded_pred["projected_final_term_grade"] == pre_pred["projected_final_term_grade"]


def test_historical_intervention_remains_included_when_excluding_current(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    scope = dict(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
    )
    monkeypatch.setattr(current_term_scorer, "score_development_current_term", _linear_feature_scorer)

    # Historical intervention remediated WW1 (10 -> 15 under 75% cap).
    ctx["add_ww_pt_remediation"](ctx["historical_intervention"], ctx["ww1"], remediation_score=19, cap=75.0)
    db.commit()
    after_historical_features = build_current_period_features_from_records(db, **scope)
    assert after_historical_features["features"]["ww_points_earned_so_far"] == 27.0  # 15 + 12

    # Current intervention remediates WW2 (12 -> 17 under 85% cap) and Summative 1 (15 -> 29).
    ctx["add_ww_pt_remediation"](ctx["current_intervention"], ctx["ww2"], remediation_score=20, cap=85.0)
    ctx["add_exam_remediation"](ctx["current_intervention"], ctx["sum1"], remediation_score=29)
    db.commit()

    # Default includes BOTH historical and current interventions.
    with_both = build_current_period_features_from_records(db, **scope)
    assert with_both["features"]["ww_points_earned_so_far"] == 32.0  # 15 + 17
    assert len(with_both["evidence_summary"]["remedial_classworks"]) == 2

    # Excluding current_intervention keeps historical intervention's adjustment (WW1 = 15) and reverts WW2 (12) + Sum1 (15).
    excluding_current = build_current_period_features_from_records(
        db, **scope, exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )
    assert excluding_current["features"] == after_historical_features["features"]
    assert len(excluding_current["evidence_summary"]["remedial_classworks"]) == 1
    assert excluding_current["evidence_summary"]["remedial_classworks"][0]["original_assignment_id"] == (
        ctx["ww1"].classwork_assignment_id
    )


def test_new_regular_assessments_preserved_and_allow_legitimate_grade_above_85(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    scope = dict(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
    )
    monkeypatch.setattr(current_term_scorer, "score_development_current_term", _linear_feature_scorer)

    # Start below 85.
    initial_pred = predict_development_current_term(db, **scope)
    assert initial_pred["projected_final_term_grade"] < 85.0

    # Student completes current intervention remediation (WW1: 10->17, PT1: 35->42.5).
    ctx["add_ww_pt_remediation"](ctx["current_intervention"], ctx["ww1"], remediation_score=20, cap=85.0)
    ctx["add_ww_pt_remediation"](ctx["current_intervention"], ctx["pt1"], remediation_score=50, cap=85.0)
    db.commit()

    # Later, student excels on NEW regular quizzes/tasks (not remediation).
    ctx["add_regular"]("WW 3 Regular", category="WRITTEN_WORK", cw_type="QUIZ", total_points=40, score=40)
    ctx["add_regular"]("PT 3 Regular", category="PERFORMANCE_TASK", cw_type="ACTIVITY", total_points=100, score=100)
    db.commit()

    raw_with_remediation = predict_development_current_term(db, **scope)
    unremediated_features = build_current_period_features_from_records(
        db, **scope, exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )
    unremediated_pred = predict_development_current_term(
        db, **scope, exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )

    # Original scores (WW1=10, WW2=12, PT1=35, PT2=40) AND new regular scores (WW3=40, PT3=100) are included;
    # excluded remediation boosts are NOT included.
    assert unremediated_features["features"]["ww_available_activity_count"] == 3.0
    assert unremediated_features["features"]["ww_points_earned_so_far"] == 62.0   # 10 + 12 + 40
    assert unremediated_features["features"]["ww_points_possible_so_far"] == 80.0
    assert unremediated_features["features"]["pt_available_activity_count"] == 3.0
    assert unremediated_features["features"]["pt_points_earned_so_far"] == 175.0  # 35 + 40 + 100
    assert unremediated_features["features"]["pt_points_possible_so_far"] == 200.0

    # Unremediated baseline legitimately exceeds 85 solely from regular assessments.
    baseline_grade = unremediated_pred["projected_final_term_grade"]
    raw_grade = raw_with_remediation["projected_final_term_grade"]
    assert baseline_grade > 85.0
    assert raw_grade > baseline_grade

    # Applying the Task 3 ceiling policy preserves the student's legitimate >85 grade while
    # blocking extra remediation inflation above that legitimate baseline.
    policy = apply_remediation_grade_ceiling(
        raw_prediction=raw_grade,
        unremediated_baseline=baseline_grade,
        selected_ceiling=85,
    )
    assert float(policy.capped_projection) == baseline_grade
    assert float(policy.capped_projection) > 85.0
    assert float(policy.raw_predicted_grade) == raw_grade
    assert policy.was_ceiling_applied is True


def test_exclude_intervention_is_strictly_read_only_and_preserves_actual_gradebook(baseline_ctx, monkeypatch):
    ctx = baseline_ctx
    db = ctx["db"]
    scope = dict(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
    )
    monkeypatch.setattr(current_term_scorer, "score_development_current_term", _linear_feature_scorer)

    ctx["add_ww_pt_remediation"](ctx["current_intervention"], ctx["ww1"], remediation_score=20, cap=85.0)
    db.commit()

    submissions_before = [
        (r.submission_id, r.classwork_assignment_id, r.grade, r.status)
        for r in db.query(StudentSubmission).order_by(StudentSubmission.submission_id).all()
    ]
    links_before = [
        (r.remediation_link_id, r.original_assignment_id, r.remediation_assignment_id, r.score_adjustment_cap)
        for r in db.query(RemediationAssignmentLink).order_by(RemediationAssignmentLink.remediation_link_id).all()
    ]
    preds_before = [
        (r.prediction_id, r.predicted_period_grade)
        for r in db.query(DevelopmentCurrentTermPrediction).order_by(DevelopmentCurrentTermPrediction.prediction_id).all()
    ]

    build_current_period_features_from_records(
        db, **scope, exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )
    predict_development_current_term(
        db, **scope, exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )

    assert not db.new and not db.dirty and not db.deleted
    assert [
        (r.submission_id, r.classwork_assignment_id, r.grade, r.status)
        for r in db.query(StudentSubmission).order_by(StudentSubmission.submission_id).all()
    ] == submissions_before
    assert [
        (r.remediation_link_id, r.original_assignment_id, r.remediation_assignment_id, r.score_adjustment_cap)
        for r in db.query(RemediationAssignmentLink).order_by(RemediationAssignmentLink.remediation_link_id).all()
    ] == links_before
    assert [
        (r.prediction_id, r.predicted_period_grade)
        for r in db.query(DevelopmentCurrentTermPrediction).order_by(DevelopmentCurrentTermPrediction.prediction_id).all()
    ] == preds_before

    # Official gradebook still reflects actual remediation-adjusted effective WW1 score (17/20).
    gb = teacher_student_gradebook(
        db,
        staff_id=ctx["teacher"].staff_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    )
    row = next(item for item in gb.studentGrades if item.student_id == str(ctx["student"].student_id))
    assert row.writtenWork[0] == 17.0


def test_excluded_remediation_ambiguous_submission_does_not_poison_baseline_readiness(baseline_ctx):
    ctx = baseline_ctx
    db = ctx["db"]
    scope = dict(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
    )

    rem_asgn, _link = ctx["add_ww_pt_remediation"](
        ctx["current_intervention"], ctx["ww1"], remediation_score=18, cap=85.0,
    )
    # Add a second graded submission with identical timestamp on the excluded remediation assignment.
    existing_sub = (
        db.query(StudentSubmission)
        .filter_by(classwork_assignment_id=rem_asgn.classwork_assignment_id)
        .one()
    )
    db.add(
        StudentSubmission(
            student_id=ctx["student"].student_id,
            classwork_assignment_id=rem_asgn.classwork_assignment_id,
            status="graded",
            grade=Decimal("19"),
            attempt_count=2,
            submitted_at=existing_sub.submitted_at,
            graded_at=existing_sub.graded_at,
        )
    )
    db.commit()

    excluded = build_current_period_features_from_records(
        db, **scope, exclude_intervention_id=ctx["current_intervention"].intervention_id,
    )
    assert excluded["ready"] is True
    assert "UNRESOLVED_EVIDENCE" not in excluded["readiness_reason_codes"]


@pytest.mark.parametrize("bad_id", [0, -1, True, False, "1"])
def test_invalid_exclude_intervention_id_rejected(baseline_ctx, bad_id):
    ctx = baseline_ctx
    with pytest.raises(ValueError, match="exclude_intervention_id must be a positive integer"):
        build_current_period_features_from_records(
            ctx["db"],
            ctx["student"].student_id,
            ctx["class"].class_id,
            ctx["subject"].subject_id,
            ctx["period"].academic_period_id,
            exclude_intervention_id=bad_id,
        )
