"""Read-only Phase 2 teacher-dashboard policies, not app-wide grade policies.

The existing class-record calculation remains authoritative. This module never
finalizes grades, persists results, or substitutes a passing-grade constant.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import TYPE_CHECKING, Mapping, Sequence
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.schemas.TeacherDashboard import (
    AttendanceSummary,
    DashboardGrade,
    DashboardWindow,
    DashboardWarning,
    GradeSummary,
    LateSubmissionSummary,
    TermProgress,
    ThresholdResolution,
    WeekdayCount,
    WeekdaySummary,
)
from app.services.student_record.StudentRecordService import teacher_student_gradebook

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.models.academic.Subject import Subject
    from app.models.attendance.Attendance import AttendanceRecord
    from app.models.classwork.ClassworkAssignment import ClassworkAssignment
    from app.models.submissions.StudentSubmission import StudentSubmission


PASSING_CONFIGURATION_WARNING = (
    "Passing rate unavailable: subject-group passing grade is missing or invalid."
)


@dataclass(frozen=True)
class DashboardScope:
    class_id: int
    subject_id: int
    academic_period_id: int
    # A caller's authoritative active-enrollment set; None uses the gradebook roster.
    student_ids: frozenset[str] | None = None


def _finite_grade_number(value: object) -> Decimal | None:
    """Database numerics only; reject booleans, text, NaN and infinity."""
    if isinstance(value, bool) or not isinstance(value, (Decimal, int, float)):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() and Decimal(0) <= number <= Decimal(100) else None


def resolve_dashboard_passing_threshold(subject: Subject) -> ThresholdResolution:
    """Read the current subject-group relationship with no default or cache."""
    subject_id = subject.subject_id
    group = getattr(subject, "subject_group_rel", None)
    group_id = getattr(subject, "subject_group_id", None)
    linked_id = getattr(group, "subject_group_id", None)
    valid_identity = (
        isinstance(group_id, int)
        and not isinstance(group_id, bool)
        and group_id > 0
        and isinstance(linked_id, int)
        and not isinstance(linked_id, bool)
        and group_id == linked_id
    )
    value = _finite_grade_number(getattr(group, "passing_threshold", None))
    if not valid_identity or value is None:
        return ThresholdResolution(
            subject_id=subject_id,
            subject_group_id=group_id if valid_identity else None,
            warning=DashboardWarning(
                code="invalid_passing_threshold",
                message=PASSING_CONFIGURATION_WARNING,
                subject_id=subject_id,
            ),
        )
    return ThresholdResolution(
        subject_id=subject_id,
        subject_group_id=group_id,
        passing_threshold=float(value),
    )


def read_dashboard_current_grades(
    db: Session, staff_id: str, scopes: Sequence[DashboardScope]
) -> list[DashboardGrade]:
    """Call the existing gradebook once per unique scope within this request.

    Read its Term Grade field, not ``total`` (which may choose a separate saved
    final/initial grade). Protect the read path from SQLAlchemy autoflush.
    """
    gradebooks: dict[tuple[int, int, int], object | None] = {}
    read_warnings: dict[tuple[int, int, int], DashboardWarning] = {}
    result: dict[tuple[str, int, int, int], DashboardGrade] = {}
    with db.no_autoflush:
        for scope in scopes:
            key = (scope.class_id, scope.subject_id, scope.academic_period_id)
            if key not in gradebooks:
                try:
                    gradebooks[key] = teacher_student_gradebook(db, staff_id, *key)
                except HTTPException as exc:
                    if exc.status_code not in (403, 404):
                        raise
                    gradebooks[key] = None
                    read_warnings[key] = DashboardWarning(
                        code="grade_scope_unavailable",
                        message="Current grade unavailable for this teacher scope.",
                        subject_id=scope.subject_id,
                        class_id=scope.class_id,
                    )
            if scope.student_ids is not None:
                for student_id in sorted(scope.student_ids):
                    result.setdefault((student_id, *key), DashboardGrade(
                        student_id=student_id,
                        class_id=scope.class_id,
                        subject_id=scope.subject_id,
                        academic_period_id=scope.academic_period_id,
                        warning=read_warnings.get(key),
                    ))
            if gradebooks[key] is None:
                continue
            for row in gradebooks[key].studentGrades:
                student_id = str(row.student_id)
                if scope.student_ids is not None and student_id not in scope.student_ids:
                    continue
                value = _finite_grade_number(row.transmuted_grade)
                result[(student_id, *key)] = DashboardGrade(
                    student_id=student_id,
                    class_id=scope.class_id,
                    subject_id=scope.subject_id,
                    academic_period_id=scope.academic_period_id,
                    current_grade=float(value) if value is not None else None,
                )
    return list(result.values())


def summarize_dashboard_grades(
    grades: Sequence[DashboardGrade], thresholds: Mapping[int, ThresholdResolution]
) -> GradeSummary:
    """Compare each student-subject to its own runtime group threshold."""
    available = [grade for grade in grades if grade.current_grade is not None]
    # A missing group is also a configuration gap in an authorized empty roster.
    subject_ids = {grade.subject_id for grade in grades} | set(thresholds)
    warnings: list[DashboardWarning] = []
    warning_keys: set[tuple[str, int | None, int | None]] = set()
    for grade in grades:
        if grade.warning is not None:
            key = (grade.warning.code, grade.warning.subject_id, grade.warning.class_id)
            if key not in warning_keys:
                warnings.append(grade.warning)
                warning_keys.add(key)
    resolved: dict[int, Decimal] = {}
    for subject_id in sorted(subject_ids):
        resolution = thresholds.get(subject_id)
        threshold = (
            _finite_grade_number(resolution.passing_threshold)
            if resolution is not None and resolution.warning is None
            and resolution.subject_id == subject_id
            else None
        )
        if threshold is None:
            warnings.append(
                resolution.warning if resolution is not None and resolution.warning else
                DashboardWarning(
                    code="invalid_passing_threshold",
                    message=PASSING_CONFIGURATION_WARNING,
                    subject_id=subject_id,
                )
            )
        else:
            resolved[subject_id] = threshold

    mean = (
        sum(Decimal(str(grade.current_grade)) for grade in available) / Decimal(len(available))
        if available else None
    )
    passing_count = None
    passing_rate = None
    if available and not warnings:
        passing_count = sum(
            Decimal(str(grade.current_grade)) >= resolved[grade.subject_id]
            for grade in available
        )
        passing_rate = round(float(passing_count) / float(len(available)) * 100.0, 1)

    single_threshold = (
        resolved[next(iter(subject_ids))]
        if len(subject_ids) == 1 and not warnings else None
    )
    return GradeSummary(
        current_grade=round(float(mean), 1) if mean is not None else None,
        passing_rate_percent=passing_rate,
        available_grade_count=len(available),
        total_grade_count=len(grades),
        passing_count=passing_count,
        passing_threshold=float(single_threshold) if single_threshold is not None else None,
        current_grade_meets_threshold=(
            mean >= single_threshold if mean is not None and single_threshold is not None else None
        ),
        warnings=warnings,
    )


def dashboard_manila_date(value: datetime) -> date:
    """Use the Manila calendar, with the existing UTC convention for naive data."""
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(ZoneInfo("Asia/Manila")).date()


def dashboard_month_window(
    now: datetime, period_start: date, period_end: date
) -> DashboardWindow:
    """Inclusive first-through-today window intersected with the selected period.

    A disjoint historical or future period yields start > end. Callers must not
    replace that empty intersection with another month's records.
    """
    today = dashboard_manila_date(now)
    return DashboardWindow(
        start_date=max(today.replace(day=1), period_start),
        end_date=min(today, period_end),
        today=today,
    )


def summarize_dashboard_attendance(records: Sequence[AttendanceRecord]) -> AttendanceSummary:
    """Preserve recorded-ROW denominator; only present and late are attended.

    Do not infer records on missing days, prefer advisory records, or deduplicate
    subject attendance. Excused and absent rows both remain in the denominator.
    """
    counts = {status: sum(record.status == status for record in records)
              for status in ("present", "late", "excused", "absent")}
    count = len(records)
    return AttendanceSummary(
        rate=(round(float(counts["present"] + counts["late"]) / float(count) * 100.0, 1)
              if count else None),
        record_count=count,
        present_count=counts["present"],
        late_count=counts["late"],
        excused_count=counts["excused"],
        absent_count=counts["absent"],
    )


def _dashboard_aware_timestamp(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def dashboard_submission_is_late(
    submitted_at: datetime | None, due_at: datetime | None
) -> bool | None:
    """Equality is on time; unknown timestamps are not silently on time."""
    if submitted_at is None or due_at is None:
        return None
    return _dashboard_aware_timestamp(submitted_at) > _dashboard_aware_timestamp(due_at)


def dashboard_excuse_covers_submission(
    student_id: object,
    class_id: int,
    subject_id: int | None,
    deadline: datetime | None,
    excuses: Sequence[AttendanceRecord],
    *,
    require_subject_match: bool = False,
) -> bool:
    """Three-field rule: learner, class, and Manila DEADLINE calendar date.

    Subject/advisory matching is optional and OFF for the dashboard's approved
    policy. An excuse does not remove completion or weekday submission evidence.
    """
    if deadline is None:
        return False
    deadline_date = dashboard_manila_date(deadline)
    return any(
        record.status == "excused"
        and str(record.student_id) == str(student_id)
        and record.class_id == class_id
        and record.date == deadline_date
        and (not require_subject_match or record.subject_id in (None, subject_id))
        for record in excuses
    )


def select_dashboard_submissions(
    submissions: Sequence[StudentSubmission],
) -> tuple[list[StudentSubmission], list[DashboardWarning]]:
    """One completed row per learner/assignment; ambiguous attempts are flagged.

    A unique latest submission timestamp is authoritative. Ties or missing
    timestamps across multiple completed rows cannot be resolved safely by ID.
    """
    groups: dict[tuple[str, int], list[StudentSubmission]] = {}
    seen_objects: set[int] = set()
    for submission in submissions:
        if submission.status not in {"submitted", "graded", "late"}:
            continue
        if id(submission) in seen_objects:
            continue
        seen_objects.add(id(submission))
        key = (str(submission.student_id), submission.classwork_assignment_id)
        groups.setdefault(key, []).append(submission)
    selected: list[StudentSubmission] = []
    warnings: list[DashboardWarning] = []
    for candidates in groups.values():
        if len(candidates) == 1:
            selected.append(candidates[0])
            continue
        if all(candidate.submitted_at is not None for candidate in candidates):
            latest = max(_dashboard_aware_timestamp(candidate.submitted_at) for candidate in candidates)
            last = [candidate for candidate in candidates
                    if _dashboard_aware_timestamp(candidate.submitted_at) == latest]
            if len(last) == 1:
                selected.append(last[0])
                continue
        warnings.append(DashboardWarning(
            code="ambiguous_submission_attempts",
            message="Submission metrics unavailable: ambiguous duplicate submissions.",
        ))
    return selected, warnings


def summarize_dashboard_submissions(
    assignments: Mapping[int, ClassworkAssignment],
    submissions: Sequence[StudentSubmission],
    attendance: Sequence[AttendanceRecord],
    now: datetime,
    period_start: date,
    period_end: date,
    *,
    require_subject_match: bool = False,
) -> tuple[LateSubmissionSummary, WeekdaySummary]:
    """Dashboard-only lateness and weekdays, without touching eligibility.

    Select existing completed rows, constrain actual submission dates to the
    chosen period through now, and exclude deadline-date excuses from both late
    numerator and denominator. Dates/weekday conversion happens in Python.
    """
    cutoff = _dashboard_aware_timestamp(now)
    today = dashboard_manila_date(cutoff)
    in_window = []
    for submission in submissions:
        timestamp = submission.submitted_at
        if timestamp is None:
            # Unknown dates cannot be silently classified as outside this scope.
            in_window.append(submission)
            continue
        submitted = _dashboard_aware_timestamp(timestamp)
        if submitted <= cutoff and period_start <= dashboard_manila_date(submitted) <= min(today, period_end):
            in_window.append(submission)
    selected, duplicate_warnings = select_dashboard_submissions(in_window)
    late_warnings = list(duplicate_warnings)
    weekday_warnings = list(duplicate_warnings)
    bins = [0] * 7
    late_count = eligible_count = excluded_count = completed_count = 0
    for submission in selected:
        assignment = assignments.get(submission.classwork_assignment_id)
        if assignment is None:
            warning = DashboardWarning(
                code="missing_submission_assignment",
                message="Submission metrics unavailable: assignment scope is missing.",
            )
            late_warnings.append(warning)
            weekday_warnings.append(warning)
            continue
        timestamp = submission.submitted_at
        if timestamp is not None:
            submitted = _dashboard_aware_timestamp(timestamp)
            submitted_date = dashboard_manila_date(submitted)
            if submitted > cutoff or not period_start <= submitted_date <= min(today, period_end):
                continue
            bins[submitted_date.weekday()] += 1
        else:
            warning = DashboardWarning(
                code="missing_submission_timestamp",
                message="Submission metrics unavailable: submission timestamp is missing.",
                class_id=assignment.class_id,
                subject_id=assignment.classwork.subject_id,
            )
            weekday_warnings.append(warning)
        completed_count += 1
        if dashboard_excuse_covers_submission(
            submission.student_id, assignment.class_id, assignment.classwork.subject_id,
            assignment.due_date, attendance, require_subject_match=require_subject_match,
        ):
            excluded_count += 1
            continue
        eligible_count += 1
        late = dashboard_submission_is_late(timestamp, assignment.due_date)
        if late is None:
            if timestamp is None:
                late_warnings.append(warning)
            else:
                late_warnings.append(DashboardWarning(
                    code="missing_deadline_timestamp",
                    message="Late submissions unavailable: a deadline is missing.",
                    class_id=assignment.class_id,
                    subject_id=assignment.classwork.subject_id,
                ))
        else:
            late_count += int(late)
    late_summary = LateSubmissionSummary(
        late_rate_percent=(round(float(late_count) / float(eligible_count) * 100.0, 1)
                           if eligible_count and not late_warnings else None),
        late_count=late_count,
        eligible_count=eligible_count,
        excused_excluded_count=excluded_count,
        completed_count=completed_count,
        warnings=late_warnings,
    )
    weekday_summary = WeekdaySummary(
        days=[WeekdayCount(label=label, day_index=index, count=bins[index])
              for index, label in enumerate(("Mon", "Tue", "Wed", "Thu", "Fri", "Sat"))],
        sunday_count=bins[6],
        total_count=sum(bins),
        warnings=weekday_warnings,
    )
    return late_summary, weekday_summary


def dashboard_term_progress(period_start: date, period_end: date, today: date) -> TermProgress:
    """Elapsed inclusive calendar days, not a claim about scheduled school days."""
    total_days = (period_end - period_start).days + 1
    if total_days <= 0:
        return TermProgress(warnings=[DashboardWarning(
            code="invalid_period_dates",
            message="Calendar progress unavailable: invalid period dates.",
        )])
    elapsed_days = min(total_days, max(0, (today - period_start).days + 1))
    total_weeks = (total_days + 6) // 7
    return TermProgress(
        progress_percent=round(float(elapsed_days) / float(total_days) * 100.0, 1),
        elapsed_days=elapsed_days,
        total_days=total_days,
        week_number=min(total_weeks, (elapsed_days + 6) // 7),
        total_weeks=total_weeks,
    )
