"""Durable, idempotent student notifications for quiz-results release."""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy.orm import Session, joinedload

from app.models.academic.StudentCLass import StudentClass
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.notifications.Notification import Notification
from app.models.people.Student import Student
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Notification import NotificationCreate
from app.services.NotificationService import stage_notification
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.quiz.QuizResultsReleasePolicy import quiz_results_are_visible


_RESULT_EVENT_NAMESPACE = uuid.UUID("5e41a2a8-c497-4f51-b938-f214844a8a14")
_COMPLETED = {"submitted", "graded", "late", "completed"}


def _utc(value: datetime | None) -> datetime:
    current = value or datetime.now(timezone.utc)
    return current if current.tzinfo else current.replace(tzinfo=timezone.utc)


def _event_marker(setting: QuizSetting, assignment: ClassworkAssignment) -> str:
    mode = (setting.summary_release_mode or "").strip().upper()
    boundary = assignment.due_date if mode == "AFTER_DUE_DATE" else setting.summary_release_at
    normalized = _utc(boundary).isoformat() if boundary is not None else mode
    return f"{mode}:{normalized}"


def _notification_id(assignment_id: int, student_id, marker: str) -> uuid.UUID:
    return uuid.uuid5(
        _RESULT_EVENT_NAMESPACE,
        f"quiz-results:{assignment_id}:{student_id}:{marker}",
    )


def _stage_for_assignment(
    db: Session,
    assignment: ClassworkAssignment,
    setting: QuizSetting,
    *,
    now: datetime,
) -> int:
    classwork = assignment.classwork
    submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id,
            StudentSubmission.status.in_(_COMPLETED),
        )
        .order_by(StudentSubmission.student_id, StudentSubmission.submission_id.desc())
        .all()
    )
    latest_by_student = {}
    for submission in submissions:
        latest_by_student.setdefault(submission.student_id, submission)

    sent = 0
    marker = _event_marker(setting, assignment)
    for student_id, submission in latest_by_student.items():
        if not assignment_allows_student(assignment, student_id):
            continue
        if not db.query(StudentClass.student_class_id).filter_by(
            student_id=student_id,
            class_id=assignment.class_id,
            enrollment_status="enrolled",
        ).first():
            continue
        if not quiz_results_are_visible(
            classwork,
            setting,
            assignment,
            submission_status=submission.status,
            now=now,
        ):
            continue
        student = db.get(Student, student_id)
        account = db.get(UserAccount, student.user_id) if student and student.user_id else None
        if account is None or account.account_status != "active":
            continue
        notification_id = _notification_id(
            assignment.classwork_assignment_id,
            student_id,
            marker,
        )
        if db.get(Notification, notification_id) is not None:
            continue
        subject_name = classwork.subject.subject_name if classwork.subject else "your subject"
        stage_notification(db, NotificationCreate(
            notification_id=notification_id,
            user_id=account.user_id,
            notification_type="quiz_results_available",
            title="Quiz Results Available",
            body=f"Results for {subject_name}: {classwork.title} are now available.",
            action_url=f"/student/quiz/{assignment.classwork_assignment_id}/result",
        ))
        sent += 1
    return sent


def stage_available_results_for_classwork(
    db: Session,
    classwork_id: int,
    *,
    now: datetime | None = None,
) -> int:
    """Stage currently visible results, used after an explicit teacher release."""
    current = _utc(now)
    setting = db.query(QuizSetting).filter_by(classwork_id=classwork_id).first()
    if setting is None:
        return 0
    assignments = (
        db.query(ClassworkAssignment)
        .options(joinedload(ClassworkAssignment.classwork).joinedload(Classwork.subject))
        .filter_by(classwork_id=classwork_id, is_published=True)
        .all()
    )
    return sum(
        _stage_for_assignment(db, assignment, setting, now=current)
        for assignment in assignments
    )


def scan_due_quiz_result_releases(
    db: Session,
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, int]:
    """Recover due scheduled/after-due releases using database state and row locks."""
    current = _utc(now)
    setting_ids = [row[0] for row in (
        db.query(QuizSetting.quiz_setting_id)
        .join(Classwork, Classwork.classwork_id == QuizSetting.classwork_id)
        .filter(
            Classwork.show_scores.is_(True),
            Classwork.is_archived.is_(False),
            QuizSetting.show_correct_answers.is_(True),
            QuizSetting.summary_release_mode.in_(("SCHEDULED", "AFTER_DUE_DATE")),
        )
        .order_by(QuizSetting.quiz_setting_id)
        .limit(max(1, min(limit, 1000)))
        .all()
    )]
    result = {"scanned": 0, "sent": 0, "failed": 0}
    for setting_id in setting_ids:
        try:
            setting = (
                db.query(QuizSetting)
                .filter_by(quiz_setting_id=setting_id)
                .with_for_update(skip_locked=True)
                .one_or_none()
            )
            if setting is None:
                db.rollback()
                continue
            result["scanned"] += 1
            result["sent"] += stage_available_results_for_classwork(
                db,
                setting.classwork_id,
                now=current,
            )
            db.commit()
        except Exception:
            db.rollback()
            result["failed"] += 1
    return result


def run_quiz_result_release_scan(*, now: datetime | None = None, limit: int = 100) -> dict[str, int]:
    from app.db.Session import SessionLocal

    db = SessionLocal()
    try:
        return scan_due_quiz_result_releases(db, now=now, limit=limit)
    finally:
        db.close()
