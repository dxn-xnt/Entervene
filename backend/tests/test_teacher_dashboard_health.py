"""Isolated SQLite behavior tests; authentication and the clock are mocked.

These exercise ORM queries and HTTP serialization without a running backend,
live database, provider, or API. The reusable seed also supports gated PG tests.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Analytics import router
from app.api.v1.routes.Auth import get_current_user
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.attendance.Attendance import AttendanceRecord
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.academic.Lesson import Lesson
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.services.activity import AnalyticsService
from app.services.activity.TeacherDashboardMetrics import (
    DashboardWarning,
    PASSING_CONFIGURATION_WARNING,
    ThresholdResolution,
)


NOW = datetime(2026, 10, 8, 1, 0, tzinfo=timezone.utc)  # Thursday 09:00 Manila
NEXT_MONDAY = datetime(2026, 10, 11, 16, 0, tzinfo=timezone.utc)
_DEFAULT_PERIOD = object()


def add_assignment(
    db, data, key, *, period=_DEFAULT_PERIOD, staff=None, class_=None,
    subject=None, due_date=None, published=True, archived=False,
):
    staff = staff or data["teacher"]
    class_ = class_ or data["class_"]
    subject = subject or data["subject"]
    period = data["period"] if period is _DEFAULT_PERIOD else period
    work = Classwork(
        title=key, classwork_type="ASSIGNMENT", classwork_category="WRITTEN_WORK",
        total_points=Decimal("50.00"), subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id, is_archived=archived,
        created_at=NOW - timedelta(days=4),
    )
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id, class_id=class_.class_id,
        academic_period_id=period.academic_period_id if period else None,
        assigned_by_staff_id=staff.staff_id, is_published=published,
        publish_date=NOW - timedelta(days=3), due_date=due_date,
    )
    db.add(assignment)
    db.flush()
    data["assignments"][key] = assignment
    return assignment


def add_submission(db, data, key, assignment, student, *, status="submitted", grade=None):
    submission = StudentSubmission(
        classwork_assignment_id=assignment.classwork_assignment_id,
        student_id=student.student_id, status=status, grade=grade,
        submitted_at=NOW - timedelta(minutes=5),
    )
    db.add(submission)
    db.flush()
    data["submissions"][key] = submission
    return submission


def seed_dashboard_data(db):
    """Seed valid model rows, including adversarial term/teacher/enrollment data."""
    year = AcademicYear(
        year_label="2026-2027", start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31), is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()
    periods = [
        AcademicPeriod(
            academic_year_id=year.academic_year_id, period_name=f"Term {sequence}",
            period_type="TERM", period_sequence=sequence, total_periods_in_year=3,
            start_date=start, end_date=end, is_active=sequence == 2,
        )
        for sequence, start, end in [
            (1, date(2026, 8, 1), date(2026, 9, 30)),
            (2, date(2026, 10, 1), date(2026, 12, 31)),
            (3, date(2027, 1, 1), date(2027, 5, 31)),
        ]
    ]
    db.add_all(periods)
    staff = []
    for index, name in enumerate(["Ada", "Grace", "Empty"], start=1):
        account = UserAccount(user_id=uuid.uuid4(), email=f"teacher{index}@dashboard.test")
        db.add(account)
        db.flush()
        teacher = AcademicStaff(
            staff_id=f"T-DASH-{index}", first_name=name, last_name="Teacher",
            user_id=account.user_id, employment_status="active",
        )
        db.add(teacher)
        staff.append(teacher)
    classes = [
        Class(
            section_name=name, academic_year_id=year.academic_year_id,
            academic_level_id=level.academic_level_id, class_status="active",
        )
        for name in ["Newton", "Einstein", "Curie"]
    ]
    template = GradingTemplate(grading_template_id=1, template_name="Core", passing_threshold=Decimal("85"), status="active")
    template.components = [
        GradingTemplateComponent(component_name="Written Work", weight=Decimal("20"), display_order=1),
        GradingTemplateComponent(component_name="Performance Tasks", weight=Decimal("50"), display_order=2),
        GradingTemplateComponent(component_name="Exams", weight=Decimal("30"), display_order=3),
    ]
    db.add(template)
    db.flush()
    subjects = [
        Subject(subject_name=name, academic_level_id=level.academic_level_id,
                status="active", grading_template_id=template.grading_template_id)
        for name in ["Mathematics", "History", "English"]
    ]
    db.add_all(classes + subjects)
    db.flush()
    previous, period, empty = periods
    teacher, other, empty_teacher = staff
    class_, other_class, previous_class = classes
    subject, other_subject, off_load_subject = subjects
    loads = [
        (teacher, class_, subject, period),
        (teacher, class_, subject, previous),
        (teacher, previous_class, subject, previous),
        (other, class_, subject, period),
        (other, other_class, other_subject, period),
    ]
    db.add_all([
        SubjectLoad(
            staff_id=person.staff_id, class_id=cls.class_id, subject_id=subj.subject_id,
            academic_period_id=term.academic_period_id, status="published", is_active_version=True,
        )
        for person, cls, subj, term in loads
    ])
    students = {}
    for index, (name, cls, status) in enumerate([
        ("active_one", class_, "enrolled"), ("active_two", class_, "enrolled"),
        ("withdrawn", class_, "withdrawn"), ("inactive", class_, "inactive"),
        ("other", other_class, "enrolled"), ("previous", previous_class, "enrolled"),
    ], start=1):
        student = Student(
            student_id=uuid.uuid4(), student_lrn=f"{index:012d}",
            first_name=name, last_name="Student", academic_level_id=level.academic_level_id,
        )
        db.add(student)
        db.flush()
        db.add(StudentClass(
            student_id=student.student_id, class_id=cls.class_id,
            academic_year_id=year.academic_year_id, enrollment_status=status,
        ))
        students[name] = student
    db.flush()
    data = {
        "year": year, "period": period, "previous_period": previous, "empty_period": empty,
        "teacher": teacher, "other_teacher": other, "empty_teacher": empty_teacher,
        "class_": class_, "other_class": other_class, "previous_class": previous_class,
        "subject": subject, "other_subject": other_subject, "off_load_subject": off_load_subject,
        "students": students, "assignments": {}, "submissions": {},
    }
    graded = add_assignment(db, data, "main_graded", due_date=NOW + timedelta(hours=1))
    pending = add_assignment(db, data, "main_pending", due_date=NOW + timedelta(days=2))
    add_submission(db, data, "graded_one", graded, students["active_one"], status="graded", grade=Decimal("25.50"))
    add_submission(db, data, "graded_two", graded, students["active_two"], status="graded", grade=Decimal("45.50"))
    add_submission(db, data, "pending_active", pending, students["active_one"])
    add_submission(db, data, "not_submitted", pending, students["active_two"], status="pending")
    add_submission(db, data, "withdrawn_grade", graded, students["withdrawn"], status="graded", grade=Decimal("999.00"))
    add_submission(db, data, "withdrawn_pending", pending, students["withdrawn"])
    add_submission(db, data, "inactive_pending", pending, students["inactive"], status="late")
    add_submission(db, data, "outsider_grade", graded, students["other"], status="graded", grade=Decimal("999.00"))
    add_submission(db, data, "outsider_pending", pending, students["other"])
    for key, kwargs in [
        ("old_period", {"period": previous}), ("legacy_null", {"period": None}),
        ("other_shared", {"staff": other}),
        ("other_foreign", {"staff": other, "class_": other_class, "subject": other_subject}),
        ("archived", {"archived": True}), ("draft", {"published": False}),
        ("outside_load", {"subject": off_load_subject}),
    ]:
        assignment = add_assignment(db, data, key, due_date=NOW + timedelta(hours=2), **kwargs)
        student = students["other"] if key == "other_foreign" else students["active_one"]
        add_submission(db, data, f"excluded_{key}", assignment, student)
    db.add_all([
        AttendanceRecord(
            student_id=students["active_one"].student_id, class_id=class_.class_id,
            subject_id=subject.subject_id, date=date(2026, 10, 7), status="present",
        ),
        AttendanceRecord(
            student_id=students["active_two"].student_id, class_id=class_.class_id,
            subject_id=subject.subject_id, date=date(2026, 10, 7), status="absent",
        ),
        AttendanceRecord(
            student_id=students["withdrawn"].student_id, class_id=class_.class_id,
            subject_id=subject.subject_id, date=date(2026, 10, 7), status="absent",
        ),
        AttendanceRecord(
            student_id=students["active_one"].student_id, class_id=class_.class_id,
            subject_id=subject.subject_id, date=date(2026, 9, 7), status="absent",
        ),
    ])
    db.commit()
    return data


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def data(db, monkeypatch):
    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: NOW)
    return seed_dashboard_data(db)


def dashboard(db, data, **kwargs):
    # Persist test fixture edits before exercising the strictly read-only path.
    db.flush()
    return AnalyticsService.build_teacher_dashboard_health(
        db, data["teacher"].staff_id, kwargs.pop("period", data["period"]), **kwargs,
    )


def test_removed_sections_and_improved_prediction_resolution_card_position(db, data):
    """Students to Check In With and Top Performers are removed; Improved Prediction Resolution Rate is directly below Active Classes."""
    result = dashboard(db, data)
    assert "students_to_check_in_with" not in result["details"]
    assert "students_needing_support" not in result["details"]
    assert "top_performers" not in result["details"]

    titles = [card["title"] for card in result["cards"]]
    assert titles[0] == "Active Classes"
    assert titles[1] == "Improved Prediction Resolution Rate"
    assert result["cards"][1]["count"] == "—"
    assert result["details"]["intervention_resolution"] == {
        "candidate_count": 0,
        "active_count": 0,
        "resolved_improved_count": 0,
        "resolved_other_count": 0,
        "resolved_total_count": 0,
        "eligible_count": 0,
        "total_count": 0,
        "improved_prediction_resolution_rate_percent": None,
    }


def test_improved_prediction_resolution_rate_calculation_and_scoping(db, data):
    """Numerator is RESOLVED via IMPROVED_PREDICTION; denominator is ACTIVE + RESOLVED (excluding CANDIDATE, other periods, and withdrawn learners)."""
    from app.models.ai.AIModelVersion import AIModelVersion
    from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
    from app.models.intervention.Intervention import Intervention
    from app.models.intervention.PracticeAssessment import PracticeAssessment
    from app.models.intervention.PracticeAttempt import PracticeAttempt

    model = AIModelVersion(
        model_name="dashboard-resolution-test",
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="rf",
        is_active=False,
    )
    db.add(model)
    db.flush()

    def make_pred(student, *, cls=None, subj=None, period=None, rev=1, grade="70.00"):
        pred = DevelopmentCurrentTermPrediction(
            student_id=student.student_id,
            class_id=(cls or data["class_"]).class_id,
            subject_id=(subj or data["subject"]).subject_id,
            source_period_id=(period or data["period"]).academic_period_id,
            target_period_id=(period or data["period"]).academic_period_id,
            model_version_id=model.model_version_id,
            revision=rev,
            predicted_period_grade=Decimal(grade),
            intervention_level="MODERATE_RISK",
            intervention_basis="test",
            evidence_snapshot={},
        )
        db.add(pred)
        db.flush()
        return pred

    s1 = data["students"]["active_one"]
    s2 = data["students"]["active_two"]
    withdrawn = data["students"]["withdrawn"]

    # 1. Unactivated CANDIDATE (excluded from numerator and denominator)
    p_cand = make_pred(s1, rev=1)
    db.add(Intervention(
        student_id=s1.student_id,
        class_id=data["class_"].class_id,
        subject_id=data["subject"].subject_id,
        academic_period_id=data["period"].academic_period_id,
        source_prediction_id=p_cand.prediction_id,
        status="CANDIDATE",
        diagnosis_snapshot={},
    ))

    # 2. ACTIVE intervention (in denominator)
    p_active = make_pred(s2, rev=1)
    i_active = Intervention(
        student_id=s2.student_id,
        class_id=data["class_"].class_id,
        subject_id=data["subject"].subject_id,
        academic_period_id=data["period"].academic_period_id,
        source_prediction_id=p_active.prediction_id,
        status="ACTIVE",
        activated_at=NOW - timedelta(days=3),
        activated_by_staff_id=data["teacher"].staff_id,
        diagnosis_snapshot={},
    )
    db.add(i_active)

    # 3. RESOLVED via IMPROVED_PREDICTION (in numerator AND denominator)
    p_improved = make_pred(s1, rev=2)
    db.add(Intervention(
        student_id=s1.student_id,
        class_id=data["class_"].class_id,
        subject_id=data["subject"].subject_id,
        academic_period_id=data["period"].academic_period_id,
        source_prediction_id=p_improved.prediction_id,
        status="RESOLVED",
        resolution_reason="IMPROVED_PREDICTION",
        activated_at=NOW - timedelta(days=5),
        activated_by_staff_id=data["teacher"].staff_id,
        resolved_at=NOW - timedelta(days=1),
        diagnosis_snapshot={},
    ))

    # 4. RESOLVED via non-improvement reason (in denominator ONLY, not numerator)
    p_other = make_pred(s2, rev=2)
    db.add(Intervention(
        student_id=s2.student_id,
        class_id=data["class_"].class_id,
        subject_id=data["subject"].subject_id,
        academic_period_id=data["period"].academic_period_id,
        source_prediction_id=p_other.prediction_id,
        status="RESOLVED",
        resolution_reason="TEACHER_CLOSED",
        activated_at=NOW - timedelta(days=6),
        activated_by_staff_id=data["teacher"].staff_id,
        resolved_at=NOW - timedelta(days=2),
        diagnosis_snapshot={},
    ))

    # 5. Withdrawn learner RESOLVED via IMPROVED_PREDICTION (excluded by active roster filter)
    p_withdrawn = make_pred(withdrawn, rev=1)
    db.add(Intervention(
        student_id=withdrawn.student_id,
        class_id=data["class_"].class_id,
        subject_id=data["subject"].subject_id,
        academic_period_id=data["period"].academic_period_id,
        source_prediction_id=p_withdrawn.prediction_id,
        status="RESOLVED",
        resolution_reason="IMPROVED_PREDICTION",
        activated_at=NOW - timedelta(days=4),
        activated_by_staff_id=data["teacher"].staff_id,
        resolved_at=NOW - timedelta(days=1),
        diagnosis_snapshot={},
    ))

    # 6. Previous period RESOLVED via IMPROVED_PREDICTION (excluded in current period)
    p_prev = make_pred(s1, period=data["previous_period"], rev=1)
    db.add(Intervention(
        student_id=s1.student_id,
        class_id=data["class_"].class_id,
        subject_id=data["subject"].subject_id,
        academic_period_id=data["previous_period"].academic_period_id,
        source_prediction_id=p_prev.prediction_id,
        status="RESOLVED",
        resolution_reason="IMPROVED_PREDICTION",
        activated_at=NOW - timedelta(days=40),
        activated_by_staff_id=data["teacher"].staff_id,
        resolved_at=NOW - timedelta(days=35),
        diagnosis_snapshot={},
    ))
    db.flush()

    # Add PracticeAssessment + PracticeAttempt on i_active to verify practice assessments do not pollute lesson mastery or grades
    pa = PracticeAssessment(
        intervention_id=i_active.intervention_id,
        title="Ungraded Practice",
        status="PUBLISHED",
        created_by_staff_id=data["teacher"].staff_id,
    )
    db.add(pa)
    db.flush()
    db.add(PracticeAttempt(
        practice_assessment_id=pa.practice_assessment_id,
        student_id=s2.student_id,
        attempt_number=1,
        status="SUBMITTED",
        total_score=Decimal("10.00"),
        max_score=Decimal("10.00"),
        score_percentage=Decimal("100.00"),
        passing_threshold_snapshot=Decimal("75.00"),
        is_passed=True,
        question_order=[1],
        completed_at=NOW - timedelta(hours=1),
    ))
    db.commit()

    result = dashboard(db, data)
    ir = result["details"]["intervention_resolution"]
    assert ir["candidate_count"] == 1
    assert ir["active_count"] == 1
    assert ir["resolved_improved_count"] == 1
    assert ir["resolved_other_count"] == 1
    assert ir["resolved_total_count"] == 2
    assert ir["eligible_count"] == 3
    assert ir["total_count"] == 4
    # 1 improved / 3 (1 active + 2 resolved) = 33.3%
    assert ir["improved_prediction_resolution_rate_percent"] == 33.3

    rate_card = result["cards"][1]
    assert rate_card["title"] == "Improved Prediction Resolution Rate"
    assert rate_card["count"] == "33.3%"
    assert rate_card["stat"] == "1 of 3 active & resolved"

    # Previous period sees only its own resolved intervention (1/1 = 100.0%)
    prev_result = dashboard(db, data, period=data["previous_period"])
    prev_ir = prev_result["details"]["intervention_resolution"]
    assert prev_ir["resolved_improved_count"] == 1
    assert prev_ir["eligible_count"] == 1
    assert prev_ir["improved_prediction_resolution_rate_percent"] == 100.0


def test_ungraded_quiz_is_excluded_from_lowest_mastery_lessons(db, data):
    """Ungraded quizzes must not count as official graded lesson mastery evidence."""
    fixture = seed_dashboard_lesson_data(db, data)
    assert len(dashboard(db, data)["details"]["lesson_performance"]["subjects"][0]["items"]) == 1

    fixture["assignment"].classwork.is_graded = False
    db.flush()
    subject_summary = dashboard(db, data)["details"]["lesson_performance"]["subjects"][0]
    assert subject_summary["items"] == []
    assert subject_summary["coverage"]["scored_mapped_response_count"] == 0


def test_entire_path_read_only_even_with_a_dirty_name_and_zero_full_roster_name_query(db, data, monkeypatch):
    """Forbid every write API and SQL DML after fixture setup; no full-roster student name query is emitted."""
    from sqlalchemy import event
    db.flush()
    staff_id, period = data["teacher"].staff_id, data["period"]
    learner = data["students"]["active_one"]
    learner.first_name = "Unsaved fixture edit"
    statements = []
    def reject_write(*_args, **_kwargs):
        raise AssertionError("Dashboard attempted a write")
    for method in ("add", "add_all", "delete", "flush", "commit"):
        monkeypatch.setattr(db, method, reject_write)
    def select_only(_connection, _cursor, statement, _parameters, _context, _many):
        assert statement.lstrip().upper().startswith("SELECT")
        statements.append(statement)
    event.listen(db.get_bind(), "before_cursor_execute", select_only)
    try:
        result = AnalyticsService.build_teacher_dashboard_health(db, staff_id, period)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", select_only)
    assert "students_to_check_in_with" not in result["details"]
    assert "top_performers" not in result["details"]
    assert learner in db.dirty
    full_roster_name_queries = [
        sql for sql in statements
        if "student.first_name" in sql and "student.middle_name" in sql and "student.suffix" in sql
        and "student.student_lrn" not in sql
    ]
    assert full_roster_name_queries == []


def create_client(db, identity):
    app = FastAPI()
    app.include_router(router, prefix="/analytics")
    app.dependency_overrides[get_current_user] = lambda: identity
    def override_db():
        yield db
    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def test_exact_teacher_term_and_active_enrollment_scope(db, data):
    result = dashboard(db, data)
    assert result["kpis"] == {
        "active_classes": 1, "enrolled_students": 2,
        "overall_completion_rate": 75.0, "ungraded_count": 1,
    }
    points = result["trend_chart"]["points"]
    assert [p["classwork_id"] for p in points] == [
        data["assignments"][key].classwork_id for key in ["main_graded", "main_pending"]
    ]
    assert [(p["total_enrolled"], p["submitted_count"]) for p in points] == [(2, 2), (2, 1)]
    assert [(p["avg_score_percent"], p["completion_rate_percent"]) for p in points] == [(71.0, 100.0), (None, 50.0)]
    assert result["trend_chart"]["has_sufficient_data"] is False
    section = result["section_matrix"][0]
    assert (section["student_count"], section["published_classworks"]) == (2, 2)
    assert section["avg_score_percent"] == 71.0  # The trend's observed score is unchanged.
    assert section["passing_threshold"] == float(data["subject"].grading_template.passing_threshold)
    assert section["available_grade_count"] == section["total_grade_count"] == 2
    assert section["passing_rate_percent"] == 0.0
    assert (section["completion_rate_percent"], section["attendance_rate_percent"]) == (75.0, 50.0)
    queue = result["action_queue"]
    assert [s["submission_id"] for s in queue["pending_grading"]] == [data["submissions"]["pending_active"].submission_id]
    assert queue["pending_grading"][0]["student_id"] == str(data["students"]["active_one"].student_id)
    assert [a["classwork_id"] for a in queue["upcoming_deadlines"]] == [p["classwork_id"] for p in points]
    assert [(a["submitted_count"], a["total_students"]) for a in queue["upcoming_deadlines"]] == [(2, 2), (1, 2)]


@pytest.mark.parametrize("identity", [None, "missing-staff", "x" * 36, "00000000-0000-0000-0000-000000000001"])
def test_unknown_identity_fails_closed_even_when_teachers_exist(db, data, identity):
    with pytest.raises(HTTPException) as error:
        AnalyticsService.build_teacher_dashboard_health(db, identity, data["period"])
    assert error.value.status_code == 403


@pytest.mark.parametrize("identity_type", ["staff", "uuid", "uuid_string"])
def test_valid_identity_forms_resolve_same_teacher(db, data, identity_type):
    teacher = data["teacher"]
    identity = {"staff": teacher.staff_id, "uuid": teacher.user_id, "uuid_string": str(teacher.user_id)}[identity_type]
    result = AnalyticsService.build_teacher_dashboard_health(db, identity, data["period"])
    assert result["kpis"]["ungraded_count"] == 1


@pytest.mark.parametrize("empty_kind", ["selected_period", "no_teacher_loads", "no_period"])
def test_empty_scope_has_honest_phase_one_zeros_and_empty_data(db, data, empty_kind):
    teacher = data["empty_teacher"] if empty_kind == "no_teacher_loads" else data["teacher"]
    period = None if empty_kind == "no_period" else data["empty_period"] if empty_kind == "selected_period" else data["period"]
    result = AnalyticsService.build_teacher_dashboard_health(db, teacher.staff_id, period)
    assert result["kpis"] == {
        "active_classes": 0, "enrolled_students": 0,
        "overall_completion_rate": None, "ungraded_count": 0,
    }
    cards = {card["title"]: card for card in result["cards"]}
    assert "Overall Completion" not in cards
    assert "Attendance Today" not in cards
    assert "attendance_today" not in result["phase_two"]
    assert (cards["Active Classes"]["count"], cards["Active Classes"]["stat"]) == ("0", "0 sections")
    assert (cards["Submission Rate"]["count"], cards["Submission Rate"]["stat"]) == ("—", "0 of 0 submitted")
    assert (cards["Ungraded Queue"]["count"], cards["Ungraded Queue"]["stat"]) == ("0", "0 submissions")
    assert cards["Current grade"]["count"] == "—"
    assert result["trend_chart"]["available_filters"] == result["trend_chart"]["points"] == []
    assert result["section_matrix"] == []
    assert result["action_queue"] == {"pending_grading": [], "upcoming_deadlines": []}


def test_selected_previous_period_does_not_leak_active_period(db, data):
    result = dashboard(db, data, period=data["previous_period"])
    assert [p["classwork_id"] for p in result["trend_chart"]["points"]] == [data["assignments"]["old_period"].classwork_id]
    assert [s["submission_id"] for s in result["action_queue"]["pending_grading"]] == [data["submissions"]["excluded_old_period"].submission_id]
    assert result["kpis"]["overall_completion_rate"] == 50.0


def test_selected_authorized_combo_changes_chart_but_keeps_teacher_totals(db, data):
    class_ = data["previous_class"]
    db.add(SubjectLoad(
        staff_id=data["teacher"].staff_id, class_id=class_.class_id,
        subject_id=data["subject"].subject_id, academic_period_id=data["period"].academic_period_id,
        status="active", is_active_version=True,
    ))
    assignment = add_assignment(db, data, "second_section", class_=class_)
    add_submission(db, data, "second_section", assignment, data["students"]["previous"], status="graded", grade=Decimal("40.00"))
    result = dashboard(db, data, class_id=class_.class_id, subject_id=data["subject"].subject_id)
    assert result["kpis"] == {
        "active_classes": 2, "enrolled_students": 3,
        "overall_completion_rate": 80.0, "ungraded_count": 1,
    }
    assert len(result["section_matrix"]) == 2
    assert result["trend_chart"]["selected_class_id"] == class_.class_id
    assert [p["classwork_id"] for p in result["trend_chart"]["points"]] == [assignment.classwork_id]
    assert result["trend_chart"]["points"][0]["avg_score_percent"] == 80.0


def test_assignment_creator_or_assignor_must_be_the_scoped_teacher(db, data):
    data["assignments"]["other_shared"].assigned_by_staff_id = data["teacher"].staff_id
    data["assignments"]["main_pending"].assigned_by_staff_id = data["other_teacher"].staff_id
    result = dashboard(db, data)
    assert result["kpis"]["ungraded_count"] == 2
    assert {s["submission_id"] for s in result["action_queue"]["pending_grading"]} == {
        data["submissions"]["pending_active"].submission_id,
        data["submissions"]["excluded_other_shared"].submission_id,
    }


def test_trend_requires_three_actual_valid_mastery_points(db, data):
    for index in range(2):
        assignment = add_assignment(db, data, f"mastery_{index}")
        add_submission(db, data, f"mastery_{index}", assignment, data["students"]["active_one"], status="graded", grade=Decimal("25.00"))
    assert dashboard(db, data)["trend_chart"]["has_sufficient_data"] is True
    data["assignments"]["mastery_1"].classwork.total_points = Decimal("0.00")
    assert dashboard(db, data)["trend_chart"]["has_sufficient_data"] is False


def test_missing_enrollments_and_no_submissions_remain_zero_not_null(db, data):
    db.query(StudentSubmission).delete(synchronize_session=False)
    result = dashboard(db, data)
    assert result["kpis"]["overall_completion_rate"] == 0.0
    assert result["kpis"]["ungraded_count"] == 0
    assert result["section_matrix"][0]["avg_score_percent"] is None
    assert result["section_matrix"][0]["passing_rate_percent"] is None
    assert all(p["avg_score_percent"] is None and p["completion_rate_percent"] == 0.0 for p in result["trend_chart"]["points"])
    db.query(StudentClass).filter(StudentClass.class_id == data["class_"].class_id).update({"enrollment_status": "withdrawn"})
    db.flush()
    empty = dashboard(db, data)
    assert empty["kpis"]["enrolled_students"] == 0
    assert empty["kpis"]["overall_completion_rate"] is None
    assert empty["section_matrix"][0]["attendance_rate_percent"] is None
    assert all(p["total_enrolled"] == 0 and p["completion_rate_percent"] is None for p in empty["trend_chart"]["points"])


@pytest.mark.parametrize("total_points,expected", [(None, None), (Decimal("0.00"), None), (Decimal("100.00"), 0.0)])
def test_missing_point_totals_and_genuine_zero_scores(db, data, total_points, expected):
    work = data["assignments"]["main_graded"].classwork
    work.total_points = total_points
    data["submissions"]["graded_one"].grade = Decimal("0.00")
    data["submissions"]["graded_two"].grade = Decimal("0.00")
    db.flush()
    result = dashboard(db, data)
    assert result["trend_chart"]["points"][0]["avg_score_percent"] == expected
    assert result["section_matrix"][0]["avg_score_percent"] == expected
    # Missing this work's denominator does not erase the class record's other work.
    assert result["section_matrix"][0]["available_grade_count"] == 2
    assert result["section_matrix"][0]["passing_rate_percent"] == 0.0


def test_deadlines_use_now_to_next_monday_manila_with_ascending_real_ids(db, data):
    for key, due in [
        ("past_week", NOW - timedelta(days=7)), ("earlier_today", NOW - timedelta(seconds=1)),
        ("exact_now", NOW), ("late_sunday", NEXT_MONDAY - timedelta(seconds=1)),
        ("monday_boundary", NEXT_MONDAY), ("end_next_week", NEXT_MONDAY + timedelta(days=6)),
    ]:
        add_assignment(db, data, key, due_date=due)
    db.commit()
    result = dashboard(db, data)
    expected = ["exact_now", "main_graded", "main_pending", "late_sunday"]
    assert [a["classwork_id"] for a in result["action_queue"]["upcoming_deadlines"]] == [data["assignments"][key].classwork_id for key in expected]
    assert all(a["total_students"] == 2 for a in result["action_queue"]["upcoming_deadlines"])


def test_deadline_week_changes_at_monday_in_manila_not_utc(db, data, monkeypatch):
    monday_now = NEXT_MONDAY + timedelta(minutes=30)  # Sunday UTC, Monday Manila.
    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: monday_now)
    assignment = add_assignment(db, data, "new_school_week", due_date=monday_now + timedelta(days=2))
    result = dashboard(db, data)
    assert [a["classwork_id"] for a in result["action_queue"]["upcoming_deadlines"]] == [assignment.classwork_id]


def test_upcoming_queue_limit_keeps_five_earliest_scoped_deadlines(db, data):
    expected = []
    for index in range(7):
        assignment = add_assignment(db, data, f"soon_{index}", due_date=NOW + timedelta(minutes=index))
        expected.append(assignment.classwork_id)
    result = dashboard(db, data)
    assert [a["classwork_id"] for a in result["action_queue"]["upcoming_deadlines"]] == expected[:5]


def test_pending_queue_is_limited_after_scope_and_status_filters(db, data):
    own = []
    for index in range(7):
        assignment = add_assignment(db, data, f"queue_{index}")
        submission = add_submission(db, data, f"queue_{index}", assignment, data["students"]["active_one"], status="late")
        # Keep all fixture events through now; preserve the newest-first test.
        submission.submitted_at = NOW - timedelta(minutes=7 - index)
        own.append(submission.submission_id)
    result = dashboard(db, data)
    assert result["kpis"]["ungraded_count"] == 8
    assert [s["submission_id"] for s in result["action_queue"]["pending_grading"]] == list(reversed(own))[:5]


def test_noncurrent_load_version_draft_and_inactive_class_are_excluded(db, data):
    load = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == data["teacher"].staff_id,
        SubjectLoad.academic_period_id == data["period"].academic_period_id,
    ).one()
    load.is_active_version = False
    assert dashboard(db, data)["kpis"]["active_classes"] == 0
    load.is_active_version = True
    load.status = "draft"
    assert dashboard(db, data)["kpis"]["active_classes"] == 0
    load.status = "active"
    data["class_"].class_status = "inactive"
    assert dashboard(db, data)["kpis"]["active_classes"] == 0


def test_teacher_route_ignores_staff_override_and_other_teacher_filter(db, data):
    client = create_client(db, {"sub": str(data["teacher"].user_id), "role": "teacher"})
    own = client.get("/analytics/teacher/dashboard-health", params={
        "academic_period_id": data["period"].academic_period_id,
        "staff_id": data["other_teacher"].staff_id,
    })
    assert own.status_code == 200
    assert own.json()["kpis"]["ungraded_count"] == 1
    response = client.get("/analytics/teacher/dashboard-health", params={
        "academic_period_id": data["period"].academic_period_id,
        "staff_id": data["other_teacher"].staff_id,
        "class_id": data["other_class"].class_id, "subject_id": data["other_subject"].subject_id,
    })
    assert response.status_code == 403


def test_admin_route_can_select_teacher_without_other_teacher_data(db, data):
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})
    response = client.get("/analytics/teacher/dashboard-health", params={
        "academic_period_id": data["period"].academic_period_id, "staff_id": data["other_teacher"].staff_id,
    })
    assert response.status_code == 200
    assert {s["submission_id"] for s in response.json()["action_queue"]["pending_grading"]} == {
        data["submissions"]["excluded_other_shared"].submission_id,
        data["submissions"]["excluded_other_foreign"].submission_id,
    }


def test_active_substitute_does_not_inherit_primary_teacher_dashboard_data(db, data):
    """Phase 1 uses primary loads; substitute dashboard support is deferred."""
    load = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == data["teacher"].staff_id,
        SubjectLoad.academic_period_id == data["period"].academic_period_id,
    ).one()
    substitution = TeacherSubstitution(
        subject_load_id=load.subject_load_id,
        original_staff_id=data["teacher"].staff_id,
        substitute_staff_id=data["empty_teacher"].staff_id,
        start_date=NOW.date() - timedelta(days=1),
        end_date=NOW.date() + timedelta(days=1), status="active",
    )
    db.add(substitution)
    db.commit()
    assert substitution.subject_load.staff_id == data["teacher"].staff_id
    assert substitution.start_date <= NOW.date() <= substitution.end_date

    client = create_client(db, {"sub": str(data["empty_teacher"].user_id), "role": "teacher"})
    response = client.get("/analytics/teacher/dashboard-health", params={
        "academic_period_id": data["period"].academic_period_id,
        "staff_id": data["teacher"].staff_id,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["kpis"] == {
        "active_classes": 0, "enrolled_students": 0,
        "overall_completion_rate": None, "ungraded_count": 0,
    }
    assert body["trend_chart"]["available_filters"] == body["trend_chart"]["points"] == []
    assert body["section_matrix"] == []
    assert body["action_queue"] == {"pending_grading": [], "upcoming_deadlines": []}

    primary = dashboard(db, data)
    assert primary["kpis"] == {
        "active_classes": 1, "enrolled_students": 2,
        "overall_completion_rate": 75.0, "ungraded_count": 1,
    }
    assert [s["submission_id"] for s in primary["action_queue"]["pending_grading"]] == [
        data["submissions"]["pending_active"].submission_id,
    ]


@pytest.mark.parametrize("period_id", [0, -1, 999999])
def test_route_rejects_explicit_invalid_period_without_active_fallback(db, data, period_id):
    client = create_client(db, {"sub": str(data["teacher"].user_id), "role": "teacher"})
    response = client.get("/analytics/teacher/dashboard-health", params={"academic_period_id": period_id})
    assert response.status_code == 404
    assert response.json()["detail"] == "Academic period not found"


def test_route_defaults_to_active_period_and_unknown_user_is_forbidden(db, data):
    client = create_client(db, {"user_id": str(data["teacher"].user_id), "role": "teacher"})
    response = client.get("/analytics/teacher/dashboard-health")
    assert response.status_code == 200
    assert response.json()["term_info"]["period_id"] == data["period"].academic_period_id
    unknown = create_client(db, {"sub": str(uuid.uuid4()), "role": "teacher"})
    assert unknown.get("/analytics/teacher/dashboard-health").status_code == 403


def test_student_role_is_forbidden(db, data):
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "student"})
    assert client.get("/analytics/teacher/dashboard-health").status_code == 403


def test_month_attendance_uses_all_recorded_rows_and_active_roster(db, data):
    """Mocked behavior: all four statuses, no invented missing-day entries."""
    for index, status in enumerate(["present", "late", "excused", "absent"]):
        db.add(AttendanceRecord(
            class_id=data["class_"].class_id, student_id=data["students"]["active_one"].student_id,
            date=NOW.date() - timedelta(days=index), status=status,
        ))
    result = dashboard(db, data)
    monthly = result["details"]["attendance_by_section"][0]
    assert monthly["record_count"] == 6  # Two existing + four new, no withdrawn row.
    assert monthly["present_count"] == 2 and monthly["late_count"] == 1
    assert monthly["excused_count"] == 1 and monthly["absent_count"] == 2
    assert monthly["rate"] == 50.0
    assert result["section_matrix"][0]["attendance_rate_percent"] == monthly["rate"]
    assert result["section_matrix"][0]["attendance_record_count"] == monthly["record_count"]
    assert "attendance_today" not in result["phase_two"]
    assert all(card["title"] != "Attendance Today" for card in result["cards"])
    previous = dashboard(db, data, period=data["previous_period"])
    assert all(row["record_count"] == 0 and row["rate"] is None for row in previous["details"]["attendance_by_section"])


def test_month_boundaries_and_today_use_the_same_manila_clock(db, data, monkeypatch):
    """Mocked behavior: UTC September becomes Manila October, future rows excluded."""
    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: datetime(2026, 9, 30, 16, tzinfo=timezone.utc))
    for day in [date(2026, 9, 30), date(2026, 10, 1), date(2026, 10, 2)]:
        db.add(AttendanceRecord(
            class_id=data["class_"].class_id, student_id=data["students"]["active_two"].student_id,
            date=day, status="late",
        ))
    result = dashboard(db, data)
    assert result["details"]["attendance_by_section"][0]["record_count"] == 1
    assert result["details"]["attendance_by_section"][0]["rate"] == 100.0
    assert "attendance_today" not in result["phase_two"]
    assert result["phase_two"]["month_window"]["start_date"] == "2026-10-01"


def test_missing_threshold_keeps_grade_but_marks_passing_unavailable(db, data, monkeypatch):
    """Mocked behavior: configuration gaps never create a partial passing rate."""
    monkeypatch.setattr(
        "app.services.activity.AnalyticsService.resolve_dashboard_passing_threshold",
        lambda s, **_policy: ThresholdResolution(
            subject_id=s.subject_id,
            grading_template_id=None,
            warning=DashboardWarning(
                code="invalid_passing_threshold",
                message=PASSING_CONFIGURATION_WARNING,
                subject_id=s.subject_id,
            ),
        ),
    )
    result = dashboard(db, data)
    summary = result["phase_two"]["grades"]
    assert summary["current_grade"] is not None
    assert summary["passing_rate_percent"] is None
    assert summary["warnings"][0]["code"] == "invalid_passing_threshold"
    assert result["section_matrix"][0]["passing_rate_percent"] is None
    assert next(card for card in result["cards"] if card["title"] == "Passing Rate")["count"] == "—"
    assert "top_performers" not in result["details"]
    assert sum(item["count"] for item in result["details"]["grade_distribution"]) == summary["available_grade_count"]
    assert result["details"]["grade_details"]["warnings"] == summary["warnings"]


def test_threshold_updates_are_used_by_the_next_dashboard_request(db, data):
    """Mocked behavior: runtime policy updates, no dashboard threshold cache."""
    before = dashboard(db, data)
    assert before["phase_two"]["grades"]["passing_rate_percent"] == 0.0
    data["subject"].grading_template.passing_threshold = Decimal("40.25")
    after = dashboard(db, data)
    assert after["phase_two"]["grades"]["passing_rate_percent"] == 100.0
    assert after["section_matrix"][0]["passing_threshold"] == 40.25


def test_late_summary_excuses_use_deadline_manila_date_without_subject_match(db, data):
    """Mocked behavior: excused removed from numerator AND denominator."""
    deadline = datetime(2026, 9, 30, 17, tzinfo=timezone.utc)  # October 1 Manila.
    data["assignments"]["main_graded"].due_date = deadline
    db.add(AttendanceRecord(
        class_id=data["class_"].class_id, student_id=data["students"]["active_one"].student_id,
        subject_id=data["other_subject"].subject_id, date=date(2026, 10, 1), status="excused",
    ))
    result = dashboard(db, data)
    summary = result["phase_two"]["late_submissions"]
    assert summary["excused_excluded_count"] == 1
    assert summary["late_count"] == 1 and summary["eligible_count"] == 2
    assert summary["late_rate_percent"] == 50.0
    assert result["phase_two"]["require_subject_match"] is False
    assert result["phase_two"]["weekdays"]["total_count"] == 3  # Excuse does not remove a submission.
    assert result["kpis"]["overall_completion_rate"] == 75.0


def test_excuse_deadline_query_is_not_clipped_to_attendance_month(db, data):
    """Mocked behavior: previous-month deadline may excuse a current submission."""
    data["assignments"]["main_graded"].due_date = datetime(2026, 9, 29, 17, tzinfo=timezone.utc)
    db.add(AttendanceRecord(
        class_id=data["class_"].class_id, student_id=data["students"]["active_one"].student_id,
        date=date(2026, 9, 30), status="excused",
    ))
    result = dashboard(db, data)
    assert result["phase_two"]["late_submissions"]["excused_excluded_count"] == 1
    assert result["details"]["attendance_by_section"][0]["excused_count"] == 0


def test_weekday_counts_are_manila_six_rows_plus_sunday(db, data):
    """Mocked behavior: selected period, future exclusion, Sunday in metadata."""
    data["submissions"]["graded_one"].submitted_at = datetime(2026, 10, 3, 17, tzinfo=timezone.utc)
    data["submissions"]["graded_two"].submitted_at = datetime(2026, 9, 30, 17, tzinfo=timezone.utc)
    result = dashboard(db, data)
    summary = result["phase_two"]["weekdays"]
    assert len(summary["days"]) == len(result["details"]["submissions_by_weekday"]) == 6
    assert summary["sunday_count"] == 1
    assert summary["total_count"] == 3
    assert [row["count"] for row in result["details"]["submissions_by_weekday"]] == [0, 0, 0, 2, 0, 0]
    previous = dashboard(db, data, period=data["previous_period"])
    assert previous["phase_two"]["weekdays"]["total_count"] == 0


def test_submission_calendar_metrics_consolidate_missing_timestamp_warnings(db, data):
    """Legacy online gaps remain disclosed once per widget and do not erase valid coverage."""
    for key in ("legacy_missing_one", "legacy_missing_two"):
        assignment = add_assignment(db, data, key, due_date=NOW - timedelta(hours=1))
        submission = add_submission(db, data, key, assignment, data["students"]["active_one"])
        submission.submitted_at = None

    result = dashboard(db, data)["phase_two"]
    late = result["late_submissions"]
    weekdays = result["weekdays"]

    assert late["eligible_count"] == 5
    assert late["evaluable_count"] == 3
    assert late["unevaluable_count"] == 2
    assert late["late_rate_percent"] == 0.0
    assert [warning["code"] for warning in late["warnings"]] == ["missing_submission_timestamp"]
    assert weekdays["completed_count"] == 5
    assert weekdays["total_count"] == 3
    assert weekdays["unevaluable_count"] == 2
    assert [warning["code"] for warning in weekdays["warnings"]] == ["missing_submission_timestamp"]


def test_manual_grade_rows_are_not_treated_as_timestampless_submissions(db, data):
    """Offline gradebook evidence has no submission event and belongs only to grade metrics."""
    baseline = dashboard(db, data)["phase_two"]
    assignment = add_assignment(db, data, "manual_activity", due_date=NOW - timedelta(hours=1))
    assignment.classwork.classwork_type = "ACTIVITY"
    assignment.classwork.activity_mode = "MANUAL"
    submission = add_submission(
        db, data, "manual_activity", assignment, data["students"]["active_one"],
        status="graded", grade=Decimal("40"),
    )
    submission.submitted_at = None

    result = dashboard(db, data)["phase_two"]
    assert result["late_submissions"] == baseline["late_submissions"]
    assert result["weekdays"] == baseline["weekdays"]


def test_missing_deadlines_are_distinct_and_consolidated_for_lateness_only(db, data):
    for key in ("missing_deadline_one", "missing_deadline_two"):
        assignment = add_assignment(db, data, key, due_date=None)
        add_submission(db, data, key, assignment, data["students"]["active_one"])

    result = dashboard(db, data)["phase_two"]
    late = result["late_submissions"]
    weekdays = result["weekdays"]
    assert late["eligible_count"] == 5
    assert late["evaluable_count"] == 3
    assert late["unevaluable_count"] == 2
    assert [warning["code"] for warning in late["warnings"]] == ["missing_deadline_timestamp"]
    assert weekdays["total_count"] == weekdays["completed_count"] == 5
    assert weekdays["warnings"] == []


@pytest.mark.parametrize("explicit_period", [True, False])
def test_route_period_lookup_does_not_autoflush_dirty_session(db, data, monkeypatch, explicit_period):
    """Mocked behavior: the entire authenticated route is SELECT-only."""
    from sqlalchemy import event

    identity = {"sub": str(data["teacher"].user_id), "role": "teacher"}
    period_id = data["period"].academic_period_id
    data["teacher"].first_name = "Unpersisted test edit"
    def forbidden(*args, **kwargs):
        pytest.fail("Dashboard route attempted a write or flush")
    def select_only(_connection, _cursor, statement, _parameters, _context, _many):
        assert statement.lstrip().upper().startswith("SELECT")
    event.listen(db.get_bind(), "before_cursor_execute", select_only)
    try:
        with monkeypatch.context() as guard:
            for method in ["flush", "commit", "add", "add_all", "delete"]:
                guard.setattr(db, method, forbidden)
            with create_client(db, identity) as client:
                response = client.get("/analytics/teacher/dashboard-health", params={
                    "academic_period_id": period_id,
                } if explicit_period else {})
            assert response.status_code == 200
            assert response.json()["phase_two"]["grades"]["available_grade_count"] == 2
            assert db.dirty
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", select_only)


def test_phase_three_uses_real_scoped_current_grades_and_neutral_bands_without_top_performers(db, data):
    """Grade distribution and grade details remain populated while Top Performers is removed."""
    result = dashboard(db, data)
    details = result["details"]
    coverage = details["grade_details"]
    assert "top_performers" not in details
    assert coverage["available_grade_count"] == 2
    assert coverage["total_grade_count"] == 2
    assert coverage["unavailable_grade_count"] == 0
    assert coverage["warnings"] == result["phase_two"]["grades"]["warnings"]
    assert sum(item["count"] for item in details["grade_distribution"]) == 2
    assert all("variant" not in item for item in details["grade_distribution"])


@pytest.mark.parametrize("scope", ["empty_period", "previous_period", "empty_teacher", "other_teacher"])
def test_phase_three_keeps_teacher_and_period_isolation(db, data, scope):
    """Mocked-behavior: no cross-teacher or current-period fallback."""
    period = data.get(scope, data["period"]) if scope.endswith("period") else data["period"]
    staff = data[scope] if scope.endswith("teacher") else data["teacher"]
    db.flush()
    result = AnalyticsService.build_teacher_dashboard_health(db, staff.staff_id, period)
    assert "top_performers" not in result["details"]
    if scope in {"empty_period", "empty_teacher"}:
        assert result["details"]["grade_details"]["total_grade_count"] == 0
    assert sum(band["count"] for band in result["details"]["grade_distribution"]) == result["details"]["grade_details"]["available_grade_count"]


def test_phase_three_preserves_same_student_subject_in_two_active_classes(db, data, monkeypatch):
    """Mocked-behavior: two grade scopes, without violating enrollment uniqueness."""
    from types import SimpleNamespace
    from app.services.activity import TeacherDashboardMetrics

    second_class = data["previous_class"]
    learner_id = str(data["students"]["active_one"].student_id)
    calls = []
    def gradebook(_db, staff, class_id, subject_id, period_id):
        calls.append((class_id, subject_id, period_id))
        return SimpleNamespace(studentGrades=[SimpleNamespace(student_id=learner_id, transmuted_grade=84.5)])
    monkeypatch.setattr(TeacherDashboardMetrics, "teacher_student_gradebook", gradebook)
    grades = TeacherDashboardMetrics.read_dashboard_current_grades(db, data["teacher"].staff_id, [
        TeacherDashboardMetrics.DashboardScope(class_id, data["subject"].subject_id,
            data["period"].academic_period_id, frozenset({learner_id}))
        for class_id in (data["class_"].class_id, second_class.class_id)
    ])
    result = TeacherDashboardMetrics.rank_dashboard_performers(grades,
        TeacherDashboardMetrics.read_dashboard_student_names(db, [learner_id]), {})
    assert len(calls) == 2
    rows = [row for row in result.items if row.student_id == learner_id]
    assert len(rows) == 2
    assert {row.class_id for row in rows} == {data["class_"].class_id, second_class.class_id}
    assert [row.current_grade for row in rows] == [84.5, 84.5]
    assert TeacherDashboardMetrics.summarize_dashboard_grade_distribution(grades).available_grade_count == 2


def test_phase_three_is_not_scoped_to_the_trend_selector(db, data):
    """An explicit unauthorized trend tuple is rejected rather than replaced."""
    with pytest.raises(HTTPException) as error:
        dashboard(db, data, class_id=data["other_class"].class_id, subject_id=data["other_subject"].subject_id)
    assert error.value.status_code == 403


def test_phase_three_authorization_unavailable_keeps_coverage_and_warning(db, data, monkeypatch):
    """Mocked-behavior: missing authorized scope is neither zero nor demo data."""
    from app.services.activity import TeacherDashboardMetrics
    def denied(*_args):
        raise HTTPException(403, "Do not expose internal authorization details")
    monkeypatch.setattr(TeacherDashboardMetrics, "teacher_student_gradebook", denied)
    result = dashboard(db, data)
    details = result["details"]
    assert "top_performers" not in details
    assert details["grade_details"]["unavailable_grade_count"] == details["grade_details"]["total_grade_count"] == 2
    assert [band["count"] for band in details["grade_distribution"]] == [0] * 5
    assert details["grade_details"]["warnings"][0]["code"] == "grade_scope_unavailable"
    assert "internal authorization" not in str(details["grade_details"])


def make_targeted_assignment(db, data, key, recipient, *, due_date=None):
    """Real synthetic FK/check-constrained rows, reusable by PostgreSQL parity."""
    from app.models.ai.AIModelVersion import AIModelVersion
    from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
    from app.models.intervention.Intervention import Intervention

    model = AIModelVersion(model_name=f"dashboard-fixture-{key}", model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION", algorithm="synthetic", is_active=False)
    db.add(model)
    db.flush()
    prediction = DevelopmentCurrentTermPrediction(student_id=recipient.student_id,
        class_id=data["class_"].class_id, subject_id=data["subject"].subject_id,
        source_period_id=data["period"].academic_period_id, target_period_id=data["period"].academic_period_id,
        model_version_id=model.model_version_id, revision=1, predicted_period_grade=Decimal("80"),
        intervention_level="NEEDS_MONITORING", intervention_basis="synthetic fixture", evidence_snapshot={})
    db.add(prediction)
    db.flush()
    intervention = Intervention(student_id=recipient.student_id, class_id=data["class_"].class_id,
        subject_id=data["subject"].subject_id, academic_period_id=data["period"].academic_period_id,
        source_prediction_id=prediction.prediction_id, diagnosis_snapshot={})
    db.add(intervention)
    db.flush()
    item = add_assignment(db, data, key, due_date=due_date)
    item.recipient_student_id = recipient.student_id
    item.source_intervention_id = intervention.intervention_id
    item.remediation_request_id = uuid.uuid4()
    db.flush()
    return item


def test_phase_four_latest_retake_keeps_unique_completion_and_latest_review(db, data):
    """Mocked-behavior: no duplicate row inflation or highest-score fallback."""
    item = data["assignments"]["main_graded"]
    latest = add_submission(db, data, "retake", item, data["students"]["active_one"], status="submitted")
    latest.submitted_at = NOW - timedelta(seconds=1)
    result = dashboard(db, data)
    assert result["engagement"]["expected_count"] == 4 and result["engagement"]["completed_count"] == 3
    assert result["kpis"]["overall_completion_rate"] == 75.0 and result["kpis"]["ungraded_count"] == 2
    assert result["trend_chart"]["points"][0]["avg_score_percent"] == 91.0
    assert result["trend_chart"]["points"][0]["scored_count"] == 1
    assert {row["submission_id"] for row in result["action_queue"]["pending_grading"]} == {
        latest.submission_id, data["submissions"]["pending_active"].submission_id,
    }
    assert result["action_queue"]["upcoming_deadlines"][0]["submitted_count"] == 2
    assert result["phase_two"]["weekdays"]["total_count"] == 3


def test_phase_four_targeted_assignment_uses_one_eligible_student_everywhere(db, data):
    """Mocked-behavior: active but non-target rows excluded from every metric."""
    item = make_targeted_assignment(db, data, "target", data["students"]["active_one"], due_date=NOW)
    target = add_submission(db, data, "target", item, data["students"]["active_one"], status="graded", grade=Decimal("50"))
    add_submission(db, data, "not_target", item, data["students"]["active_two"], status="submitted")
    result = dashboard(db, data)
    assert result["engagement"]["expected_count"] == 5 and result["engagement"]["completed_count"] == 4
    assert result["kpis"]["overall_completion_rate"] == 80.0
    assert result["kpis"]["ungraded_count"] == 1
    deadline = next(row for row in result["action_queue"]["upcoming_deadlines"] if row["assignment_id"] == item.classwork_assignment_id)
    assert deadline["eligible_count"] == deadline["total_students"] == deadline["submitted_count"] == 1
    assert deadline["warnings"] == []
    assert result["phase_two"]["weekdays"]["total_count"] == result["phase_two"]["late_submissions"]["completed_count"] == 4
    point = result["trend_chart"]["points"][0]
    assert point["assignment_ids"] == [data["assignments"]["main_graded"].classwork_assignment_id, item.classwork_assignment_id]
    assert point["avg_score_percent"] == 80.7 and point["scored_count"] == 3
    assert point["eligible_count"] == point["submitted_count"] == 3
    assert target.submission_id not in {row["submission_id"] for row in result["action_queue"]["pending_grading"]}


def test_phase_four_outside_target_keeps_deadline_and_configuration_warning(db, data):
    """Mocked-behavior: no whole-class denominator for an invalid target."""
    item = make_targeted_assignment(db, data, "outside_target", data["students"]["withdrawn"], due_date=NOW)
    add_submission(db, data, "outside_target", item, data["students"]["withdrawn"])
    result = dashboard(db, data)
    assert result["engagement"]["expected_count"] == 4
    assert result["engagement"]["completed_count"] == 3
    deadline = next(row for row in result["action_queue"]["upcoming_deadlines"] if row["assignment_id"] == item.classwork_assignment_id)
    assert deadline["eligible_count"] == deadline["submitted_count"] == 0
    assert deadline["warnings"][0]["code"] == "targeted_recipient_outside_active_roster"
    assert any(warning["assignment_id"] == item.classwork_assignment_id for warning in result["engagement"]["warnings"])


@pytest.mark.parametrize("missing", [False, True])
def test_phase_four_ambiguous_attempts_flag_totals_and_keep_valid_review_rows(db, data, missing):
    """Mocked-behavior: ties/missing timestamps are not ID-resolved silently."""
    item = data["assignments"]["main_graded"]
    row = add_submission(db, data, "ambiguous", item, data["students"]["active_one"])
    row.submitted_at = None if missing else data["submissions"]["graded_one"].submitted_at
    result = dashboard(db, data)
    assert result["kpis"]["overall_completion_rate"] is result["kpis"]["ungraded_count"] is None
    assert result["section_matrix"][0]["completion_rate_percent"] is None
    assert result["trend_chart"]["points"][0]["avg_score_percent"] is None
    assert result["action_queue"]["upcoming_deadlines"][0]["submitted_count"] is None
    assert result["engagement"]["warnings"][0]["code"] == "ambiguous_submission_attempts"
    assert [row["submission_id"] for row in result["action_queue"]["pending_grading"]] == [data["submissions"]["pending_active"].submission_id]
    assert next(card for card in result["cards"] if card["title"] == "Submission Rate")["count"] == "—"


def test_phase_four_future_attempts_are_not_dashboard_evidence(db, data):
    """Mocked-behavior: future latest attempts cannot hide valid older work."""
    future = add_submission(db, data, "future", data["assignments"]["main_graded"], data["students"]["active_one"])
    future.submitted_at = NOW + timedelta(seconds=1)
    result = dashboard(db, data)
    assert result["engagement"]["completed_count"] == 3
    assert result["kpis"]["ungraded_count"] == 1
    assert result["trend_chart"]["points"][0]["avg_score_percent"] == 71.0
    assert result["phase_two"]["weekdays"]["total_count"] == 3


def test_phase_four_grouped_trend_preserves_three_scored_task_sufficiency(db, data):
    """Mocked-behavior: multiple same-day tasks make one real date point."""
    for index in range(2):
        item = add_assignment(db, data, f"same_day_{index}", due_date=data["assignments"]["main_graded"].due_date)
        add_submission(db, data, f"same_day_{index}", item, data["students"]["active_one"], status="graded", grade=Decimal("25"))
    result = dashboard(db, data)
    chart = result["trend_chart"]
    assert chart["has_sufficient_data"] is True and chart["graded_task_count"] == 3
    assert chart["date_group_count"] == len(chart["points"]) == 2
    point = chart["points"][0]
    assert point["date_key"] == "2026-10-08" and point["task_count"] == 3
    assert point["classwork_id"] is None and len(point["assignment_ids"]) == 3
    assert point["scored_count"] == 4 and point["eligible_count"] == 6
    assert point["avg_score_percent"] == 60.5 and point["completion_rate_percent"] == 66.7


def test_phase_four_engagement_query_count_does_not_grow_with_fixture_size(db, data, monkeypatch):
    """Mocked-behavior: actual SELECT counts, isolating existing gradebook calls."""
    from sqlalchemy import event
    monkeypatch.setattr(AnalyticsService, "read_dashboard_current_grades", lambda *_args: [])
    engine = db.get_bind()
    staff_id, period_id = data["teacher"].staff_id, data["period"].academic_period_id
    def measured():
        db.flush()
        db.expire_all()
        period = db.get(AcademicPeriod, period_id)
        statements = []
        def capture(_connection, _cursor, statement, _parameters, _context, _many):
            assert statement.lstrip().upper().startswith("SELECT")
            statements.append(statement)
        event.listen(engine, "before_cursor_execute", capture)
        try:
            AnalyticsService.build_teacher_dashboard_health(db, staff_id, period)
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        return statements
    small = measured()
    for index in range(8):
        learner = Student(student_id=uuid.uuid4(), student_lrn=f"{100 + index:012d}",
            first_name=f"Synthetic{index}", last_name="Learner", academic_level_id=data["class_"].academic_level_id)
        db.add(learner)
        db.flush()
        db.add(StudentClass(student_id=learner.student_id, class_id=data["class_"].class_id,
            academic_year_id=data["year"].academic_year_id, enrollment_status="enrolled"))
        item = add_assignment(db, data, f"larger_{index}", due_date=NOW)
        add_submission(db, data, f"larger_{index}", item, learner)
    # More classes/load combinations must not add metadata reads either.
    for index in range(2):
        cls = Class(section_name=f"Extra {index}", academic_year_id=data["year"].academic_year_id,
            academic_level_id=data["class_"].academic_level_id, class_status="active")
        db.add(cls)
        db.flush()
        db.add(SubjectLoad(staff_id=staff_id, class_id=cls.class_id, subject_id=data["subject"].subject_id,
            academic_period_id=period_id, status="published", is_active_version=True))
        add_assignment(db, data, f"extra_class_{index}", class_=cls, due_date=NOW)
    large = measured()
    assert len(small) > 0 and len(large) == len(small)
    print(f"Engagement SELECT count: small={len(small)}, large={len(large)} (gradebook calls isolated).")
    for statements in (small, large):
        name_reads = [sql for sql in statements if "student.first_name" in sql and "FROM student " in sql]
        assert len(name_reads) == 1
        assert all(column not in name_reads[0] for column in ("student_lrn", "email", "contact", "password"))


def seed_dashboard_lesson_data(db, data):
    """Synthetic mapped quiz for SQLite and opt-in PostgreSQL parity tests."""
    learner = Student(student_id=uuid.uuid4(), student_lrn="900000000003",
        first_name="Third", last_name="Synthetic", academic_level_id=data["class_"].academic_level_id)
    db.add(learner)
    db.flush()
    db.add(StudentClass(student_id=learner.student_id, class_id=data["class_"].class_id,
        academic_year_id=data["year"].academic_year_id, enrollment_status="enrolled"))
    lesson = Lesson(title="Actual quiz lesson", subject_id=data["subject"].subject_id,
        created_by_staff_id=data["teacher"].staff_id, competency_id=None)
    db.add(lesson)
    assignment = add_assignment(db, data, "lesson_quiz", due_date=NOW)
    assignment.classwork.classwork_type = "QUIZ"
    db.flush()
    quiz = Quiz(classwork_id=assignment.classwork_id, status="READY", total_items=4)
    db.add(quiz)
    db.flush()
    links = []
    for order, maximum in enumerate(("2.50", "7.50", "10.00", "5.00"), 1):
        question = Question(question_text=f"Private synthetic question {order}", question_type="SHORT_ANSWER",
            points=Decimal(maximum), lesson_id=lesson.lesson_id if order <= 3 else None)
        db.add(question)
        db.flush()
        link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=question.question_id, display_order=order)
        db.add(link)
        db.flush()
        links.append(link)
    learners = [data["students"]["active_one"], data["students"]["active_two"], learner]
    submissions = []
    for index, student in enumerate(learners):
        submission = add_submission(db, data, f"lesson_{index}", assignment, student,
            status="graded", grade=Decimal("15.75"))
        submissions.append(submission)
        db.add_all([QuizAnswer(submission_id=submission.submission_id, quiz_question_id=link.quiz_question_id,
            answer_text="Private synthetic answer", is_correct=None, points_awarded=Decimal(score))
            for link, score in zip(links, ("0", "3.75", "10", "2"))])
    db.commit()
    return {"assignment": assignment, "lesson": lesson, "links": links, "submissions": submissions, "learners": learners}


def test_phase_five_real_lesson_performance_and_private_response(db, data):
    """Mocked-behavior: actual SELECT integration, partial essays and zero scores."""
    import json
    seed_dashboard_lesson_data(db, data)
    result = dashboard(db, data)
    assert "topic_mastery" not in result["details"]
    payload = result["details"]["lesson_performance"]
    item = payload["subjects"][0]["items"][0]
    assert item["performance_percent"] == 68.8
    assert item["awarded_points"] == 41.25 and item["possible_points"] == 60
    assert (item["learner_count"], item["question_count"], item["scored_response_count"]) == (3, 3, 9)
    coverage = payload["subjects"][0]["coverage"]
    assert coverage["unmapped_response_count"] == 3
    assert coverage["ungraded_response_count"] == 0
    encoded = json.dumps(payload)
    for private in ("student_id", "student_name", "question_text", "answer_text", "Private synthetic", "Synthetic"):
        assert private not in encoded


def test_phase_five_unmapped_seed_style_quiz_returns_real_empty_state(db, data):
    """Mocked-behavior: awarded points without lesson links never invent topics."""
    fixture = seed_dashboard_lesson_data(db, data)
    for link in fixture["links"]:
        link.question.lesson_id = None
    result = dashboard(db, data)["details"]["lesson_performance"]["subjects"][0]
    assert result["items"] == []
    assert result["coverage"]["unmapped_response_count"] == 12
    assert result["coverage"]["scored_mapped_response_count"] == 0


def test_phase_five_latest_attempt_selected_before_answers_and_no_older_score_fallback(db, data):
    """Mocked-behavior: latest completed attempt may be only partially scored."""
    fixture = seed_dashboard_lesson_data(db, data)
    latest = add_submission(db, data, "latest_lesson", fixture["assignment"], fixture["learners"][0])
    latest.submitted_at = NOW - timedelta(minutes=1)
    db.add(QuizAnswer(submission_id=latest.submission_id, quiz_question_id=fixture["links"][0].quiz_question_id,
        answer_text="Unscored retake", points_awarded=None))
    result = dashboard(db, data)["details"]["lesson_performance"]["subjects"][0]
    assert result["items"] == []
    assert result["coverage"]["scored_mapped_response_count"] == 6
    assert result["coverage"]["ungraded_response_count"] == 3
    assert result["coverage"]["insufficient_lesson_count"] == 1


@pytest.mark.parametrize("scope", ["teacher", "period", "withdrawn", "targeted", "future", "ambiguous", "pending"])
def test_phase_five_teacher_period_recipient_and_attempt_isolation(db, data, scope):
    """Mocked-behavior: reuse authoritative scope/recipient/attempt policies."""
    fixture = seed_dashboard_lesson_data(db, data)
    if scope == "teacher":
        fixture["assignment"].assigned_by_staff_id = data["other_teacher"].staff_id
        fixture["assignment"].classwork.created_by_staff_id = data["other_teacher"].staff_id
    elif scope == "period":
        fixture["assignment"].academic_period_id = data["previous_period"].academic_period_id
    elif scope == "withdrawn":
        db.query(StudentClass).filter(StudentClass.student_id == fixture["learners"][0].student_id).one().enrollment_status = "withdrawn"
    elif scope == "targeted":
        # The real targeted pair check needs a real intervention. Reuse the
        # existing fixture helper used by Phase 4, not a relaxed DB constraint.
        target = make_targeted_assignment(db, data, "lesson_target", fixture["learners"][0], due_date=NOW)
        fixture["assignment"].recipient_student_id = target.recipient_student_id
        fixture["assignment"].source_intervention_id = target.source_intervention_id
        fixture["assignment"].remediation_request_id = uuid.uuid4()
    elif scope == "future":
        fixture["submissions"][0].submitted_at = NOW + timedelta(seconds=1)
    elif scope == "ambiguous":
        add_submission(db, data, "tied_lesson", fixture["assignment"], fixture["learners"][0])
    else:
        fixture["submissions"][0].status = "pending"
        fixture["submissions"][0].submitted_at = None
    result = dashboard(db, data)["details"]["lesson_performance"]["subjects"][0]
    assert result["items"] == []
    assert result["coverage"]["scored_mapped_response_count"] == (
        0 if scope in {"teacher", "period"} else 3 if scope == "targeted" else 6)
    if scope == "ambiguous":
        assert any(w["code"] == "ambiguous_submission_attempts" for w in result["warnings"])


def test_phase_five_empty_period_has_no_fabricated_subjects(db, data):
    """Mocked-behavior: subject list comes from selected-period assigned loads."""
    assert dashboard(db, data, period=data["empty_period"])["details"]["lesson_performance"]["subjects"] == []


def test_phase_five_two_bulk_selects_constant_and_columns_are_private(db, data):
    """Mocked-behavior: two actual SELECTs regardless of learners/questions."""
    from sqlalchemy import event
    from sqlalchemy.orm import joinedload
    from app.services.activity import TeacherDashboardMetrics as metrics
    fixture = seed_dashboard_lesson_data(db, data)
    def measured():
        db.flush()
        assignments = db.query(ClassworkAssignment).options(joinedload(ClassworkAssignment.classwork)).filter(
            ClassworkAssignment.classwork_assignment_id == fixture["assignment"].classwork_assignment_id).all()
        learners = {row.student_id for row in db.query(StudentClass).filter(
            StudentClass.class_id == data["class_"].class_id, StudentClass.enrollment_status == "enrolled").all()}
        submissions = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == fixture["assignment"].classwork_assignment_id).all()
        snapshot = metrics.build_dashboard_engagement({a.classwork_assignment_id: a for a in assignments},
            {data["class_"].class_id: learners}, submissions, NOW)
        subjects = {data["subject"].subject_id: (data["subject"].subject_name, (data["class_"].class_id,))}
        statements = []
        def capture(_connection, _cursor, statement, _parameters, _context, _many):
            assert statement.lstrip().upper().startswith("SELECT")
            statements.append(statement)
        event.listen(db.get_bind(), "before_cursor_execute", capture)
        try:
            evidence = metrics.read_dashboard_lesson_evidence(db, snapshot, subjects=subjects)
            metrics.summarize_dashboard_lesson_performance(evidence)
        finally:
            event.remove(db.get_bind(), "before_cursor_execute", capture)
        assert len(statements) == 2
        for statement in statements:
            columns = statement.split("FROM", 1)[0].lower()
            assert all(private not in columns for private in (
                "student_id", "student_lrn", "first_name", "last_name", "question_text", "answer_text", "email", "password"))
        return len(statements)
    small = measured()
    for index in range(8):
        learner = Student(student_id=uuid.uuid4(), student_lrn=f"{910000000000 + index:012d}",
            first_name="Synthetic", last_name="Larger", academic_level_id=data["class_"].academic_level_id)
        db.add(learner)
        db.flush()
        db.add(StudentClass(student_id=learner.student_id, class_id=data["class_"].class_id,
            academic_year_id=data["year"].academic_year_id, enrollment_status="enrolled"))
        submission = add_submission(db, data, f"larger_lesson_{index}", fixture["assignment"], learner, status="graded")
        db.add_all([QuizAnswer(submission_id=submission.submission_id, quiz_question_id=link.quiz_question_id,
            points_awarded=Decimal(0)) for link in fixture["links"]])
    question = Question(question_text="More private evidence", question_type="SHORT_ANSWER",
        points=Decimal(1), lesson_id=fixture["lesson"].lesson_id)
    db.add(question)
    db.flush()
    db.add(QuizQuestion(quiz_id=fixture["links"][0].quiz_id, question_id=question.question_id, display_order=5))
    large = measured()
    assert small == large == 2
    print(f"Lesson evidence SELECT count: small={small}, large={large}.")


def test_phase_five_entire_dashboard_never_writes_even_with_dirty_session(db, data, monkeypatch):
    """Mocked-behavior: no DML, flush or commit anywhere in the production path."""
    from sqlalchemy import event
    fixture = seed_dashboard_lesson_data(db, data)
    staff_id, period = data["teacher"].staff_id, data["period"]
    fixture["lesson"].title = "Dirty title must not persist"
    def reject_write(*_args, **_kwargs):
        raise AssertionError("Dashboard attempted to persist a change")
    for method in ("add", "add_all", "delete", "flush", "commit"):
        monkeypatch.setattr(db, method, reject_write)
    def select_only(_connection, _cursor, statement, _parameters, _context, _many):
        assert statement.lstrip().upper().startswith("SELECT")
    event.listen(db.get_bind(), "before_cursor_execute", select_only)
    try:
        result = AnalyticsService.build_teacher_dashboard_health(db, staff_id, period)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", select_only)
    assert result["details"]["lesson_performance"]["subjects"][0]["items"][0]["title"] == "Actual quiz lesson"
    assert fixture["lesson"] in db.dirty


def test_phase_five_bulk_reader_accepts_ready_and_published_but_not_draft_or_archived_quizzes(db, data):
    """Mocked-behavior: honor quiz attempt states within published assignments."""
    fixture = seed_dashboard_lesson_data(db, data)
    quiz = fixture["links"][0].quiz
    for state, count in [("READY", 1), ("PUBLISHED", 1), ("DRAFT", 0), ("ARCHIVED", 0)]:
        quiz.status = state
        result = dashboard(db, data)["details"]["lesson_performance"]["subjects"][0]
        assert len(result["items"]) == count


def test_phase_five_lesson_data_not_tied_to_trend_filter_and_subjects_are_real(db, data):
    """An unauthorized explicit filter cannot expose pooled lesson analytics."""
    seed_dashboard_lesson_data(db, data)
    first = dashboard(db, data)["details"]["lesson_performance"]
    with pytest.raises(HTTPException) as error:
        dashboard(db, data, class_id=99999, subject_id=99999)
    assert error.value.status_code == 403
    assert [(s["subject_id"], s["class_ids"]) for s in first["subjects"]] == [
        (data["subject"].subject_id, [data["class_"].class_id])]

@pytest.mark.parametrize('scope', ['class', 'subject', 'combination'])
def test_dashboard_scope_limits_all_analytics_and_keeps_authorized_options(db, data, scope):
    db.add(SubjectLoad(
        staff_id=data['teacher'].staff_id, class_id=data['other_class'].class_id,
        subject_id=data['other_subject'].subject_id,
        academic_period_id=data['period'].academic_period_id,
        status='published', is_active_version=True,
    ))
    db.flush()
    baseline = dashboard(db, data)
    params = {}
    if scope in ('class', 'combination'):
        params['dashboard_class_id'] = data['class_'].class_id
    if scope in ('subject', 'combination'):
        params['dashboard_subject_id'] = data['subject'].subject_id
    scoped = dashboard(db, data, **params)
    assert baseline['kpis']['active_classes'] == 2
    assert scoped['kpis']['active_classes'] == 1
    assert scoped['kpis']['enrolled_students'] == 2
    assert len(scoped['dashboard_filters']) == 2
    assert all(item['class_id'] == data['class_'].class_id for item in scoped['section_matrix'])
    assert all(item['subject_id'] == data['subject'].subject_id for item in scoped['section_matrix'])
    assert scoped['kpis']['ungraded_count'] == 1
    assert scoped['trend_chart']['selected_subject_id'] == data['subject'].subject_id
    assert all(item['class_id'] == data['class_'].class_id for item in scoped['details']['attendance_by_section'])


@pytest.mark.parametrize('scope', ['class', 'subject', 'combination'])
def test_dashboard_scope_cannot_include_unhandled_loads(db, data, scope):
    params = {}
    if scope in ('class', 'combination'):
        params['dashboard_class_id'] = data['other_class'].class_id
    if scope in ('subject', 'combination'):
        params['dashboard_subject_id'] = data['other_subject'].subject_id
    result = dashboard(db, data, **params)
    assert result['kpis']['active_classes'] == 0
    assert result['kpis']['enrolled_students'] == 0
    assert result['section_matrix'] == []
    assert result['action_queue']['pending_grading'] == []
    assert result['action_queue']['upcoming_deadlines'] == []
    assert result['trend_chart']['points'] == []
    assert len(result['dashboard_filters']) == 1

def test_dashboard_scope_route_preserves_teacher_authorization(db, data):
    client = create_client(db, {'sub': str(data['teacher'].user_id), 'role': 'teacher'})
    response = client.get('/analytics/teacher/dashboard-health', params={
        'academic_period_id': data['period'].academic_period_id,
        'dashboard_class_id': data['other_class'].class_id,
        'dashboard_subject_id': data['other_subject'].subject_id,
        'staff_id': data['other_teacher'].staff_id,
    })
    assert response.status_code == 200
    assert response.json()['kpis']['active_classes'] == 0
    assert response.json()['action_queue']['pending_grading'] == []
    assert client.get('/analytics/teacher/dashboard-health', params={'dashboard_class_id': 0}).status_code == 422


def test_reading_materials_and_manual_activities_never_enter_submission_rate_or_review_queue(db, data):
    """Regression: Reading Materials (even marked done) and manual offline activities are excluded from Submission Rate and Submissions to Review, while upcoming Reading Material deadlines remain in Upcoming Deadlines."""
    reading = add_assignment(db, data, "reading_material", due_date=NOW + timedelta(hours=2))
    reading.classwork.classwork_type = "READING"
    reading.classwork.is_graded = False
    reading.classwork.total_points = None
    # Simulate SubmissionService.complete_reading_assignment creating status='submitted', grade=None
    add_submission(db, data, "reading_done_one", reading, data["students"]["active_one"], status="submitted", grade=None)
    add_submission(db, data, "reading_done_two", reading, data["students"]["active_two"], status="submitted", grade=None)

    manual_act = add_assignment(db, data, "manual_offline_activity")
    manual_act.classwork.classwork_type = "ACTIVITY"
    manual_act.classwork.activity_mode = "MANUAL"
    manual_act.classwork.is_graded = True
    add_submission(db, data, "manual_unscored", manual_act, data["students"]["active_one"], status="submitted", grade=None)

    practice_only = make_targeted_assignment(db, data, "practice_only_intervention", data["students"]["active_one"])
    practice_only.classwork.classwork_type = "QUIZ"
    practice_only.classwork.is_graded = False
    add_submission(db, data, "practice_sub", practice_only, data["students"]["active_one"], status="submitted", grade=None)

    db.flush()
    result = dashboard(db, data)

    # Baseline fixture has 2 eligible assignments (main_graded, main_pending) x 2 students = 4 expected, 3 completed (75.0%), 1 ungraded
    assert result["engagement"]["expected_count"] == 4
    assert result["engagement"]["completed_count"] == 3
    assert result["kpis"]["overall_completion_rate"] == 75.0
    assert result["kpis"]["ungraded_count"] == 1
    assert [item["submission_id"] for item in result["action_queue"]["pending_grading"]] == [
        data["submissions"]["pending_active"].submission_id,
    ]
    # Reading Material with an upcoming due_date still appears in upcoming_deadlines
    reading_deadline = next(
        item for item in result["action_queue"]["upcoming_deadlines"]
        if item["assignment_id"] == reading.classwork_assignment_id
    )
    assert reading_deadline["classwork_id"] == reading.classwork_id
    assert reading_deadline["total_students"] == 2
    assert reading_deadline["submitted_count"] == 2
    cards = {c["title"]: c for c in result["cards"]}
    assert cards["Submission Rate"]["count"] == "75%"
    assert cards["Submission Rate"]["stat"] == "3 of 4 submitted"


def test_auto_graded_and_manual_review_quizzes_in_submission_rate_and_submissions_to_review(db, data):
    """Regression: auto-graded quizzes count in Submission Rate but not Submissions to Review; quizzes awaiting manual grading appear in both."""
    auto_quiz = make_targeted_assignment(db, data, "auto_graded_quiz", data["students"]["active_one"])
    auto_quiz.classwork.classwork_type = "QUIZ"
    auto_quiz.classwork.is_graded = True
    auto_sub = add_submission(
        db, data, "auto_quiz_sub", auto_quiz, data["students"]["active_one"],
        status="graded", grade=Decimal("45.00"),
    )
    auto_sub.graded_at = NOW

    manual_quiz = make_targeted_assignment(db, data, "manual_essay_quiz", data["students"]["active_two"])
    manual_quiz.classwork.classwork_type = "QUIZ"
    manual_quiz.classwork.is_graded = True
    # QuizAttemptService sets status='submitted', graded_at=None, grade=<partial auto points> when manual questions exist
    manual_quiz_sub = add_submission(
        db, data, "manual_quiz_sub", manual_quiz, data["students"]["active_two"],
        status="submitted", grade=Decimal("20.00"),
    )
    manual_quiz_sub.graded_at = None
    db.flush()

    result = dashboard(db, data)
    # 4 baseline + 1 auto_quiz + 1 manual_quiz = 6 expected; 3 baseline + 2 quizzes = 5 completed
    assert result["engagement"]["expected_count"] == 6
    assert result["engagement"]["completed_count"] == 5
    assert result["kpis"]["overall_completion_rate"] == 83.3
    # Pending grading includes baseline pending_active AND manual_quiz_sub, but NOT auto_quiz_sub
    pending_ids = {item["submission_id"] for item in result["action_queue"]["pending_grading"]}
    assert manual_quiz_sub.submission_id in pending_ids
    assert auto_sub.submission_id not in pending_ids
    assert result["kpis"]["ungraded_count"] == 2

    # Once teacher finishes grading the manual quiz question, it leaves Submissions to Review
    manual_quiz_sub.status = "graded"
    manual_quiz_sub.grade = Decimal("40.00")
    manual_quiz_sub.graded_at = NOW
    db.flush()
    after_grading = dashboard(db, data)
    assert after_grading["kpis"]["ungraded_count"] == 1
    assert manual_quiz_sub.submission_id not in {
        item["submission_id"] for item in after_grading["action_queue"]["pending_grading"]
    }
