"""Standalone, idempotent 24-hour Classwork deadline reminder scanner.

Mirrors StudySupportReminderService: safe for bounded periodic execution from
cron, Task Scheduler, or an external runner without embedding a loop in FastAPI.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import threading
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

import app.models  # noqa: F401 - load the full mapper registry for standalone runs
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.notifications.Notification import Notification
from app.models.people.Student import Student
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Notification import NotificationCreate
from app.services.NotificationService import stage_notification
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.classwork.ClassworkService import _format_subject_prefixed_title
from app.services.classwork.ClassworkShared import (
    assignment_is_locked,
    is_quiz_type,
    normalize_classwork_type,
)
from app.services.intervention.RemediationPrerequisiteService import (
    require_remediation_prerequisite,
)


MANILA = ZoneInfo("Asia/Manila")
REMINDER_WINDOW = timedelta(hours=24)
SUBMITTABLE_CLASSWORK_TYPES = frozenset({"ASSIGNMENT", "ACTIVITY", "QUIZ"})
SUBMITTED_STATUSES = frozenset({"submitted", "late", "graded", "returned"})

_ASSIGNMENT_LOCKS_GUARD = threading.Lock()
_ASSIGNMENT_LOCKS: dict[tuple[int, int], threading.Lock] = {}


def _utc(value: datetime | None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)


def _assignment_lock(db: Session, assignment_id: int) -> threading.Lock:
    bind = db.get_bind()
    key = (id(bind), assignment_id)
    with _ASSIGNMENT_LOCKS_GUARD:
        lock = _ASSIGNMENT_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _ASSIGNMENT_LOCKS[key] = lock
        return lock


def classwork_deadline_action_url(assignment_id: int, due_at: datetime) -> str:
    """Direct student classwork link keyed by UTC due timestamp for safe dedup across edits."""
    due_token = _utc(due_at).strftime("%Y%m%dT%H%M%SZ")
    return f"/student/classworks/{assignment_id}?due={due_token}"


def _format_manila_due_datetime(due_at: datetime) -> str:
    local_due = _utc(due_at).astimezone(MANILA)
    date_part = local_due.strftime("%b %d, %Y").replace(" 0", " ")
    time_part = local_due.strftime("%I:%M %p").lstrip("0")
    return f"{date_part} at {time_part}"


def _is_submittable_classwork(classwork: Classwork) -> bool:
    cw_type = normalize_classwork_type(classwork.classwork_type or "")
    if cw_type not in SUBMITTABLE_CLASSWORK_TYPES:
        return False
    if cw_type == "ACTIVITY" and (classwork.activity_mode or "").strip().upper() == "MANUAL":
        return False
    return True


def _student_has_submitted(
    submissions: list[StudentSubmission],
    *,
    is_quiz: bool = False,
    quiz_answered_submission_ids: set[int] | None = None,
) -> bool:
    answered_ids = quiz_answered_submission_ids or set()
    for submission in submissions:
        status = (submission.status or "").strip().lower()
        if submission.submitted_at is not None or status in SUBMITTED_STATUSES:
            return True
        # QuizAttemptService.start_quiz_attempt resets status="pending" and submitted_at=None
        # when a student begins a retake, while retaining attempt_count >= 1 AND the prior
        # attempt's QuizAnswer rows. A pending row with attempt_count > 0 but no submitted
        # QuizAnswer rows is NOT a completed submission.
        if (
            is_quiz
            and (submission.attempt_count or 0) > 0
            and submission.submission_id in answered_ids
        ):
            return True
    return False


def _assignment_window_state(
    assignment: ClassworkAssignment,
    now: datetime,
) -> tuple[str, datetime | None]:
    classwork = assignment.classwork
    if (
        classwork is None
        or not assignment.is_published
        or assignment.is_locked
        or not classwork.is_published
        or classwork.is_locked
        or classwork.is_archived
        or not _is_submittable_classwork(classwork)
        or assignment_is_locked(assignment, now)
        or assignment.due_date is None
    ):
        return "ineligible", None

    due_at = _utc(assignment.due_date)
    if due_at <= now:
        return "ineligible", None
    if due_at > now + REMINDER_WINDOW:
        return "not_due", None
    return "eligible", due_at


def _eligible_students_for_assignment(
    db: Session,
    assignment: ClassworkAssignment,
) -> list[tuple[Student, UserAccount]]:
    class_row = db.get(Class, assignment.class_id)
    if class_row is None:
        return []

    period = (
        db.get(AcademicPeriod, assignment.academic_period_id)
        if assignment.academic_period_id is not None
        else None
    )
    if assignment.academic_period_id is not None:
        if period is None:
            return []
        if (
            class_row.academic_year_id is not None
            and period.academic_year_id is not None
            and class_row.academic_year_id != period.academic_year_id
        ):
            return []

    enrollment_query = (
        db.query(Student, UserAccount)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .join(UserAccount, UserAccount.user_id == Student.user_id)
        .filter(
            StudentClass.class_id == assignment.class_id,
            func.lower(StudentClass.enrollment_status) == "enrolled",
            func.lower(UserAccount.account_status) == "active",
        )
    )
    if class_row.academic_year_id is not None:
        enrollment_query = enrollment_query.filter(
            StudentClass.academic_year_id == class_row.academic_year_id,
        )
    if assignment.recipient_student_id is not None:
        enrollment_query = enrollment_query.filter(
            Student.student_id == assignment.recipient_student_id,
        )

    rows = enrollment_query.distinct().all()
    return [
        (student, account)
        for student, account in rows
        if assignment_allows_student(assignment, student.student_id)
    ]


def _process_assignment(
    db: Session,
    assignment: ClassworkAssignment,
    now: datetime,
    result: dict[str, int],
) -> None:
    state, due_at = _assignment_window_state(assignment, now)
    if state != "eligible" or due_at is None:
        result[state] += 1
        return

    classwork = assignment.classwork
    recipients = _eligible_students_for_assignment(db, assignment)
    if not recipients:
        result["ineligible"] += 1
        return

    student_ids = [student.student_id for student, _account in recipients]
    user_ids = [account.user_id for _student, account in recipients]

    submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id,
            StudentSubmission.student_id.in_(student_ids),
        )
        .all()
    )
    submissions_by_student: dict[object, list[StudentSubmission]] = {}
    for submission in submissions:
        submissions_by_student.setdefault(submission.student_id, []).append(submission)

    is_quiz = is_quiz_type(classwork.classwork_type)
    quiz_answered_submission_ids: set[int] = set()
    if is_quiz and submissions:
        submission_ids = [submission.submission_id for submission in submissions]
        quiz_answered_submission_ids = {
            row[0]
            for row in db.query(QuizAnswer.submission_id)
            .filter(QuizAnswer.submission_id.in_(submission_ids))
            .distinct()
            .all()
        }

    finalized_student_ids: set[object] = set()
    if assignment.academic_period_id is not None:
        finalized_rows = (
            db.query(StudentPeriodGrade.student_id)
            .filter(
                StudentPeriodGrade.student_id.in_(student_ids),
                StudentPeriodGrade.class_id == assignment.class_id,
                StudentPeriodGrade.subject_id == classwork.subject_id,
                StudentPeriodGrade.academic_period_id == assignment.academic_period_id,
                StudentPeriodGrade.is_finalized.is_(True),
            )
            .all()
        )
        finalized_student_ids = {row[0] for row in finalized_rows}

    action_url = classwork_deadline_action_url(assignment.classwork_assignment_id, due_at)
    existing_user_ids = {
        row[0]
        for row in db.query(Notification.user_id)
        .filter(
            Notification.user_id.in_(user_ids),
            Notification.notification_type == "classwork_due_soon",
            Notification.action_url == action_url,
        )
        .all()
    }

    subject_name = classwork.subject.subject_name if classwork.subject else "Subject"
    subject_and_title = _format_subject_prefixed_title(subject_name, classwork.title)
    due_label = _format_manila_due_datetime(due_at)
    body = f"{subject_and_title} is due on {due_label}."

    for student, account in recipients:
        if student.student_id in finalized_student_ids:
            result["ineligible"] += 1
            continue
        if assignment.source_intervention_id is not None:
            try:
                require_remediation_prerequisite(db, assignment, student)
            except HTTPException:
                result["ineligible"] += 1
                continue
        if _student_has_submitted(
            submissions_by_student.get(student.student_id, []),
            is_quiz=is_quiz,
            quiz_answered_submission_ids=quiz_answered_submission_ids,
        ):
            result["already_submitted"] += 1
            continue
        if account.user_id in existing_user_ids:
            result["duplicate"] += 1
            continue

        stage_notification(
            db,
            NotificationCreate(
                user_id=account.user_id,
                notification_type="classwork_due_soon",
                title="Classwork Due Soon",
                body=body,
                action_url=action_url,
            ),
        )
        existing_user_ids.add(account.user_id)
        result["sent"] += 1


def scan_classwork_deadline_reminders(
    db: Session,
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, int]:
    """Process one bounded batch of 24-hour classwork deadline reminders."""
    current = _utc(now)
    horizon = current + REMINDER_WINDOW
    result: dict[str, int] = {
        "scanned_assignments": 0,
        "sent": 0,
        "already_submitted": 0,
        "duplicate": 0,
        "ineligible": 0,
        "not_due": 0,
        "failed": 0,
    }

    candidate_query = (
        db.query(ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.due_date.isnot(None),
            ClassworkAssignment.is_published.is_(True),
            ClassworkAssignment.is_locked.is_(False),
            Classwork.is_published.is_(True),
            Classwork.is_locked.is_(False),
            Classwork.is_archived.is_(False),
        )
    )
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        candidate_query = candidate_query.filter(
            ClassworkAssignment.due_date > current,
            ClassworkAssignment.due_date <= horizon,
        )

    candidate_ids = [
        row[0]
        for row in candidate_query
        .order_by(ClassworkAssignment.due_date.asc(), ClassworkAssignment.classwork_assignment_id.asc())
        .limit(max(1, min(limit, 1000)))
        .all()
    ]

    for assignment_id in candidate_ids:
        lock = _assignment_lock(db, assignment_id)
        with lock:
            try:
                assignment = (
                    db.query(ClassworkAssignment)
                    .options(joinedload(ClassworkAssignment.classwork).joinedload(Classwork.subject))
                    .filter_by(classwork_assignment_id=assignment_id)
                    .populate_existing()
                    .with_for_update(of=ClassworkAssignment, skip_locked=True)
                    .one_or_none()
                )
                if assignment is None:
                    db.rollback()
                    continue
                result["scanned_assignments"] += 1
                _process_assignment(db, assignment, current, result)
                db.commit()
            except Exception:
                db.rollback()
                result["failed"] += 1

    return result


def run_classwork_deadline_reminder_scan(
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, int]:
    """Create and close a database session for cron or another periodic scheduler."""
    from app.db.Session import SessionLocal

    db = SessionLocal()
    try:
        return scan_classwork_deadline_reminders(db, now=now, limit=limit)
    finally:
        db.close()


if __name__ == "__main__":
    scan_result = run_classwork_deadline_reminder_scan()
    print(json.dumps(scan_result, sort_keys=True))
    raise SystemExit(1 if scan_result["failed"] else 0)
