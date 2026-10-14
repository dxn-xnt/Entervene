"""Read-only teacher-dashboard grade, attendance and engagement policies.

The existing class-record calculation remains authoritative. This module never
finalizes grades, persists results, or substitutes a passing-grade constant.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import TYPE_CHECKING, Collection, Mapping, Sequence
from unicodedata import normalize
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.schemas.TeacherDashboard import (
    AttendanceSummary,
    DashboardGrade,
    DashboardEngagementSummary,
    DashboardGradeBand,
    DashboardGradeDistribution,
    DashboardLessonCoverage,
    DashboardLessonPerformanceItem,
    DashboardLessonPerformanceSummary,
    DashboardLessonPolicy,
    DashboardLessonSubjectSummary,
    DashboardPerformerItem,
    DashboardPerformerSummary,
    DashboardScopeLabel,
    DashboardSupportItem,
    DashboardSupportPolicy,
    DashboardSupportReason,
    DashboardSupportSummary,
    DashboardWindow,
    DashboardWarning,
    DashboardTrendPoint,
    GradeSummary,
    LateSubmissionSummary,
    TermProgress,
    ThresholdResolution,
    WeekdayCount,
    WeekdaySummary,
)
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from app.services.classes.ClassQueryService import _student_full_name
from app.models.people.Student import Student
from app.models.academic.Lesson import Lesson
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.services.classwork.ClassworkAccessService import assignment_allows_student

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


def read_dashboard_student_names(
    db: Session, student_ids: Collection[str]
) -> dict[str, str]:
    """One name-only SELECT for the authorized dashboard roster, never autoflush.

    The caller includes learners with unavailable grades so confirmed work or
    attendance indicators never require a second lookup or invented names.
    """
    ids = {UUID(student_id) for student_id in student_ids}
    if not ids:
        return {}
    with db.no_autoflush:
        rows = db.query(
            Student.student_id, Student.first_name, Student.middle_name,
            Student.last_name, Student.suffix,
        ).filter(Student.student_id.in_(ids)).all()
    return {str(row.student_id): _student_full_name(row) for row in rows}


def rank_dashboard_performers(
    grades: Sequence[DashboardGrade],
    student_names: Mapping[str, str],
    scope_labels: Mapping[tuple[int, int], DashboardScopeLabel],
    *,
    limit: int = 3,
) -> DashboardPerformerSummary:
    """Rank available class/student/subject entries, without a passing cutoff."""
    if limit < 1:
        raise ValueError("The dashboard performer limit must be positive")
    items = []
    warnings = {}
    for grade in grades:
        if grade.current_grade is None:
            continue
        name = student_names.get(grade.student_id)
        if not name or not name.strip():
            name = "Name unavailable"
            warnings[(grade.class_id, grade.subject_id)] = DashboardWarning(
                code="student_name_unavailable",
                message="Student name unavailable for one or more Current-grade entries.",
                class_id=grade.class_id, subject_id=grade.subject_id,
            )
        label = scope_labels.get((grade.class_id, grade.subject_id), DashboardScopeLabel())
        items.append(DashboardPerformerItem(
            student_id=grade.student_id, class_id=grade.class_id,
            subject_id=grade.subject_id, academic_period_id=grade.academic_period_id,
            name=name, section_name=label.section_name, subject_name=label.subject_name,
            current_grade=grade.current_grade,
        ))
    items.sort(key=lambda item: (
        -Decimal(str(item.current_grade)), normalize("NFC", item.name).casefold(),
        item.student_id, item.subject_id, item.class_id,
    ))
    kept = items[:limit]
    cutoff_ties = (
        sum(item.current_grade == kept[-1].current_grade for item in items[limit:])
        if len(items) > limit else 0
    )
    return DashboardPerformerSummary(
        items=kept, limit=limit, cutoff_tie_omitted_count=cutoff_ties,
        warnings=[warnings[key] for key in sorted(warnings)],
    )


def summarize_dashboard_grade_distribution(
    grades: Sequence[DashboardGrade],
) -> DashboardGradeDistribution:
    """Descriptive, neutral intervals on underlying grades, not passing bands."""
    labels = ("90-100", "85-89", "80-84", "75-79", "Below 75")
    lower_bounds = (Decimal("90"), Decimal("85"), Decimal("80"), Decimal("75"))
    counts = [0] * len(labels)
    available = 0
    for grade in grades:
        if grade.current_grade is None:
            continue
        value = Decimal(str(grade.current_grade))
        index = next((i for i, lower in enumerate(lower_bounds) if value >= lower), 4)
        counts[index] += 1
        available += 1
    return DashboardGradeDistribution(
        bands=[DashboardGradeBand(band=label, count=count) for label, count in zip(labels, counts)],
        total_grade_count=len(grades), available_grade_count=available,
        unavailable_grade_count=len(grades) - available,
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


@dataclass(frozen=True)
class DashboardEngagementSnapshot:
    """Request-local ORM inputs, never serialized or persisted."""
    assignments: Mapping[int, ClassworkAssignment]
    eligible_by_assignment: Mapping[int, frozenset[str]]
    selected_by_assignment: Mapping[int, Sequence[StudentSubmission]]
    warnings_by_assignment: Mapping[int, Sequence[DashboardWarning]]
    # Calendar metrics retain their existing filter-before-attempt-selection rule.
    eligible_submissions: Sequence[StudentSubmission]


def dashboard_assignment_student_ids(
    assignment: ClassworkAssignment, enrolled_student_ids: Collection[object]
) -> frozenset[str]:
    """Intersect the authoritative active roster with shared recipient eligibility."""
    return frozenset(str(student_id) for student_id in enrolled_student_ids
                     if assignment_allows_student(assignment, student_id))


def build_dashboard_engagement(
    assignments: Mapping[int, ClassworkAssignment],
    enrolled_by_class: Mapping[int, Collection[object]],
    submissions: Sequence[StudentSubmission],
    now: datetime,
) -> DashboardEngagementSnapshot:
    """One unique latest completed attempt per eligible learner/task through now.

    The assignment's selected period is the cohort; completion can include a
    submission after that period's end. Excuses never remove an obligation.
    Future timestamps are filtered before selecting, without falling back to
    an older graded attempt when the newest completed attempt is ungraded.
    """
    eligible = {aid: dashboard_assignment_student_ids(a, enrolled_by_class.get(a.class_id, ()))
                for aid, a in assignments.items()}
    candidates = {aid: [] for aid in assignments}
    scoped = []
    cutoff = _dashboard_aware_timestamp(now)
    for row in submissions:
        aid = row.classwork_assignment_id
        if aid not in eligible or str(row.student_id) not in eligible[aid]:
            continue
        if row.submitted_at is not None and _dashboard_aware_timestamp(row.submitted_at) > cutoff:
            continue
        scoped.append(row)
        candidates[aid].append(row)
    selected, warnings = {}, {}
    for aid, assignment in assignments.items():
        selected[aid], attempt_warnings = select_dashboard_submissions(candidates[aid])
        warnings[aid] = [warning.model_copy(update={
            "assignment_id": aid, "class_id": assignment.class_id,
            "subject_id": assignment.classwork.subject_id,
        }) for warning in attempt_warnings]
        if assignment.recipient_student_id is not None and not eligible[aid]:
            warnings[aid].append(DashboardWarning(
                code="targeted_recipient_outside_active_roster",
                message="Assignment configuration: targeted recipient is outside the active roster.",
                assignment_id=aid, class_id=assignment.class_id,
                subject_id=assignment.classwork.subject_id,
            ))
        if not (assignment.due_date or assignment.publish_date or assignment.classwork.created_at):
            warnings[aid].append(DashboardWarning(
                code="missing_trend_date",
                message="Trend incomplete: an assignment has no deadline, publish or creation date.",
                assignment_id=aid, class_id=assignment.class_id,
                subject_id=assignment.classwork.subject_id,
            ))
    return DashboardEngagementSnapshot(assignments, eligible, selected, warnings, scoped)


def _dashboard_task_percent(submission: StudentSubmission, assignment: ClassworkAssignment) -> float | None:
    if submission.grade is None or assignment.classwork.total_points is None:
        return None
    points, maximum = float(submission.grade), float(assignment.classwork.total_points)
    if not isfinite(points) or not isfinite(maximum) or maximum <= 0:
        return None
    return points / maximum * 100.0


def summarize_dashboard_engagement(
    snapshot: DashboardEngagementSnapshot, assignment_ids: Collection[int] | None = None
) -> DashboardEngagementSummary:
    """Python aggregation, equal weight per scored learner-task, no ORM reads."""
    ids = sorted(snapshot.assignments if assignment_ids is None else set(assignment_ids))
    warnings = [warning for aid in ids for warning in snapshot.warnings_by_assignment[aid]]
    ambiguous = any(warning.code == "ambiguous_submission_attempts" for warning in warnings)
    expected = sum(len(snapshot.eligible_by_assignment[aid]) for aid in ids)
    completed = sum(len(snapshot.selected_by_assignment[aid]) for aid in ids)
    pending = sum(row.status in {"submitted", "late"} and row.grade is None
                  for aid in ids for row in snapshot.selected_by_assignment[aid])
    scores = []
    graded_tasks = 0
    for aid in ids:
        task_scores = [score for row in snapshot.selected_by_assignment[aid]
                       if (score := _dashboard_task_percent(row, snapshot.assignments[aid])) is not None]
        scores.extend(task_scores)
        graded_tasks += bool(task_scores)
    no_eligible_target = expected == 0 and any(
        warning.code == "targeted_recipient_outside_active_roster" for warning in warnings
    )
    return DashboardEngagementSummary(
        expected_count=expected,
        completed_count=None if ambiguous else completed,
        pending_grading_count=None if ambiguous else pending,
        resolved_completed_count=completed, resolved_pending_grading_count=pending,
        completion_rate_percent=(None if ambiguous or no_eligible_target else
                                 round(float(completed) / float(expected) * 100.0, 1) if expected else 0.0),
        avg_score_percent=(round(sum(scores) / float(len(scores)), 1) if scores and not ambiguous else None),
        scored_count=len(scores), graded_task_count=graded_tasks, warnings=warnings,
    )


def build_dashboard_performance_trend(
    snapshot: DashboardEngagementSnapshot, assignments: Sequence[ClassworkAssignment]
) -> list[DashboardTrendPoint]:
    """One point per Manila deadline day (publish/creation fallback), not per task."""
    groups: dict[date, list[ClassworkAssignment]] = {}
    for assignment in assignments:
        timestamp = assignment.due_date or assignment.publish_date or assignment.classwork.created_at
        if timestamp is not None:
            groups.setdefault(dashboard_manila_date(timestamp), []).append(assignment)
    points = []
    for day, tasks in sorted(groups.items()):
        tasks.sort(key=lambda a: a.classwork_assignment_id)
        ids = [a.classwork_assignment_id for a in tasks]
        summary = summarize_dashboard_engagement(snapshot, ids)
        label = day.strftime("%b %d")
        points.append(DashboardTrendPoint(
            date_key=day, assignment_ids=ids, task_count=len(tasks),
            # A multi-task point must not invent a representative navigation ID.
            classwork_id=tasks[0].classwork_id if len(tasks) == 1 else None,
            due_date=tasks[0].due_date.isoformat() if len(tasks) == 1 and tasks[0].due_date is not None else None,
            title=f"{len(tasks)} {'task' if len(tasks) == 1 else 'tasks'}", label=label, short_label=label,
            avg_score_percent=summary.avg_score_percent,
            completion_rate_percent=summary.completion_rate_percent,
            submitted_count=summary.completed_count,
            total_enrolled=summary.expected_count, eligible_count=summary.expected_count,
            scored_count=summary.scored_count, graded_task_count=summary.graded_task_count,
            warnings=summary.warnings,
        ))
    return points


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


def summarize_dashboard_support(
    grades: Sequence[DashboardGrade],
    thresholds: Mapping[int, ThresholdResolution],
    engagement: DashboardEngagementSnapshot,
    attendance: Sequence[AttendanceRecord],
    excuses: Sequence[AttendanceRecord],
    now: datetime,
    month_window: DashboardWindow,
    period_start: date,
    period_end: date,
    student_names: Mapping[str, str],
    scope_labels: Mapping[tuple[int, int], DashboardScopeLabel],
    *,
    policy: DashboardSupportPolicy | None = None,
    require_subject_match: bool = False,
) -> DashboardSupportSummary:
    """Confirmed, observed indicators only; no queries, predictions or risk score.

    The grade population is the authoritative active student/class/subject scope.
    Excuses suppress deadline indicators and absence dates, not obligations or
    completion totals. Attendance evidence is DISTINCT recorded calendar dates.
    """
    policy = policy or DashboardSupportPolicy()
    cutoff = _dashboard_aware_timestamp(now)
    today = dashboard_manila_date(cutoff)
    warnings: dict[tuple, DashboardWarning] = {}

    def warn(warning: DashboardWarning) -> None:
        warnings[(warning.code, warning.class_id, warning.subject_id, warning.assignment_id)] = warning

    population = {(g.student_id, g.class_id, g.subject_id, g.academic_period_id): g for g in grades}
    authorized = {(g.student_id, g.class_id) for g in population.values()}
    recorded: dict[tuple[str, int], dict[date, set[str]]] = {}
    for record in attendance:
        key = (str(record.student_id), record.class_id)
        if (key in authorized and month_window.start_date <= record.date <= month_window.end_date
                and record.status in {"present", "late", "excused", "absent"}):
            recorded.setdefault(key, {}).setdefault(record.date, set()).add(record.status)

    overdue: dict[tuple[str, int, int], int] = {}
    for aid, assignment in engagement.assignments.items():
        assignment_warnings = engagement.warnings_by_assignment[aid]
        for warning in assignment_warnings:
            if warning.code in {"ambiguous_submission_attempts", "targeted_recipient_outside_active_roster"}:
                warn(warning)
        # A duplicate-attempt ambiguity must not be misreported as missing work.
        if any(w.code == "ambiguous_submission_attempts" for w in assignment_warnings):
            continue
        if assignment.due_date is None or _dashboard_aware_timestamp(assignment.due_date) >= cutoff:
            continue
        completed = {str(row.student_id) for row in engagement.selected_by_assignment[aid]}
        for student_id in engagement.eligible_by_assignment[aid] - completed:
            if dashboard_excuse_covers_submission(
                student_id, assignment.class_id, assignment.classwork.subject_id,
                assignment.due_date, excuses, require_subject_match=require_subject_match,
            ):
                continue
            key = (student_id, assignment.class_id, assignment.classwork.subject_id)
            overdue[key] = overdue.get(key, 0) + 1

    # Match Phase 2/4 calendar lateness: filter by period before canonical selection.
    in_period = [row for row in engagement.eligible_submissions if row.submitted_at is None or (
        _dashboard_aware_timestamp(row.submitted_at) <= cutoff
        and period_start <= dashboard_manila_date(row.submitted_at) <= min(today, period_end)
    )]
    selected, attempt_warnings = select_dashboard_submissions(in_period)
    for warning in attempt_warnings:
        warn(warning)
    late: dict[tuple[str, int, int], int] = {}
    for row in selected:
        assignment = engagement.assignments[row.classwork_assignment_id]
        if dashboard_excuse_covers_submission(
            row.student_id, assignment.class_id, assignment.classwork.subject_id,
            assignment.due_date, excuses, require_subject_match=require_subject_match,
        ):
            continue
        is_late = dashboard_submission_is_late(row.submitted_at, assignment.due_date)
        if is_late is None:
            warn(DashboardWarning(
                code="missing_submission_timestamp" if row.submitted_at is None else "missing_deadline_timestamp",
                message="Late-submission indicator unavailable: a submission or deadline timestamp is missing.",
                class_id=assignment.class_id, subject_id=assignment.classwork.subject_id,
                assignment_id=assignment.classwork_assignment_id,
            ))
        elif is_late:
            key = (str(row.student_id), assignment.class_id, assignment.classwork.subject_id)
            late[key] = late.get(key, 0) + 1

    items = []
    unavailable = 0
    for grade in population.values():
        if grade.warning is not None:
            warn(grade.warning)
        value = _finite_grade_number(grade.current_grade)
        unavailable += value is None
        resolution = thresholds.get(grade.subject_id)
        threshold = (_finite_grade_number(resolution.passing_threshold)
                     if resolution is not None and resolution.warning is None
                     and resolution.subject_id == grade.subject_id else None)
        if threshold is None:
            warn(resolution.warning if resolution and resolution.warning else DashboardWarning(
                code="invalid_passing_threshold",
                message="Below-passing indicator unavailable: subject-group passing grade is missing or invalid.",
                subject_id=grade.subject_id,
            ))
        reasons = []
        if value is not None and threshold is not None and value < threshold:
            reasons.append(DashboardSupportReason(
                code="below_passing", message=f"Below subject-group passing grade ({threshold:g})",
                passing_threshold=float(threshold),
            ))
        key = (grade.student_id, grade.class_id, grade.subject_id)
        count = overdue.get(key, 0)
        if count >= policy.min_overdue_tasks:
            reasons.append(DashboardSupportReason(
                code="overdue_work", count=count,
                message=f"{count} overdue assigned {'task' if count == 1 else 'tasks'}",
            ))
        days = recorded.get((grade.student_id, grade.class_id), {})
        absence_days = sum("absent" in statuses and "excused" not in statuses for statuses in days.values())
        if len(days) >= policy.min_recorded_attendance_days and absence_days >= policy.min_unexcused_absence_days:
            reasons.append(DashboardSupportReason(
                code="unexcused_absences", count=absence_days, recorded_day_count=len(days),
                message=f"{absence_days} unexcused absence dates this month ({len(days)} recorded dates)",
            ))
        count = late.get(key, 0)
        if count >= policy.min_late_submissions:
            reasons.append(DashboardSupportReason(
                code="late_submissions", count=count,
                message=f"{count} non-excused late {'submission' if count == 1 else 'submissions'}",
            ))
        if not reasons:
            continue
        name = student_names.get(grade.student_id)
        if not name or not name.strip():
            name = "Name unavailable"
            warn(DashboardWarning(
                code="student_name_unavailable", message="Student name unavailable for one or more check-in entries.",
                class_id=grade.class_id, subject_id=grade.subject_id,
            ))
        label = scope_labels.get((grade.class_id, grade.subject_id), DashboardScopeLabel())
        items.append(DashboardSupportItem(
            student_id=grade.student_id, class_id=grade.class_id, subject_id=grade.subject_id,
            academic_period_id=grade.academic_period_id, name=name,
            section_name=label.section_name, subject_name=label.subject_name,
            current_grade=float(value) if value is not None else None, reasons=reasons,
        ))
    priority = {code: i for i, code in enumerate((
        "below_passing", "overdue_work", "unexcused_absences", "late_submissions",
    ))}
    items.sort(key=lambda item: (
        priority[item.reasons[0].code], normalize("NFC", item.name).casefold(),
        item.student_id, item.subject_id, item.class_id,
    ))
    return DashboardSupportSummary(
        policy=policy, items=items[:policy.limit], total_entry_count=len(population),
        qualifying_entry_count=len(items), omitted_entry_count=max(0, len(items) - policy.limit),
        unavailable_grade_count=unavailable, warnings=list(warnings.values()),
    )


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


@dataclass(frozen=True)
class DashboardLessonQuestion:
    quiz_question_id: int
    question_id: int
    classwork_id: int
    subject_id: int
    points: object
    lesson_id: int | None
    lesson_title: str | None
    lesson_subject_id: int | None


@dataclass(frozen=True)
class DashboardLessonAttempt:
    student_id: str
    classwork_id: int
    subject_id: int


@dataclass(frozen=True)
class DashboardLessonAnswer:
    submission_id: int
    quiz_question_id: int
    points_awarded: object


@dataclass(frozen=True)
class DashboardLessonEvidence:
    """Internal read inputs only; learner IDs and answers are never serialized."""
    subjects: Mapping[int, tuple[str, tuple[int, ...]]]
    questions: Sequence[DashboardLessonQuestion]
    attempts: Mapping[int, DashboardLessonAttempt]
    answers: Sequence[DashboardLessonAnswer]
    warnings_by_subject: Mapping[int, Sequence[DashboardWarning]]
    manual_assignment_counts: Mapping[int, int]


def read_dashboard_lesson_evidence(
    db: Session, snapshot: DashboardEngagementSnapshot, *,
    subjects: Mapping[int, tuple[str, tuple[int, ...]]],
) -> DashboardLessonEvidence:
    """At most TWO narrow SELECTs, using already-authorized request inputs.

    The snapshot chose latest completed attempts before scores are read. READY
    and PUBLISHED are the quiz states the student attempt service accepts.
    No answer/question text, options, student names or lazy relationships read.
    """
    work_subjects = {a.classwork_id: a.classwork.subject_id for a in snapshot.assignments.values()}
    with db.no_autoflush:
        rows = db.query(
            Quiz.classwork_id, QuizQuestion.quiz_question_id, Question.question_id,
            Question.points, Question.lesson_id, Lesson.title, Lesson.subject_id,
        ).join(QuizQuestion, QuizQuestion.quiz_id == Quiz.quiz_id).join(
            Question, Question.question_id == QuizQuestion.question_id,
        ).outerjoin(Lesson, Lesson.lesson_id == Question.lesson_id).filter(
            Quiz.classwork_id.in_(work_subjects), Quiz.status.in_(["READY", "PUBLISHED"]),
        ).all() if work_subjects else []
        questions = [DashboardLessonQuestion(row.quiz_question_id, row.question_id,
            row.classwork_id, work_subjects[row.classwork_id], row.points,
            row.lesson_id, row.title, row.subject_id) for row in rows]
        quiz_works = {q.classwork_id for q in questions}
        attempts = {
            row.submission_id: DashboardLessonAttempt(str(row.student_id),
                snapshot.assignments[aid].classwork_id, snapshot.assignments[aid].classwork.subject_id)
            for aid, selected in snapshot.selected_by_assignment.items()
            if snapshot.assignments[aid].classwork_id in quiz_works
            for row in selected
        }
        answers = [DashboardLessonAnswer(row.submission_id, row.quiz_question_id, row.points_awarded)
            for row in db.query(QuizAnswer.submission_id, QuizAnswer.quiz_question_id,
                QuizAnswer.points_awarded).filter(QuizAnswer.submission_id.in_(attempts),
                    QuizAnswer.quiz_question_id.in_({q.quiz_question_id for q in questions})).all()
        ] if attempts else []
    warnings = {sid: [] for sid in subjects}
    manual_counts = {sid: 0 for sid in subjects}
    for aid, assignment in snapshot.assignments.items():
        sid = assignment.classwork.subject_id
        if sid not in subjects:
            continue
        warnings[sid].extend(w for w in snapshot.warnings_by_assignment[aid]
                            if w.code in {"ambiguous_submission_attempts", "targeted_recipient_outside_active_roster"})
        if assignment.classwork_id not in quiz_works and assignment.classwork.classwork_type != "QUIZ":
            manual_counts[sid] += 1
    return DashboardLessonEvidence(subjects, questions, attempts, answers, warnings, manual_counts)


def _lesson_number(value: object) -> Decimal | None:
    if isinstance(value, bool) or not isinstance(value, (Decimal, int, float)):
        return None
    number = Decimal(str(value))
    return number if number.is_finite() and number >= 0 else None


def summarize_dashboard_lesson_performance(
    evidence: DashboardLessonEvidence, *, min_learners: int = 3,
    min_questions: int = 3, limit_per_subject: int = 5,
) -> DashboardLessonPerformanceSummary:
    """Points-pooled scored responses, sorted BEFORE display rounding.

    Missing mappings take the unmapped bucket; missing scores on mapped items
    take the ungraded bucket. Neither becomes zero. Only stored numeric zero is
    zero evidence. No task-total override or coverage assertion is apportioned.
    """
    policy = DashboardLessonPolicy(min_learners=min_learners,
        min_questions=min_questions, limit_per_subject=limit_per_subject)
    summaries = {
        sid: DashboardLessonSubjectSummary(subject_id=sid, subject_name=name,
            class_ids=sorted(set(classes)),
            coverage=DashboardLessonCoverage(
                excluded_manual_assignment_count=evidence.manual_assignment_counts.get(sid, 0)),
            warnings=list(evidence.warnings_by_subject.get(sid, ())))
        for sid, (name, classes) in evidence.subjects.items()
    }
    by_work: dict[int, list[DashboardLessonQuestion]] = {}
    for question in evidence.questions:
        by_work.setdefault(question.classwork_id, []).append(question)
    answers = {}
    duplicate_answers = set()
    question_lookup = {q.quiz_question_id: q for q in evidence.questions}
    for answer in evidence.answers:
        attempt = evidence.attempts.get(answer.submission_id)
        question = question_lookup.get(answer.quiz_question_id)
        if attempt is None:
            continue
        if question is None or question.classwork_id != attempt.classwork_id:
            if attempt.subject_id in summaries:
                summaries[attempt.subject_id].coverage.invalid_response_count += 1
            continue
        key = (answer.submission_id, answer.quiz_question_id)
        if key in answers:
            duplicate_answers.add(key)
        answers[key] = answer.points_awarded
    lessons = {}
    for submission_id, attempt in evidence.attempts.items():
        summary = summaries.get(attempt.subject_id)
        if summary is None:
            continue
        for question in by_work.get(attempt.classwork_id, ()):
            coverage = summary.coverage
            key = (submission_id, question.quiz_question_id)
            if question.subject_id != attempt.subject_id or key in duplicate_answers:
                coverage.invalid_response_count += 1
                continue
            if question.lesson_id is None or question.lesson_subject_id is None:
                coverage.unmapped_response_count += 1
                continue
            if question.lesson_subject_id != attempt.subject_id:
                coverage.invalid_response_count += 1
                continue
            maximum = _lesson_number(question.points)
            if maximum is None or maximum == 0:
                coverage.invalid_response_count += 1
                continue
            lesson_key = (attempt.subject_id, question.lesson_id)
            lesson = lessons.setdefault(lesson_key, {
                "title": question.lesson_title or "Lesson title unavailable",
                "earned": Decimal(0), "possible": Decimal(0), "responses": 0,
                "learners": set(), "questions": set(),
            })
            raw_score = answers.get(key)
            if raw_score is None:
                coverage.ungraded_response_count += 1
                continue
            earned = _lesson_number(raw_score)
            if earned is None or earned > maximum:
                coverage.invalid_response_count += 1
                continue
            coverage.scored_mapped_response_count += 1
            lesson["earned"] += earned
            lesson["possible"] += maximum
            lesson["responses"] += 1
            lesson["learners"].add(attempt.student_id)
            lesson["questions"].add(question.question_id)
    ranked = {sid: [] for sid in summaries}
    for (sid, lesson_id), lesson in lessons.items():
        if len(lesson["learners"]) < min_learners or len(lesson["questions"]) < min_questions:
            summaries[sid].coverage.insufficient_lesson_count += 1
            continue
        percent = lesson["earned"] / lesson["possible"] * Decimal(100)
        item = DashboardLessonPerformanceItem(lesson_id=lesson_id, title=lesson["title"],
            performance_percent=float(round(percent, 1)),
            awarded_points=float(lesson["earned"]), possible_points=float(lesson["possible"]),
            scored_response_count=lesson["responses"], learner_count=len(lesson["learners"]),
            question_count=len(lesson["questions"]))
        ranked[sid].append((percent, normalize("NFC", item.title).casefold(), lesson_id, item))
    for sid, summary in summaries.items():
        rows = sorted(ranked[sid], key=lambda row: row[:3])
        summary.items = [row[3] for row in rows[:limit_per_subject]]
        summary.coverage.omitted_lesson_count = max(0, len(rows) - limit_per_subject)
        if summary.coverage.invalid_response_count:
            summary.warnings.append(DashboardWarning(code="invalid_lesson_evidence",
                message="Lesson performance excludes invalid or mismatched quiz evidence.", subject_id=sid))
        if any(item.title == "Lesson title unavailable" for item in summary.items):
            summary.warnings.append(DashboardWarning(code="missing_lesson_title",
                message="A lesson title is unavailable.", subject_id=sid))
    return DashboardLessonPerformanceSummary(policy=policy, subjects=sorted(summaries.values(),
        key=lambda summary: (normalize("NFC", summary.subject_name).casefold(), summary.subject_id)))
