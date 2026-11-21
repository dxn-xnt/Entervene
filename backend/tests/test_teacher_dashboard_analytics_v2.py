"""Comprehensive verification for Analytics-First Teacher Dashboard (v2)."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
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
from app.models.academic.SubjectPeriodGradingTemplate import SubjectPeriodGradingTemplate
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.attendance.Attendance import AttendanceRecord
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAssignmentRecipient import ClassworkAssignmentRecipient
from app.models.intervention.Intervention import Intervention
from app.models.intervention.PracticeAssessment import PracticeAssessment
from app.models.intervention.PracticeAttempt import PracticeAttempt
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.activity import AnalyticsService

NOW = datetime(2026, 10, 8, 4, 0, tzinfo=timezone.utc)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def world(db, monkeypatch):
    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: NOW)

    year = AcademicYear(
        academic_year_id=101,
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    hist_year = AcademicYear(
        academic_year_id=100,
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=False,
    )
    db.add_all([hist_year, year])
    db.flush()

    period = AcademicPeriod(
        academic_period_id=201,
        academic_year_id=year.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 10, 31),
        is_active=True,
    )
    hist_period = AcademicPeriod(
        academic_period_id=200,
        academic_year_id=hist_year.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2025, 8, 1),
        end_date=date(2025, 10, 31),
        is_active=False,
    )
    db.add_all([hist_period, period])
    db.flush()

    level = AcademicLevel(academic_level_id=1, level_name="Grade 11", grade_level=11)
    gt_80 = GradingTemplate(
        grading_template_id=1, template_name="Stem80", passing_threshold=Decimal("80.00"), status="active",
    )
    gt_75 = GradingTemplate(
        grading_template_id=2, template_name="Core75", passing_threshold=Decimal("75.00"), status="active",
    )
    db.add_all([level, gt_80, gt_75])
    db.flush()

    for gt in (gt_80, gt_75):
        db.add_all([
            GradingTemplateComponent(grading_template_id=gt.grading_template_id, component_name="Written Work", weight=Decimal("25.00"), display_order=1),
            GradingTemplateComponent(grading_template_id=gt.grading_template_id, component_name="Performance Tasks", weight=Decimal("45.00"), display_order=2),
            GradingTemplateComponent(grading_template_id=gt.grading_template_id, component_name="Exams", weight=Decimal("30.00"), display_order=3),
        ])
    db.flush()

    math = Subject(
        subject_id=11,
        academic_level_id=level.academic_level_id,
        subject_name="General Mathematics",
        subject_codename="GM11",
        grading_template_id=gt_80.grading_template_id,
    )
    english = Subject(
        subject_id=12,
        academic_level_id=level.academic_level_id,
        subject_name="Oral Communication",
        subject_codename="OC11",
        grading_template_id=gt_75.grading_template_id,
    )
    db.add_all([math, english])
    db.flush()

    cls_active = Class(
        class_id=301,
        section_name="11-Rizal",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        class_status="active",
    )
    cls_hist_archived = Class(
        class_id=300,
        section_name="11-Bonifacio-25",
        academic_year_id=hist_year.academic_year_id,
        academic_level_id=level.academic_level_id,
        class_status="archived",
    )
    db.add_all([cls_hist_archived, cls_active])
    db.flush()

    t1_uid, t2_uid = uuid.uuid4(), uuid.uuid4()
    db.add_all([
        UserAccount(user_id=t1_uid, email="t1@entervene.test", password_hash="x"),
        UserAccount(user_id=t2_uid, email="sub@entervene.test", password_hash="x"),
    ])
    db.flush()

    teacher = AcademicStaff(staff_id="ST-101", user_id=t1_uid, first_name="Main", last_name="Teacher", employment_status="active")
    substitute = AcademicStaff(staff_id="ST-102", user_id=t2_uid, first_name="Sub", last_name="Teacher", employment_status="active")
    db.add_all([teacher, substitute])
    db.flush()

    load_math = SubjectLoad(
        class_id=cls_active.class_id,
        subject_id=math.subject_id,
        staff_id=teacher.staff_id,
        academic_period_id=period.academic_period_id,
        is_active_version=True,
        status="active",
    )
    load_hist = SubjectLoad(
        class_id=cls_hist_archived.class_id,
        subject_id=math.subject_id,
        staff_id=teacher.staff_id,
        academic_period_id=hist_period.academic_period_id,
        is_active_version=True,
        status="active",
    )
    db.add_all([load_math, load_hist])
    db.flush()

    s1 = Student(student_id=uuid.uuid4(), student_lrn="100000000001", first_name="Alice", last_name="Private", academic_level_id=level.academic_level_id)
    s2 = Student(student_id=uuid.uuid4(), student_lrn="100000000002", first_name="Bob", last_name="Hidden", academic_level_id=level.academic_level_id)
    s3 = Student(student_id=uuid.uuid4(), student_lrn="100000000003", first_name="Cara", last_name="Secret", academic_level_id=level.academic_level_id)
    db.add_all([s1, s2, s3])
    db.flush()

    for s in (s1, s2, s3):
        db.add(StudentClass(student_id=s.student_id, class_id=cls_active.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"))
    db.add(StudentClass(student_id=s1.student_id, class_id=cls_hist_archived.class_id, academic_year_id=hist_year.academic_year_id, enrollment_status="enrolled"))
    db.commit()

    return {
        "year": year,
        "hist_year": hist_year,
        "period": period,
        "hist_period": hist_period,
        "level": level,
        "gt_80": gt_80,
        "gt_75": gt_75,
        "math": math,
        "english": english,
        "cls_active": cls_active,
        "cls_hist_archived": cls_hist_archived,
        "teacher": teacher,
        "substitute": substitute,
        "load_math": load_math,
        "load_hist": load_hist,
        "students": [s1, s2, s3],
    }


def _make_assignment(
    db,
    world,
    *,
    title: str,
    classwork_type: str = "ASSIGNMENT",
    activity_mode: str = "ONLINE",
    is_graded: bool = True,
    total_points: Decimal | None = Decimal("100"),
    category: str | None = "WRITTEN_WORK",
    is_archived: bool = False,
    class_=None,
    subject=None,
    period=None,
    due_date: datetime | None = NOW,
):
    cw = Classwork(
        title=title,
        classwork_type=classwork_type,
        activity_mode=activity_mode,
        is_graded=is_graded,
        total_points=total_points,
        classwork_category=category,
        is_published=True,
        is_archived=is_archived,
        subject_id=(subject or world["math"]).subject_id,
        created_by_staff_id=world["teacher"].staff_id,
    )
    db.add(cw)
    db.flush()
    asgn = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=(class_ or world["cls_active"]).class_id,
        academic_period_id=(period or world["period"]).academic_period_id,
        assigned_by_staff_id=world["teacher"].staff_id,
        is_published=True,
        due_date=due_date,
    )
    db.add(asgn)
    db.flush()
    return asgn


def test_separation_of_participation_grading_completion_and_official_scores(db, world):
    s1, s2, s3 = world["students"]

    # 1. Ungraded ONLINE activity (legitimately requires student submission -> Participation ONLY)
    ungraded_online = _make_assignment(
        db, world, title="Ungraded Reflection", classwork_type="ACTIVITY",
        activity_mode="ONLINE", is_graded=False, total_points=None, category=None,
    )
    db.add(StudentSubmission(
        classwork_assignment_id=ungraded_online.classwork_assignment_id,
        student_id=s1.student_id, status="submitted", submitted_at=NOW - timedelta(hours=2),
    ))

    # 2. READING acknowledgement (must be EXCLUDED from submission, grading completion, & official scores)
    reading = _make_assignment(
        db, world, title="Chapter 1 Reading", classwork_type="READING",
        activity_mode="ONLINE", is_graded=False, total_points=None, category=None,
    )
    db.add(StudentSubmission(
        classwork_assignment_id=reading.classwork_assignment_id,
        student_id=s1.student_id, status="submitted", submitted_at=NOW - timedelta(hours=2),
    ))

    # 3. MANUAL graded activity (EXCLUDED from online submission & grading queue; INCLUDED in official scores)
    manual_graded = _make_assignment(
        db, world, title="Board Recitation", classwork_type="ACTIVITY",
        activity_mode="MANUAL", is_graded=True, total_points=Decimal("20"), category="PERFORMANCE_TASK",
    )
    db.add(StudentSubmission(
        classwork_assignment_id=manual_graded.classwork_assignment_id,
        student_id=s1.student_id, status="graded", grade=Decimal("18"),
        graded_by_staff_id=world["teacher"].staff_id, graded_at=NOW - timedelta(hours=1),
        submitted_at=NOW - timedelta(hours=1),
    ))

    # 4. Graded ONLINE Quiz:
    #    - s1: fully auto-graded (status='graded', grade=80, graded_by_staff_id=None)
    #    - s2: essay quiz awaiting manual grading (status='submitted', PARTIAL grade=40, graded_at=None)
    #    - s3: teacher-graded (status='graded', grade=100, graded_by_staff_id=ST-101)
    quiz = _make_assignment(
        db, world, title="Unit 1 Quiz", classwork_type="QUIZ",
        activity_mode="ONLINE", is_graded=True, total_points=Decimal("100"), category="WRITTEN_WORK",
    )
    db.add_all([
        StudentSubmission(
            classwork_assignment_id=quiz.classwork_assignment_id,
            student_id=s1.student_id, status="graded", grade=Decimal("80"),
            graded_by_staff_id=None, graded_at=NOW - timedelta(hours=1), submitted_at=NOW - timedelta(hours=1),
        ),
        StudentSubmission(
            classwork_assignment_id=quiz.classwork_assignment_id,
            student_id=s2.student_id, status="submitted", grade=Decimal("40"),
            graded_by_staff_id=None, graded_at=None, submitted_at=NOW - timedelta(hours=1),
        ),
        StudentSubmission(
            classwork_assignment_id=quiz.classwork_assignment_id,
            student_id=s3.student_id, status="graded", grade=Decimal("100"),
            graded_by_staff_id=world["teacher"].staff_id, graded_at=NOW - timedelta(hours=1),
            submitted_at=NOW - timedelta(hours=1),
        ),
    ])
    db.commit()

    result = AnalyticsService.build_teacher_dashboard_health(db, world["teacher"].staff_id, world["period"])
    analytics = result["analytics"]

    # Participation (Submission Rate): ungraded_online (3 expected, 1 submitted) + quiz (3 expected, 3 submitted)
    # Reading & manual_graded are excluded -> 4 / 6 = 66.7%
    sub = analytics["submission_rate"]
    assert sub["expected_count"] == 6
    assert sub["submitted_count"] == 4
    assert sub["submission_rate_percent"] == 66.7

    # Grading Completion (gradable online = quiz ONLY; ungraded_online, reading, manual excluded):
    # 3 submitted: 1 auto-graded (s1) + 1 teacher-graded (s3) = 2 finalized; 1 awaiting manual (s2 w/ partial grade=40)
    gc = analytics["grading_completion"]
    assert gc["submitted_gradable_count"] == 3
    assert gc["finalized_count"] == 2
    assert gc["auto_graded_count"] == 1
    assert gc["teacher_graded_count"] == 1
    assert gc["awaiting_grading_count"] == 1
    assert gc["grading_completion_rate_percent"] == 66.7

    # Official Graded Performance (manual_graded s1=90% + quiz s1=80% + quiz s3=100%; s2 partial 40% EXCLUDED):
    # (90 + 80 + 100) / 3 = 90.0%
    gp = analytics["graded_performance"]
    assert gp["scored_submission_count"] == 3
    assert gp["avg_graded_score_percent"] == 90.0

    # Zero student PII and zero placeholders anywhere in JSON response
    assert "pending_grading" not in result["action_queue"]
    assert "top_performers" not in result["details"]
    assert "students_to_check_in_with" not in result["details"]
    encoded = json.dumps(result)
    for forbidden in (
        "Alice", "Private", "Bob", "Hidden", "Cara", "Secret",
        "100000000001", "student_name", "student_id", "student_lrn",
        "top_performers", "students_to_check_in_with",
        "Grading Turnaround", "Feedback Coverage", "Not calculated",
    ):
        assert forbidden not in encoded


def test_authoritative_recipient_scope_uses_classwork_assignment_recipient(db, world):
    s1, s2, _ = world["students"]
    scoped_asgn = _make_assignment(db, world, title="Selected Group Lab", classwork_type="ASSIGNMENT")
    db.add(ClassworkAssignmentRecipient(
        classwork_assignment_id=scoped_asgn.classwork_assignment_id,
        student_id=s1.student_id,
        assigned_by_staff_id=world["teacher"].staff_id,
    ))
    # Both s1 (recipient) and s2 (non-recipient) have rows; only s1 counts
    db.add_all([
        StudentSubmission(
            classwork_assignment_id=scoped_asgn.classwork_assignment_id,
            student_id=s1.student_id, status="graded", grade=Decimal("90"),
            graded_by_staff_id=world["teacher"].staff_id, submitted_at=NOW - timedelta(hours=1),
        ),
        StudentSubmission(
            classwork_assignment_id=scoped_asgn.classwork_assignment_id,
            student_id=s2.student_id, status="submitted", submitted_at=NOW - timedelta(hours=1),
        ),
    ])
    db.commit()

    result = AnalyticsService.build_teacher_dashboard_health(db, world["teacher"].staff_id, world["period"])
    assert result["analytics"]["submission_rate"]["expected_count"] == 1
    assert result["analytics"]["submission_rate"]["submitted_count"] == 1
    assert result["analytics"]["submission_rate"]["submission_rate_percent"] == 100.0
    assert result["analytics"]["grading_completion"]["awaiting_grading_count"] == 0


def test_configured_subject_threshold_and_period_override_without_hardcoded_75(db, world):
    s1, s2, _ = world["students"]
    # Math base threshold is 80.00. Add a finalized period grade of 78.00 (s1) and 85.00 (s2); s3 ungraded.
    db.add_all([
        StudentPeriodGrade(
            student_id=s1.student_id, class_id=world["cls_active"].class_id,
            subject_id=world["math"].subject_id, academic_period_id=world["period"].academic_period_id,
            transmuted_grade=Decimal("78.00"), is_finalized=True,
        ),
        StudentPeriodGrade(
            student_id=s2.student_id, class_id=world["cls_active"].class_id,
            subject_id=world["math"].subject_id, academic_period_id=world["period"].academic_period_id,
            transmuted_grade=Decimal("85.00"), is_finalized=True,
        ),
    ])
    db.commit()

    res = AnalyticsService.build_teacher_dashboard_health(db, world["teacher"].staff_id, world["period"])
    ts = res["analytics"]["threshold_summary"]
    assert ts["uniform_passing_threshold"] == 80.0
    assert ts["meeting_threshold_count"] == 1
    assert ts["below_threshold_count"] == 1
    assert ts["meeting_threshold_percent"] == 50.0
    assert ts["below_threshold_percent"] == 50.0
    assert ts["available_grade_count"] == 2
    assert ts["total_grade_count"] == 3
    assert ts["grade_coverage_percent"] == 66.7

    # Neutral grade distribution includes percentage share per band
    bands = {b["band"]: b for b in res["analytics"]["grade_distribution"]["bands"]}
    assert bands["75-79"]["count"] == 1 and bands["75-79"]["percent"] == 50.0
    assert bands["85-89"]["count"] == 1 and bands["85-89"]["percent"] == 50.0

    # Apply a period-specific override template (gt_75 -> 75.00): now BOTH 78 and 85 pass!
    db.add(SubjectPeriodGradingTemplate(
        subject_id=world["math"].subject_id,
        academic_period_id=world["period"].academic_period_id,
        grading_template_id=world["gt_75"].grading_template_id,
        change_reason="Period policy override test",
    ))
    db.commit()

    res_override = AnalyticsService.build_teacher_dashboard_health(db, world["teacher"].staff_id, world["period"])
    ts2 = res_override["analytics"]["threshold_summary"]
    assert ts2["uniform_passing_threshold"] == 75.0
    assert ts2["meeting_threshold_count"] == 2
    assert ts2["meeting_threshold_percent"] == 100.0


def test_historical_archived_class_visible_but_archived_classwork_excluded(db, world):
    s1 = world["students"][0]
    published_hist = _make_assignment(
        db, world, title="Published Historical Quiz", classwork_type="QUIZ",
        class_=world["cls_hist_archived"], period=world["hist_period"],
        due_date=datetime(2025, 9, 15, 4, 0, tzinfo=timezone.utc),
    )
    _make_assignment(
        db, world, title="Archived Historical Quiz", classwork_type="QUIZ",
        is_archived=True, class_=world["cls_hist_archived"], period=world["hist_period"],
        due_date=datetime(2025, 9, 16, 4, 0, tzinfo=timezone.utc),
    )
    db.add(StudentSubmission(
        classwork_assignment_id=published_hist.classwork_assignment_id,
        student_id=s1.student_id, status="graded", grade=Decimal("90"),
        submitted_at=datetime(2025, 9, 14, 4, 0, tzinfo=timezone.utc),
    ))
    db.add(AttendanceRecord(
        class_id=world["cls_hist_archived"].class_id,
        student_id=s1.student_id,
        date=date(2025, 9, 10),
        status="present",
    ))
    db.commit()

    res = AnalyticsService.build_teacher_dashboard_health(db, world["teacher"].staff_id, world["hist_period"])
    assert res["kpis"]["active_classes"] == 1
    assert res["analytics"]["submission_rate"]["eligible_assignment_count"] == 1
    assert res["analytics"]["submission_rate"]["submission_rate_percent"] == 100.0
    assert res["analytics"]["period_attendance"]["rate"] == 100.0


def test_substitute_teacher_sees_substituted_load_and_original_teacher_assignments(db, world):
    s1 = world["students"][0]
    asgn = _make_assignment(db, world, title="Original Teacher Exam", classwork_type="QUIZ")
    db.add(StudentSubmission(
        classwork_assignment_id=asgn.classwork_assignment_id,
        student_id=s1.student_id, status="graded", grade=Decimal("88"),
        submitted_at=NOW - timedelta(hours=1),
    ))
    db.add(TeacherSubstitution(
        subject_load_id=world["load_math"].subject_load_id,
        original_staff_id=world["teacher"].staff_id,
        substitute_staff_id=world["substitute"].staff_id,
        start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 30),
        status="active",
    ))
    db.commit()

    res = AnalyticsService.build_teacher_dashboard_health(db, world["substitute"].staff_id, world["period"])
    assert res["kpis"]["active_classes"] == 1
    assert res["analytics"]["submission_rate"]["expected_count"] == 3
    assert res["analytics"]["submission_rate"]["submitted_count"] == 1
    assert res["analytics"]["graded_performance"]["avg_graded_score_percent"] == 88.0


def test_intervention_analytics_and_isolated_practice_assessments(db, world):
    s1, s2, s3 = world["students"]
    model = AIModelVersion(
        model_name="v2-test-model", model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION", algorithm="rf", is_active=False,
    )
    db.add(model)
    db.flush()

    preds = []
    for idx, student in enumerate((s1, s2, s3), start=1):
        p = DevelopmentCurrentTermPrediction(
            student_id=student.student_id,
            class_id=world["cls_active"].class_id,
            subject_id=world["math"].subject_id,
            source_period_id=world["period"].academic_period_id,
            target_period_id=world["period"].academic_period_id,
            model_version_id=model.model_version_id,
            revision=1,
            predicted_period_grade=Decimal("70.00"),
            intervention_level="MODERATE_RISK",
            intervention_basis="test",
            evidence_snapshot={},
        )
        db.add(p)
        preds.append(p)
    db.flush()

    # s1: CANDIDATE (unactivated)
    i_cand = Intervention(
        student_id=s1.student_id, class_id=world["cls_active"].class_id,
        subject_id=world["math"].subject_id, academic_period_id=world["period"].academic_period_id,
        source_prediction_id=preds[0].prediction_id, status="CANDIDATE", diagnosis_snapshot={},
    )
    # s2: ACTIVE (with published PracticeAssessment that was attempted & passed)
    i_active = Intervention(
        student_id=s2.student_id, class_id=world["cls_active"].class_id,
        subject_id=world["math"].subject_id, academic_period_id=world["period"].academic_period_id,
        source_prediction_id=preds[1].prediction_id, status="ACTIVE",
        activated_at=NOW - timedelta(days=3), activated_by_staff_id=world["teacher"].staff_id,
        diagnosis_snapshot={},
    )
    # s3: RESOLVED via IMPROVED_PREDICTION (with published PracticeAssessment NOT attempted)
    i_resolved = Intervention(
        student_id=s3.student_id, class_id=world["cls_active"].class_id,
        subject_id=world["math"].subject_id, academic_period_id=world["period"].academic_period_id,
        source_prediction_id=preds[2].prediction_id, status="RESOLVED",
        resolution_reason="IMPROVED_PREDICTION",
        activated_at=NOW - timedelta(days=5), activated_by_staff_id=world["teacher"].staff_id,
        resolved_at=NOW - timedelta(days=1), diagnosis_snapshot={},
    )
    db.add_all([i_cand, i_active, i_resolved])
    db.flush()

    pa_active = PracticeAssessment(
        intervention_id=i_active.intervention_id, title="Practice 1", status="PUBLISHED",
        created_by_staff_id=world["teacher"].staff_id,
    )
    pa_resolved = PracticeAssessment(
        intervention_id=i_resolved.intervention_id, title="Practice 2", status="PUBLISHED",
        created_by_staff_id=world["teacher"].staff_id,
    )
    db.add_all([pa_active, pa_resolved])
    db.flush()

    db.add(PracticeAttempt(
        practice_assessment_id=pa_active.practice_assessment_id,
        student_id=s2.student_id,
        attempt_number=1,
        status="SUBMITTED",
        total_score=Decimal("9.00"),
        max_score=Decimal("10.00"),
        score_percentage=Decimal("90.00"),
        passing_threshold_snapshot=Decimal("75.00"),
        is_passed=True,
        question_order=[1],
        completed_at=NOW - timedelta(hours=2),
    ))
    db.commit()

    res = AnalyticsService.build_teacher_dashboard_health(db, world["teacher"].staff_id, world["period"])
    iv = res["analytics"]["interventions"]

    assert iv["candidate_count"] == 1
    assert iv["active_count"] == 1
    assert iv["resolved_improved_count"] == 1
    assert iv["resolved_other_count"] == 0
    assert iv["total_count"] == 3
    assert iv["activated_count"] == 2
    assert iv["activation_rate_percent"] == 66.7
    # Denominator = Active (1) + Resolved (1) = 2 -> 1/2 = 50.0%
    assert iv["improved_prediction_resolution_rate_percent"] == 50.0
    assert iv["other_resolution_rate_percent"] == 0.0

    # Practice assessments isolated cleanly
    pa = iv["practice_assessments"]
    assert pa["published_count"] == 2
    assert pa["attempted_count"] == 1
    assert pa["passed_count"] == 1
    assert pa["attempt_participation_rate_percent"] == 50.0
    assert pa["attempted_pass_rate_percent"] == 100.0
    assert pa["is_ungraded"] is True
    assert pa["excluded_from_official_grades"] is True

    # Practice attempt MUST NOT leak into official submission, grading, or score metrics
    assert res["analytics"]["submission_rate"]["expected_count"] == 0
    assert res["analytics"]["submission_rate"]["submission_rate_percent"] is None
    assert res["analytics"]["graded_performance"]["avg_graded_score_percent"] is None
    assert res["analytics"]["graded_performance"]["scored_submission_count"] == 0


def test_zero_student_name_selects_and_strictly_read_only(db, world):
    _make_assignment(db, world, title="Read-only Check", classwork_type="QUIZ")
    db.commit()

    statements: list[str] = []

    def capture(_conn, _cursor, statement, _params, _ctx, _many):
        assert statement.lstrip().upper().startswith("SELECT")
        statements.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", capture)
    try:
        AnalyticsService.build_teacher_dashboard_health(db, world["teacher"].staff_id, world["period"])
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", capture)

    # Zero dashboard-level student-name projection queries (only internal gradebook roster read)
    dashboard_name_queries = [
        s for s in statements
        if "student.first_name" in s and "FROM student" in s and "student.student_lrn" not in s
    ]
    assert dashboard_name_queries == []
