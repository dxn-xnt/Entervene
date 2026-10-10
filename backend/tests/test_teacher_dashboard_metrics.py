"""Dashboard-only policy units and mocked gradebook behavior; no live calls."""

from contextlib import nullcontext
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.schemas.TeacherDashboard import DashboardGrade
from app.services.activity import TeacherDashboardMetrics as metrics


def subject(threshold, *, subject_id=1, group_id=2):
    return SimpleNamespace(
        subject_id=subject_id,
        subject_group_id=group_id,
        subject_group_rel=SimpleNamespace(
            subject_group_id=group_id, passing_threshold=threshold,
        ),
    )


def grade(value, *, subject_id=1, student_id="learner", class_id=1):
    return DashboardGrade(
        student_id=student_id, class_id=class_id, subject_id=subject_id,
        academic_period_id=1, current_grade=value,
    )


@pytest.mark.parametrize("threshold", [Decimal("75"), Decimal("83"), Decimal("85"), Decimal("83.25"), Decimal("0"), Decimal("100")])
def test_threshold_is_read_from_group_without_a_constant_default(threshold):
    """Unit: runtime group values, including policy and range boundaries."""
    result = metrics.resolve_dashboard_passing_threshold(subject(threshold))
    assert result.passing_threshold == float(threshold)
    assert result.warning is None


@pytest.mark.parametrize("value", [None, True, False, "83", Decimal("NaN"), Decimal("Infinity"), Decimal("-0.01"), Decimal("100.01")])
def test_invalid_threshold_is_unavailable_with_configuration_warning(value):
    """Unit: invalid values never silently fall back."""
    result = metrics.resolve_dashboard_passing_threshold(subject(value))
    assert result.passing_threshold is None
    assert result.warning.code == "invalid_passing_threshold"
    assert result.warning.message == metrics.PASSING_CONFIGURATION_WARNING


@pytest.mark.parametrize("kind", ["no_group", "no_foreign_key", "different_group", "boolean_id"])
def test_missing_or_mismatched_group_is_unavailable(kind):
    """Unit: relationship identity is required, not just a plausible number."""
    item = subject(Decimal("83"))
    if kind == "no_group":
        item.subject_group_rel = None
    elif kind == "no_foreign_key":
        item.subject_group_id = None
    elif kind == "different_group":
        item.subject_group_rel.subject_group_id = 3
    else:
        item.subject_group_id = item.subject_group_rel.subject_group_id = True
    result = metrics.resolve_dashboard_passing_threshold(item)
    assert result.passing_threshold is None
    assert result.warning is not None


@pytest.mark.parametrize("threshold", [Decimal("75"), Decimal("83"), Decimal("85"), Decimal("83.25")])
@pytest.mark.parametrize("offset,passed", [(Decimal("-0.01"), False), (Decimal("0"), True), (Decimal("0.01"), True)])
def test_passing_boundaries_are_derived_from_parameterized_threshold(threshold, offset, passed):
    """Unit: compare precise values before rounding display grades."""
    result = metrics.summarize_dashboard_grades(
        [grade(float(threshold + offset))],
        {1: metrics.resolve_dashboard_passing_threshold(subject(threshold))},
    )
    assert result.passing_count == int(passed)
    assert result.passing_rate_percent == (100.0 if passed else 0.0)
    assert result.current_grade_meets_threshold is passed


def test_threshold_changes_are_picked_up_on_the_next_resolution():
    """Unit: no process-global threshold cache."""
    item = subject(Decimal("85"))
    before = metrics.resolve_dashboard_passing_threshold(item)
    item.subject_group_rel.passing_threshold = Decimal("75")
    after = metrics.resolve_dashboard_passing_threshold(item)
    assert before.passing_threshold == 85.0
    assert after.passing_threshold == 75.0


def test_mixed_groups_compare_each_student_subject_individually_and_stay_neutral():
    """Unit: same learner can pass one subject and not another."""
    result = metrics.summarize_dashboard_grades(
        [grade(84, subject_id=1), grade(84, subject_id=2)],
        {1: metrics.resolve_dashboard_passing_threshold(subject(Decimal("85"))),
         2: metrics.resolve_dashboard_passing_threshold(subject(Decimal("83"), subject_id=2))},
    )
    assert result.total_grade_count == result.available_grade_count == 2
    assert result.current_grade == 84.0
    assert result.passing_count == 1
    assert result.passing_rate_percent == 50.0
    assert result.passing_threshold is None
    assert result.current_grade_meets_threshold is None


def test_missing_threshold_makes_whole_passing_metric_unavailable_not_partial():
    """Unit: a configuration failure never produces a complete-looking rate."""
    result = metrics.summarize_dashboard_grades(
        [grade(90, subject_id=1), grade(80, subject_id=2)],
        {1: metrics.resolve_dashboard_passing_threshold(subject(Decimal("85")))},
    )
    assert result.current_grade == 85.0
    assert result.available_grade_count == 2
    assert result.passing_rate_percent is None
    assert result.passing_count is None
    assert [warning.subject_id for warning in result.warnings] == [2]


def test_ungraded_students_are_coverage_not_zero_or_failed_grades():
    """Unit: preserve no-score null and disclose denominator coverage."""
    result = metrics.summarize_dashboard_grades(
        [grade(90), grade(None, student_id="ungraded")],
        {1: metrics.resolve_dashboard_passing_threshold(subject(Decimal("85")))},
    )
    assert result.current_grade == 90.0
    assert result.passing_rate_percent == 100.0
    assert result.available_grade_count == 1
    assert result.total_grade_count == 2


def test_empty_grades_are_unavailable_not_demo_metrics():
    """Unit: a real empty scope remains empty."""
    result = metrics.summarize_dashboard_grades([], {})
    assert result.current_grade is None
    assert result.passing_rate_percent is None
    assert result.total_grade_count == result.available_grade_count == 0
    assert result.warnings == []


def test_gradebook_is_called_once_per_unique_scope_not_per_student(monkeypatch):
    """Mocked-behavior: query-count bound is one gradebook call per tuple."""
    db = MagicMock()
    db.no_autoflush = nullcontext()
    provider = MagicMock(return_value=SimpleNamespace(studentGrades=[
        SimpleNamespace(student_id="learner", transmuted_grade=84, total="99"),
        SimpleNamespace(student_id="ungraded", transmuted_grade=None, total="70"),
    ]))
    monkeypatch.setattr(metrics, "teacher_student_gradebook", provider)
    scopes = [metrics.DashboardScope(1, 1, 1), metrics.DashboardScope(1, 1, 1),
              metrics.DashboardScope(2, 1, 1), metrics.DashboardScope(1, 2, 1)]
    result = metrics.read_dashboard_current_grades(db, "teacher", scopes)
    assert provider.call_count == 3
    assert len(result) == 6
    assert [row.current_grade for row in result] == [84, None, 84, None, 84, None]
    provider.assert_any_call(db, "teacher", 1, 1, 1)
    db.add.assert_not_called()
    db.delete.assert_not_called()
    db.flush.assert_not_called()
    db.commit.assert_not_called()


def test_gradebook_cache_is_request_local_and_active_roster_is_respected(monkeypatch):
    """Mocked-behavior: inactive learners are excluded, not cached across calls."""
    db = MagicMock()
    db.no_autoflush = nullcontext()
    provider = MagicMock(return_value=SimpleNamespace(studentGrades=[
        SimpleNamespace(student_id="active", transmuted_grade=83),
        SimpleNamespace(student_id="inactive", transmuted_grade=99),
    ]))
    monkeypatch.setattr(metrics, "teacher_student_gradebook", provider)
    scope = metrics.DashboardScope(1, 1, 1, frozenset({"active", "roster-only"}))
    first = metrics.read_dashboard_current_grades(db, "teacher", [scope])
    second = metrics.read_dashboard_current_grades(db, "teacher", [scope])
    assert provider.call_count == 2
    assert [row.student_id for row in first] == ["active", "roster-only"]
    assert [row.current_grade for row in first] == [83, None]
    assert second == first


def test_shared_subject_authorization_failure_is_unavailable_not_other_teacher_data(monkeypatch):
    """Mocked-behavior: fail closed if existing gradebook authorization is ambiguous."""
    db = MagicMock()
    db.no_autoflush = nullcontext()
    provider = MagicMock(side_effect=HTTPException(403, "private internal details"))
    monkeypatch.setattr(metrics, "teacher_student_gradebook", provider)
    scope = metrics.DashboardScope(1, 1, 1, frozenset({"active"}))
    grades = metrics.read_dashboard_current_grades(db, "teacher", [scope, scope])
    result = metrics.summarize_dashboard_grades(
        grades, {1: metrics.resolve_dashboard_passing_threshold(subject(Decimal("85")))},
    )
    assert provider.call_count == 1
    assert result.current_grade is None
    assert result.passing_rate_percent is None
    assert result.available_grade_count == 0
    assert result.total_grade_count == 1
    assert [warning.code for warning in result.warnings] == ["grade_scope_unavailable"]
    assert "private" not in result.model_dump_json()


def test_unexpected_gradebook_errors_are_not_swallowed(monkeypatch):
    """Mocked-behavior: unexpected errors remain visible, not fake empty grades."""
    db = MagicMock()
    db.no_autoflush = nullcontext()
    monkeypatch.setattr(metrics, "teacher_student_gradebook", MagicMock(side_effect=RuntimeError("test failure")))
    with pytest.raises(RuntimeError, match="test failure"):
        metrics.read_dashboard_current_grades(db, "teacher", [metrics.DashboardScope(1, 1, 1)])


@pytest.fixture
def dashboard_sample(monkeypatch):
    """Mocked-behavior fixture: isolated in-memory SQLite, no external database."""
    import app.models  # noqa: F401
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from app.db.Base import Base
    from app.services.activity import AnalyticsService
    from test_teacher_dashboard_health import NOW, seed_dashboard_data

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: NOW)
    try:
        yield db, seed_dashboard_data(db)
    finally:
        db.rollback()
        db.close()
        engine.dispose()


def test_actual_gradebook_uses_term_grade_and_matches_class_record_calculation(dashboard_sample):
    """Mocked-behavior: actual read-only calculation, not a replacement formula."""
    db, data = dashboard_sample
    scope = metrics.DashboardScope(data["class_"].class_id, data["subject"].subject_id, data["period"].academic_period_id)
    authoritative = metrics.teacher_student_gradebook(db, data["teacher"].staff_id, scope.class_id, scope.subject_id, scope.academic_period_id)
    dashboard_grades = metrics.read_dashboard_current_grades(db, data["teacher"].staff_id, [scope])
    assert {row.student_id: row.current_grade for row in dashboard_grades} == {
        row.student_id: row.transmuted_grade for row in authoritative.studentGrades
    }


def test_real_select_count_is_unchanged_for_duplicate_gradebook_scopes(dashboard_sample):
    """Mocked-behavior: duplicate scopes do not repeat the gradebook's SELECTs."""
    from sqlalchemy import event

    db, data = dashboard_sample
    staff_id = data["teacher"].staff_id
    scope = metrics.DashboardScope(data["class_"].class_id, data["subject"].subject_id, data["period"].academic_period_id)
    statements = []
    def record_select(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)
    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", record_select)
    try:
        db.expire_all()
        metrics.read_dashboard_current_grades(db, staff_id, [scope])
        unique_count = len(statements)
        statements.clear()
        db.expire_all()
        metrics.read_dashboard_current_grades(db, staff_id, [scope] * 5)
        duplicate_count = len(statements)
    finally:
        event.remove(engine, "before_cursor_execute", record_select)
    assert unique_count > 0
    assert duplicate_count == unique_count


def test_whole_dashboard_is_read_only_even_with_a_dirty_session(dashboard_sample, monkeypatch):
    """Mocked-behavior: reject DML, explicit mutation and implicit autoflush."""
    from sqlalchemy import event
    from app.services.activity import AnalyticsService

    db, data = dashboard_sample
    staff_id = data["teacher"].staff_id
    period = data["period"]
    # This pending update must not cause autoflush during any dashboard query.
    data["assignments"]["main_graded"].classwork.title = "Unpersisted fixture title"
    assert db.dirty
    calls = []
    def forbidden(*_args, **_kwargs):
        pytest.fail("Dashboard attempted a write, flush or commit")
    def reject_dml(_connection, _cursor, statement, _parameters, _context, _many):
        calls.append(statement)
        assert statement.lstrip().upper().startswith("SELECT")
    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", reject_dml)
    event.listen(db, "before_flush", forbidden)
    try:
        with monkeypatch.context() as guard:
            for name in ("add", "add_all", "delete", "flush", "commit"):
                guard.setattr(db, name, forbidden)
            result = AnalyticsService.build_teacher_dashboard_health(db, staff_id, period)
        assert result["section_matrix"]
        assert calls
        assert db.dirty
    finally:
        event.remove(engine, "before_cursor_execute", reject_dml)
        event.remove(db, "before_flush", forbidden)


@pytest.mark.parametrize("status,expected", [("present", 100.0), ("late", 100.0), ("excused", 0.0), ("absent", 0.0)])
def test_attendance_rule_for_each_status(status, expected):
    """Unit: present and late count; excused and absent do not."""
    result = metrics.summarize_dashboard_attendance([SimpleNamespace(status=status)])
    assert result.rate == expected
    assert result.record_count == 1


def test_attendance_denominator_is_records_not_days_or_students():
    """Unit: advisory/subject records on the same day remain separate entries."""
    records = [SimpleNamespace(status=status, student_id="learner", date=date(2026, 10, 1))
               for status in ("present", "late", "excused", "absent")]
    result = metrics.summarize_dashboard_attendance(records)
    assert result.rate == 50.0
    assert result.record_count == 4
    assert result.present_count == result.late_count == result.excused_count == result.absent_count == 1


def test_no_attendance_records_is_unavailable_not_inferred_absence():
    """Unit: missing school days do not create denominator records."""
    result = metrics.summarize_dashboard_attendance([])
    assert result.rate is None
    assert result.record_count == 0


@pytest.mark.parametrize("now,month_start,today", [
    (datetime(2026, 9, 30, 15, 59, 59, tzinfo=timezone.utc), date(2026, 9, 1), date(2026, 9, 30)),
    (datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc), date(2026, 10, 1), date(2026, 10, 1)),
    (datetime(2026, 12, 31, 16, 0, tzinfo=timezone.utc), date(2027, 1, 1), date(2027, 1, 1)),
    (datetime(2028, 2, 28, 16, 0, tzinfo=timezone.utc), date(2028, 2, 1), date(2028, 2, 29)),
    (datetime(2026, 9, 30, 16, 0), date(2026, 10, 1), date(2026, 10, 1)),
])
def test_month_boundaries_and_manila_midnight(now, month_start, today):
    """Unit: dates use Manila, including naive legacy UTC and leap months."""
    window = metrics.dashboard_month_window(now, date(2020, 1, 1), date(2030, 1, 1))
    assert window.start_date == month_start
    assert window.end_date == window.today == today
    assert window.is_empty is False
    assert window.label == "This month"


@pytest.mark.parametrize("start,end,empty,expected_start,expected_end", [
    (date(2026, 10, 4), date(2026, 12, 1), False, date(2026, 10, 4), date(2026, 10, 8)),
    (date(2026, 8, 1), date(2026, 10, 5), False, date(2026, 10, 1), date(2026, 10, 5)),
    (date(2026, 8, 1), date(2026, 9, 30), True, date(2026, 10, 1), date(2026, 9, 30)),
    (date(2026, 11, 1), date(2026, 12, 1), True, date(2026, 11, 1), date(2026, 10, 8)),
])
def test_month_window_intersects_selected_period_inclusively(start, end, empty, expected_start, expected_end):
    """Unit: historical/future selected periods never borrow current records."""
    window = metrics.dashboard_month_window(datetime(2026, 10, 8, tzinfo=timezone.utc), start, end)
    assert window.start_date == expected_start
    assert window.end_date == expected_end
    assert window.is_empty is empty


def test_missing_threshold_warns_even_for_an_authorized_empty_roster():
    """Unit: missing configuration is not hidden by a currently empty roster."""
    result = metrics.summarize_dashboard_grades(
        [], {1: metrics.resolve_dashboard_passing_threshold(subject(None))},
    )
    assert result.current_grade is None
    assert result.passing_rate_percent is None
    assert [warning.code for warning in result.warnings] == ["invalid_passing_threshold"]


@pytest.mark.parametrize("offset,expected", [(-1, False), (0, False), (1, True)])
@pytest.mark.parametrize("naive", [False, True])
def test_submission_deadline_equality_and_legacy_naive_utc(offset, expected, naive):
    """Unit: one instant, not local-clock lexicographic comparison."""
    due = datetime(2026, 10, 8, 1, tzinfo=timezone.utc)
    submitted = due + timedelta(seconds=offset)
    if naive:
        submitted = submitted.replace(tzinfo=None)
    assert metrics.dashboard_submission_is_late(submitted, due) is expected


@pytest.mark.parametrize("submitted,due", [(None, datetime(2026, 10, 8)), (datetime(2026, 10, 8), None), (None, None)])
def test_missing_timestamps_are_not_silently_on_time(submitted, due):
    """Unit: missing evidence is explicitly unknown."""
    assert metrics.dashboard_submission_is_late(submitted, due) is None


def excuse(*, learner="learner", class_id=1, subject_id=999, on=date(2026, 10, 8), status="excused"):
    return SimpleNamespace(student_id=learner, class_id=class_id, subject_id=subject_id, date=on, status=status)


@pytest.mark.parametrize("changes,expected", [
    ({}, True), ({"learner": "other"}, False), ({"class_id": 2}, False),
    ({"on": date(2026, 10, 7)}, False), ({"status": "present"}, False),
    ({"status": "late"}, False), ({"status": "absent"}, False),
    ({"subject_id": 1234}, True),
])
def test_excuse_matches_only_student_class_and_manila_deadline_date_by_default(changes, expected):
    """Unit: subject matching remains OFF under the approved three-field rule."""
    due = datetime(2026, 10, 7, 16, tzinfo=timezone.utc)  # Oct 8 Manila, Oct 7 UTC.
    assert metrics.dashboard_excuse_covers_submission("learner", 1, 1, due, [excuse(**changes)]) is expected


@pytest.mark.parametrize("record_subject,expected", [(1, True), (None, True), (2, False)])
def test_optional_subject_matching_can_be_explicitly_enabled(record_subject, expected):
    """Unit: optional parameter tested, but production dashboard leaves it False."""
    due = datetime(2026, 10, 8, tzinfo=timezone.utc)
    assert metrics.dashboard_excuse_covers_submission(
        "learner", 1, 1, due, [excuse(subject_id=record_subject)], require_subject_match=True,
    ) is expected


def assignment(identifier=1, *, due=None, class_id=1, subject_id=1):
    return SimpleNamespace(classwork_assignment_id=identifier, class_id=class_id,
                           classwork=SimpleNamespace(subject_id=subject_id), due_date=due)


def submission(identifier=1, *, learner="learner", submitted=None, status="submitted"):
    return SimpleNamespace(classwork_assignment_id=identifier, student_id=learner,
                           submitted_at=submitted, status=status)


def test_excused_submissions_are_excluded_from_both_late_counts_but_not_weekdays():
    """Unit: exemptions are not lateness or denominator evidence, still completed."""
    due = datetime(2026, 10, 7, 16, tzinfo=timezone.utc)
    now = datetime(2026, 10, 8, 2, tzinfo=timezone.utc)
    works = {1: assignment(due=due)}
    rows = [submission(submitted=due + timedelta(hours=1)),
            submission(learner="on-time", submitted=due),
            submission(learner="late", submitted=due + timedelta(hours=1), status="graded")]
    late, weekdays = metrics.summarize_dashboard_submissions(
        works, rows, [excuse()], now, date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.completed_count == 3
    assert late.excused_excluded_count == 1
    assert late.eligible_count == 2
    assert late.late_count == 1
    assert late.late_rate_percent == 50.0
    assert weekdays.days[3].count == weekdays.total_count == 3
    assert late.warnings == weekdays.warnings == []


def test_previous_month_deadline_excuse_still_covers_current_period_submission():
    """Unit: excuse fetch/match must not be constrained to the chart's month."""
    due = datetime(2026, 9, 29, 16, tzinfo=timezone.utc)
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    late, weekdays = metrics.summarize_dashboard_submissions(
        {1: assignment(due=due)}, [submission(submitted=now)],
        [excuse(on=date(2026, 9, 30))], now, date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.excused_excluded_count == late.completed_count == 1
    assert late.eligible_count == late.late_count == 0
    assert late.late_rate_percent is None
    assert weekdays.total_count == 1


def test_weekdays_keep_six_rows_and_count_sunday_without_a_seventh_bar():
    """Unit: all actual submission dates use Manila and Sunday is separate."""
    monday = datetime(2026, 10, 4, 16, tzinfo=timezone.utc)  # Oct 5, Monday Manila.
    rows = [submission(learner=f"learner-{day}", submitted=monday + timedelta(days=day)) for day in range(7)]
    late, result = metrics.summarize_dashboard_submissions(
        {1: assignment(due=monday + timedelta(days=10))}, rows, [], monday + timedelta(days=7),
        date(2026, 10, 1), date(2026, 12, 31),
    )
    assert [day.label for day in result.days] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    assert [day.count for day in result.days] == [1] * 6
    assert result.sunday_count == 1
    assert result.total_count == 7
    assert late.late_rate_percent == 0.0


@pytest.mark.parametrize("timestamp,expected", [
    (datetime(2026, 9, 30, 15, 59, 59, tzinfo=timezone.utc), 0),
    (datetime(2026, 9, 30, 16, tzinfo=timezone.utc), 1),
    (datetime(2026, 10, 8, 1, tzinfo=timezone.utc), 1),
    (datetime(2026, 10, 8, 1, 0, 1, tzinfo=timezone.utc), 0),
])
def test_submission_period_and_now_boundaries_use_manila(timestamp, expected):
    """Unit: selected period starts inclusive and no future event is counted."""
    now = datetime(2026, 10, 8, 1, tzinfo=timezone.utc)
    late, weekdays = metrics.summarize_dashboard_submissions(
        {1: assignment(due=now)}, [submission(submitted=timestamp)], [], now,
        date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.completed_count == weekdays.total_count == expected


@pytest.mark.parametrize("status", ["pending", "missed", "draft"])
def test_incomplete_submission_statuses_are_not_actual_submissions(status):
    """Unit: counts are completed evidence, not future/pending assignment rows."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    late, weekdays = metrics.summarize_dashboard_submissions(
        {1: assignment(due=now)}, [submission(submitted=now, status=status)], [], now,
        date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.completed_count == weekdays.total_count == 0


def test_unique_latest_completed_attempt_is_authoritative():
    """Unit: do not count historical attempts twice."""
    old = submission(submitted=datetime(2026, 10, 7, tzinfo=timezone.utc))
    newest = submission(submitted=datetime(2026, 10, 8, tzinfo=timezone.utc))
    rows, warnings = metrics.select_dashboard_submissions([old, newest, newest])
    assert rows == [newest]
    assert warnings == []


@pytest.mark.parametrize("missing_timestamp", [False, True])
def test_ambiguous_duplicate_attempts_flag_instead_of_an_invented_authoritative_id(missing_timestamp):
    """Unit: tied/missing attempt timestamps cannot yield a complete-looking rate."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    rows = [submission(submitted=now), submission(submitted=None if missing_timestamp else now)]
    late, weekdays = metrics.summarize_dashboard_submissions(
        {1: assignment(due=now)}, rows, [], now, date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.late_rate_percent is None
    assert late.warnings[0].code == weekdays.warnings[0].code == "ambiguous_submission_attempts"


@pytest.mark.parametrize("missing_field,code", [("submitted", "missing_submission_timestamp"), ("due", "missing_deadline_timestamp")])
def test_missing_required_timestamp_makes_late_rate_unavailable(missing_field, code):
    """Unit: due-less work remains submitted but cannot define lateness."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    late, weekdays = metrics.summarize_dashboard_submissions(
        {1: assignment(due=None if missing_field == "due" else now)},
        [submission(submitted=None if missing_field == "submitted" else now)], [], now,
        date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.late_rate_percent is None
    assert [warning.code for warning in late.warnings] == [code]
    assert weekdays.total_count == (1 if missing_field == "due" else 0)


@pytest.mark.parametrize("today,expected_days,expected_percent", [
    (date(2026, 9, 30), 0, 0.0), (date(2026, 10, 1), 1, 10.0),
    (date(2026, 10, 5), 5, 50.0), (date(2026, 10, 10), 10, 100.0),
    (date(2026, 10, 11), 10, 100.0),
])
def test_term_progress_uses_inclusive_calendar_days_and_clamps(today, expected_days, expected_percent):
    """Unit: calendar progress, not a scheduled-school-day estimate."""
    result = metrics.dashboard_term_progress(date(2026, 10, 1), date(2026, 10, 10), today)
    assert result.elapsed_days == expected_days
    assert result.total_days == 10
    assert result.progress_percent == expected_percent
    assert result.total_weeks == 2


def test_invalid_period_dates_make_calendar_progress_unavailable():
    """Unit: malformed period boundaries do not become fabricated progress."""
    result = metrics.dashboard_term_progress(date(2026, 10, 10), date(2026, 10, 1), date(2026, 10, 5))
    assert result.progress_percent is None
    assert result.warnings[0].code == "invalid_period_dates"


@pytest.mark.parametrize("outside", [datetime(2026, 9, 30, tzinfo=timezone.utc), datetime(2026, 10, 9, tzinfo=timezone.utc)])
def test_known_out_of_window_duplicates_do_not_flag_selected_period(outside):
    """Unit: unrelated past/future attempts are filtered before ambiguity checks."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    late, weekdays = metrics.summarize_dashboard_submissions(
        {1: assignment(due=now)}, [submission(submitted=outside), submission(submitted=outside)],
        [], now, date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.completed_count == weekdays.total_count == 0
    assert late.warnings == weekdays.warnings == []


def test_latest_future_attempt_does_not_hide_a_known_submission_in_this_window():
    """Unit: consolidate this window's evidence, not a future event."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    late, weekdays = metrics.summarize_dashboard_submissions(
        {1: assignment(due=now)}, [submission(submitted=now), submission(submitted=now + timedelta(days=1))],
        [], now, date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.completed_count == weekdays.total_count == 1
    assert late.late_rate_percent == 0.0
    assert late.warnings == weekdays.warnings == []


def test_excused_unknown_timestamp_is_removed_before_lateness_availability_check():
    """Unit: exempt work is outside both late counts but still has weekday warning."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    late, weekdays = metrics.summarize_dashboard_submissions(
        {1: assignment(due=now)}, [submission(submitted=None), submission(learner="on-time", submitted=now)],
        [excuse()], now, date(2026, 10, 1), date(2026, 12, 31),
    )
    assert late.excused_excluded_count == 1
    assert late.eligible_count == 1
    assert late.late_rate_percent == 0.0
    assert late.warnings == []
    assert [warning.code for warning in weekdays.warnings] == ["missing_submission_timestamp"]


def test_performer_order_uses_grade_normalized_name_id_subject_and_class():
    """Unit: casefold/NFC ordering and all deterministic tie-breakers."""
    grades = [
        grade(90, student_id="b", class_id=2),
        grade(90, student_id="a", subject_id=2),
        grade(90, student_id="a", class_id=2),
        grade(90, student_id="a"),
        grade(90, student_id="z"),
        grade(99, student_id="top"),
    ]
    names = {"a": "Álpha, A.", "b": "A\u0301LPHA, A.", "z": "Ωmega, Z.", "top": "Zeta, Z."}
    expected = [("top", 1, 1), ("a", 1, 1), ("a", 1, 2), ("a", 2, 1), ("b", 1, 2), ("z", 1, 1)]
    for candidates in (grades, list(reversed(grades))):
        result = metrics.rank_dashboard_performers(candidates, names, {}, limit=6)
        assert [(row.student_id, row.subject_id, row.class_id) for row in result.items] == expected
        assert result.items[0].current_grade == 99
        assert result.items[-2].name == names["b"]


@pytest.mark.parametrize("values,omitted", [
    ([99, 98, 90, 90, 90, 80], 2), ([99, 98, 90], 0), ([99, 99, 98, 97], 0),
])
def test_performer_cutoff_ties_count_only_actually_omitted_entries(values, omitted):
    """Unit: top three are never expanded or padded because of ties."""
    rows = [grade(value, student_id=str(index)) for index, value in enumerate(values)]
    result = metrics.rank_dashboard_performers(rows, {row.student_id: "Same, Name" for row in rows}, {})
    assert len(result.items) == min(3, len(values))
    assert result.limit == 3
    assert result.cutoff_tie_omitted_count == omitted


@pytest.mark.parametrize("other_subject,other_class", [(2, 1), (1, 2)])
def test_performers_keep_each_subject_and_active_class_entry(other_subject, other_class):
    """Unit: same learner is retained in each subject or same-subject class."""
    rows = [grade(84.5), grade(92, subject_id=other_subject, class_id=other_class)]
    labels = {(1, 1): metrics.DashboardScopeLabel(section_name="Section A", subject_name="Subject A")}
    result = metrics.rank_dashboard_performers(rows, {"learner": "Student, Synthetic"}, labels)
    assert len(result.items) == 2
    assert result.items[0].current_grade == 92
    assert result.items[1].section_name == "Section A"
    assert result.items[1].subject_name == "Subject A"
    distribution = metrics.summarize_dashboard_grade_distribution(rows)
    assert distribution.available_grade_count == 2
    assert sum(item.count for item in distribution.bands) == 2


@pytest.mark.parametrize("name", [None, "", "   "])
def test_missing_name_keeps_valid_grade_and_adds_configuration_free_warning(name):
    """Unit: missing metadata never fabricates a person or removes a grade."""
    names = {} if name is None else {"learner": name}
    result = metrics.rank_dashboard_performers([grade(0)], names, {})
    assert len(result.items) == 1
    assert result.items[0].name == "Name unavailable"
    assert result.items[0].current_grade == 0
    assert [warning.code for warning in result.warnings] == ["student_name_unavailable"]


@pytest.mark.parametrize("values", [[], [None, None]])
def test_performers_and_bands_preserve_empty_and_all_unavailable_grades(values):
    """Unit: unknown grades are not zero or members of the lowest band."""
    rows = [grade(value, student_id=str(index)) for index, value in enumerate(values)]
    ranking = metrics.rank_dashboard_performers(rows, {}, {})
    distribution = metrics.summarize_dashboard_grade_distribution(rows)
    assert ranking.items == []
    assert ranking.cutoff_tie_omitted_count == 0
    assert ranking.warnings == []
    assert distribution.total_grade_count == distribution.unavailable_grade_count == len(values)
    assert distribution.available_grade_count == 0
    assert [item.count for item in distribution.bands] == [0] * 5


@pytest.mark.parametrize("value,band", [
    (Decimal("74.99"), "Below 75"), (Decimal("75"), "75-79"),
    (Decimal("79.99"), "75-79"), (Decimal("80"), "80-84"),
    (Decimal("84.5"), "80-84"), (Decimal("84.99"), "80-84"),
    (Decimal("85"), "85-89"), (Decimal("89.99"), "85-89"),
    (Decimal("90"), "90-100"), (Decimal("100"), "90-100"), (Decimal("0"), "Below 75"),
])
def test_grade_distribution_fractional_boundaries_before_display_rounding(value, band):
    """Unit: neutral intervals use underlying transmuted values."""
    distribution = metrics.summarize_dashboard_grade_distribution([grade(value), grade(None, student_id="missing")])
    assert [item.band for item in distribution.bands] == ["90-100", "85-89", "80-84", "75-79", "Below 75"]
    assert [item.band for item in distribution.bands if item.count] == [band]
    assert sum(item.count for item in distribution.bands) == distribution.available_grade_count == 1
    assert distribution.unavailable_grade_count == 1
    assert distribution.total_grade_count == 2
    assert all("variant" not in item.model_dump() for item in distribution.bands)


@pytest.mark.parametrize("size", [1, 2, 100])
def test_bulk_student_names_are_one_name_only_select_and_never_autoflush(dashboard_sample, monkeypatch, size):
    """Mocked-behavior: one query independent of list size, even when dirty."""
    from uuid import uuid4
    from sqlalchemy import event

    db, data = dashboard_sample
    learner = data["students"]["active_one"]
    learner_id = str(learner.student_id)
    learner.first_name = "Unpersisted name"
    assert db.dirty
    ids = [learner_id] + [str(uuid4()) for _ in range(size - 1)]
    statements = []
    def reject_writes(_connection, _cursor, statement, _parameters, _context, _many):
        assert statement.lstrip().upper().startswith("SELECT")
        statements.append(statement.lower())
    def forbidden(*_args, **_kwargs):
        pytest.fail("Name lookup attempted a write or autoflush")
    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", reject_writes)
    try:
        with monkeypatch.context() as guard:
            for method in ("add", "add_all", "delete", "flush", "commit"):
                guard.setattr(db, method, forbidden)
            result = metrics.read_dashboard_student_names(db, ids)
        assert result[learner_id] == "Student, active_one"
        assert len(statements) == 1
        projection = statements[0].split("from")[0]
        for column in ("student_id", "first_name", "middle_name", "last_name", "suffix"):
            assert "student." + column in projection
        for column in ("student_lrn", "email", "contact_number", "password", "user_id", "dob", "address"):
            assert column not in projection
        assert db.dirty
        statements.clear()
        assert metrics.read_dashboard_student_names(db, []) == {}
        assert statements == []
    finally:
        event.remove(engine, "before_cursor_execute", reject_writes)


def test_bulk_name_read_uses_class_record_display_format(dashboard_sample):
    """Mocked-behavior: family, suffix, first and middle initial match records."""
    db, data = dashboard_sample
    learner = data["students"]["active_one"]
    learner.first_name, learner.middle_name, learner.last_name, learner.suffix = "Alex", "Taylor", "Sample", "Jr."
    db.flush()
    assert metrics.read_dashboard_student_names(db, [str(learner.student_id)]) == {
        str(learner.student_id): "Sample Jr., Alex T.",
    }


def engagement_assignment(identifier=1, *, recipient=None, due=None, maximum=50):
    item = assignment(identifier, due=due)
    item.recipient_student_id = recipient
    item.classwork_id = identifier + 100
    item.publish_date = datetime(2026, 10, 1, tzinfo=timezone.utc)
    item.classwork.created_at = datetime(2026, 9, 30, tzinfo=timezone.utc)
    item.classwork.total_points = maximum
    return item


def engagement_row(identifier=1, *, learner="a", submitted=None, status="graded", score=25):
    row = submission(identifier, learner=learner, submitted=submitted, status=status)
    row.grade = score
    return row


@pytest.mark.parametrize("recipient,expected", [(None, {"a", "b"}), ("a", {"a"}), ("outside", set())])
def test_dashboard_assignment_eligibility_is_active_roster_intersection(recipient, expected):
    """Validator-unit: delegate targeting to the unchanged shared helper."""
    assert metrics.dashboard_assignment_student_ids(engagement_assignment(recipient=recipient), {"a", "b"}) == expected


def test_engagement_latest_completed_attempt_drives_all_cohort_metrics():
    """Unit: latest ungraded attempt replaces an older, higher graded score."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    old = engagement_row(submitted=now - timedelta(days=1), score=50)
    newest = engagement_row(submitted=now, status="late", score=None)
    snapshot = metrics.build_dashboard_engagement({1: engagement_assignment(due=now)}, {1: {"a", "b"}}, [old, newest], now)
    summary = metrics.summarize_dashboard_engagement(snapshot)
    assert snapshot.selected_by_assignment[1] == [newest]
    assert summary.expected_count == 2 and summary.completed_count == summary.pending_grading_count == 1
    assert summary.completion_rate_percent == 50.0
    assert summary.avg_score_percent is None and summary.scored_count == 0


@pytest.mark.parametrize("status", ["pending", "missed", "draft"])
def test_engagement_incomplete_attempt_does_not_replace_completed_attempt(status):
    """Unit: only completed attempts determine completion and performance."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    old = engagement_row(submitted=now - timedelta(days=1), score=25)
    unfinished = engagement_row(submitted=now, status=status, score=None)
    snapshot = metrics.build_dashboard_engagement({1: engagement_assignment()}, {1: {"a"}}, [old, unfinished], now)
    summary = metrics.summarize_dashboard_engagement(snapshot)
    assert snapshot.selected_by_assignment[1] == [old]
    assert summary.completed_count == 1 and summary.pending_grading_count == 0
    assert summary.avg_score_percent == 50.0


@pytest.mark.parametrize("missing", [True, False])
def test_engagement_ambiguous_attempts_make_totals_unavailable_but_keep_valid_rows(missing):
    """Unit: no invented ID or complete-looking partial completion/review total."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    rows = [engagement_row(submitted=now), engagement_row(submitted=None if missing else now),
            engagement_row(learner="b", submitted=now, status="submitted", score=None)]
    snapshot = metrics.build_dashboard_engagement({1: engagement_assignment()}, {1: {"a", "b"}}, rows, now)
    summary = metrics.summarize_dashboard_engagement(snapshot)
    assert summary.completed_count is summary.pending_grading_count is summary.completion_rate_percent is summary.avg_score_percent is None
    assert summary.resolved_completed_count == summary.resolved_pending_grading_count == 1
    assert summary.warnings[0].assignment_id == 1
    assert summary.warnings[0].code == "ambiguous_submission_attempts"


def test_engagement_filters_nonrecipients_outsiders_and_future_attempts_before_selection():
    """Unit: future or unauthorized evidence cannot inflate any dashboard metric."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    accepted = engagement_row(submitted=now)
    rows = [accepted, engagement_row(learner="b", submitted=now), engagement_row(learner="outside", submitted=now),
            engagement_row(submitted=now + timedelta(seconds=1), score=50)]
    snapshot = metrics.build_dashboard_engagement({1: engagement_assignment(recipient="a")}, {1: {"a", "b"}}, rows, now)
    assert snapshot.eligible_submissions == [accepted]
    assert snapshot.selected_by_assignment[1] == [accepted]
    assert metrics.summarize_dashboard_engagement(snapshot).completion_rate_percent == 100.0


def test_engagement_outside_target_is_zero_eligible_and_configuration_warning():
    """Unit: retain the assignment, never turn it into a classwide obligation."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    snapshot = metrics.build_dashboard_engagement({1: engagement_assignment(recipient="outside")}, {1: {"a"}}, [], now)
    summary = metrics.summarize_dashboard_engagement(snapshot)
    assert snapshot.assignments.keys() == {1}
    assert summary.expected_count == summary.completed_count == 0
    assert summary.completion_rate_percent is None
    assert summary.warnings[0].code == "targeted_recipient_outside_active_roster"


def test_engagement_assignment_cohort_can_differ_from_calendar_metrics():
    """Unit: completion after period end is real; dated metrics keep their window."""
    now = datetime(2027, 1, 2, tzinfo=timezone.utc)
    work = engagement_assignment(due=datetime(2026, 12, 30, tzinfo=timezone.utc))
    row = engagement_row(submitted=now)
    snapshot = metrics.build_dashboard_engagement({1: work}, {1: {"a"}}, [row], now)
    assert metrics.summarize_dashboard_engagement(snapshot).completed_count == 1
    late, weekdays = metrics.summarize_dashboard_submissions(snapshot.assignments, snapshot.eligible_submissions, [], now,
                                                           date(2026, 10, 1), date(2026, 12, 31))
    assert late.completed_count == weekdays.total_count == 0


def test_engagement_excuse_keeps_completion_performance_and_weekday_evidence():
    """Unit: attendance exemptions apply only to the lateness assessment."""
    now = datetime(2026, 10, 8, 2, tzinfo=timezone.utc)
    work = engagement_assignment(due=now - timedelta(hours=1))
    row = engagement_row(learner="learner", submitted=now)
    snapshot = metrics.build_dashboard_engagement({1: work}, {1: {"learner", "b"}}, [row], now)
    summary = metrics.summarize_dashboard_engagement(snapshot)
    late, weekdays = metrics.summarize_dashboard_submissions(snapshot.assignments, snapshot.eligible_submissions, [excuse()], now,
                                                           date(2026, 10, 1), date(2026, 12, 31))
    assert summary.expected_count == 2 and summary.completed_count == 1 and summary.avg_score_percent == 50.0
    assert late.excused_excluded_count == 1 and late.eligible_count == 0
    assert weekdays.total_count == 1


def test_trend_groups_manila_dates_and_weights_each_scored_learner_task_equally():
    """Unit: not an average of task averages, and not pooled points."""
    now = datetime(2026, 10, 10, tzinfo=timezone.utc)
    works = {1: engagement_assignment(1, due=datetime(2026, 10, 7, 17, tzinfo=timezone.utc), maximum=10),
             2: engagement_assignment(2, due=datetime(2026, 10, 8, 1, tzinfo=timezone.utc), maximum=100)}
    rows = [engagement_row(1, submitted=now, score=10), engagement_row(2, submitted=now, score=20),
            engagement_row(2, learner="b", submitted=now, score=40)]
    snapshot = metrics.build_dashboard_engagement(works, {1: {"a", "b"}}, rows, now)
    points = metrics.build_dashboard_performance_trend(snapshot, list(works.values()))
    assert len(points) == 1
    point = points[0]
    assert point.date_key == date(2026, 10, 8) and point.short_label == "Oct 08"
    assert point.assignment_ids == [1, 2] and point.classwork_id is None
    assert point.task_count == point.graded_task_count == 2
    assert point.scored_count == 3 and point.eligible_count == point.total_enrolled == 4
    assert point.submitted_count == 3 and point.completion_rate_percent == 75.0
    assert point.avg_score_percent == 53.3  # (100 + 20 + 40) / 3, not 65 or 33.3.


@pytest.mark.parametrize("fallback,expected", [("publish", date(2026, 10, 2)), ("created", date(2026, 10, 1))])
def test_trend_fallback_dates_use_manila_and_keep_real_single_task_id(fallback, expected):
    """Unit: no raw UTC date labels and no synthetic task/date identity."""
    now = datetime(2026, 10, 8, tzinfo=timezone.utc)
    work = engagement_assignment()
    work.publish_date = datetime(2026, 10, 1, 17, tzinfo=timezone.utc) if fallback == "publish" else None
    work.classwork.created_at = datetime(2026, 9, 30, 17, tzinfo=timezone.utc)
    snapshot = metrics.build_dashboard_engagement({1: work}, {1: {"a"}}, [], now)
    point = metrics.build_dashboard_performance_trend(snapshot, [work])[0]
    assert point.date_key == expected and point.classwork_id == work.classwork_id
    assert point.avg_score_percent is None and point.completion_rate_percent == 0.0


def test_trend_missing_all_dates_is_flagged_not_given_an_invented_date():
    """Unit: unknown calendar data never becomes a fake task label/point."""
    work = engagement_assignment()
    work.publish_date = work.classwork.created_at = None
    snapshot = metrics.build_dashboard_engagement({1: work}, {1: {"a"}}, [], datetime(2026, 10, 8, tzinfo=timezone.utc))
    assert metrics.build_dashboard_performance_trend(snapshot, [work]) == []
    assert metrics.summarize_dashboard_engagement(snapshot).warnings[0].code == "missing_trend_date"
