"""Durable, scheduler-friendly Study Support notification processing."""

from __future__ import annotations

import json
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import String, and_, cast, exists, literal, or_
from sqlalchemy.orm import Session, joinedload

import app.models  # noqa: F401 - load the full mapper registry for standalone runs
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.notifications.Notification import Notification
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Notification import NotificationCreate
from app.services.NotificationService import stage_notification
from app.services.classwork.ClassworkShared import assignment_is_locked, aware_utc


MANILA = ZoneInfo("Asia/Manila")
FIRST_REMINDER_AFTER = timedelta(hours=48)
FINAL_REMINDER_AFTER = timedelta(days=5)
DELIVERY_START = time(8, 0)
DELIVERY_END = time(17, 0)


def study_support_action_url(assignment: ClassworkAssignment) -> str:
    return_path = (
        "%2Fstudent%2Finterventions%2Fview%3Fintervention%3D"
        f"{assignment.source_intervention_id}"
    )
    return (
        f"/student/classworks/{assignment.classwork_assignment_id}"
        f"?from={return_path}"
    )


def _utc(value: datetime | None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)


def within_manila_school_hours(now: datetime) -> bool:
    local = _utc(now).astimezone(MANILA)
    return local.weekday() < 5 and DELIVERY_START <= local.time().replace(tzinfo=None) < DELIVERY_END


def stage_study_support_available(
    db: Session,
    assignment: ClassworkAssignment,
    classwork: Classwork,
    subject_id: int,
    *,
    now: datetime | None = None,
) -> bool:
    """Stage the initial student notification and persist its publication anchor."""
    assignment = db.query(ClassworkAssignment).filter_by(
        classwork_assignment_id=assignment.classwork_assignment_id,
    ).populate_existing().with_for_update().one_or_none()
    if assignment is None or (
        assignment.recipient_student_id is None
        or assignment.source_intervention_id is None
        or not assignment.is_published
        or not classwork.is_published
        or classwork.is_archived
        or classwork.subject_id != subject_id
    ):
        return False

    student = db.get(Student, assignment.recipient_student_id)
    account = db.get(UserAccount, student.user_id) if student and student.user_id else None
    if account is None or account.account_status != "active":
        return False

    action_url = study_support_action_url(assignment)
    existing = db.query(Notification).filter_by(
        user_id=account.user_id,
        notification_type="study_support_available",
        action_url=action_url,
    ).first()
    if assignment.publish_date is None:
        assignment.publish_date = aware_utc(existing.created_at) if existing and existing.created_at else _utc(now)
    if existing is not None:
        return False

    subject_name = classwork.subject.subject_name if classwork.subject else "your subject"
    stage_notification(db, NotificationCreate(
        user_id=account.user_id,
        notification_type="study_support_available",
        title="New Study Support Available",
        body=f"New Study Support for {subject_name} is ready for you.",
        action_url=action_url,
    ))
    return True


def _publication_anchor(
    db: Session,
    assignment: ClassworkAssignment,
    user_id,
    action_url: str,
) -> datetime | None:
    if assignment.publish_date is not None:
        return aware_utc(assignment.publish_date)
    initial = db.query(Notification.created_at).filter_by(
        user_id=user_id,
        notification_type="study_support_available",
        action_url=action_url,
    ).first()
    return aware_utc(initial[0]) if initial and initial[0] else None


def _student_can_receive_reminder(
    db: Session,
    assignment: ClassworkAssignment,
    now: datetime,
) -> tuple[UserAccount, Intervention] | None:
    classwork = assignment.classwork
    if (
        assignment.recipient_student_id is None
        or assignment.source_intervention_id is None
        or not assignment.is_published
        or assignment.is_locked
        or classwork is None
        or not classwork.is_published
        or classwork.is_locked
        or classwork.is_archived
        or assignment_is_locked(assignment, now)
    ):
        return None
    due_at = aware_utc(assignment.due_date)
    if due_at is not None and now > due_at and not assignment.allow_late_submissions:
        return None

    intervention = db.get(Intervention, assignment.source_intervention_id)
    if intervention is None or intervention.status != "ACTIVE" or (
        intervention.student_id != assignment.recipient_student_id
        or intervention.class_id != assignment.class_id
        or intervention.subject_id != classwork.subject_id
        or intervention.academic_period_id != assignment.academic_period_id
    ):
        return None

    student = db.get(Student, assignment.recipient_student_id)
    account = db.get(UserAccount, student.user_id) if student and student.user_id else None
    if account is None or account.account_status != "active":
        return None

    class_row = db.get(Class, assignment.class_id)
    period = db.get(AcademicPeriod, assignment.academic_period_id)
    if class_row is None or period is None or class_row.academic_year_id != period.academic_year_id:
        return None
    enrolled = db.query(StudentClass.student_class_id).filter_by(
        student_id=student.student_id,
        class_id=assignment.class_id,
        academic_year_id=period.academic_year_id,
        enrollment_status="enrolled",
    ).first()
    if enrolled is None:
        return None

    if db.query(StudentPeriodGrade.period_grade_id).filter_by(
        student_id=student.student_id,
        class_id=assignment.class_id,
        subject_id=classwork.subject_id,
        academic_period_id=assignment.academic_period_id,
        is_finalized=True,
    ).first() is not None:
        return None

    required_submission = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=assignment.classwork_assignment_id,
        student_id=student.student_id,
    ).order_by(StudentSubmission.submission_id.desc()).first()
    if required_submission is not None and (
        required_submission.submitted_at is not None
        or (required_submission.status or "").lower() in {"submitted", "late", "graded", "returned"}
    ):
        return None
    return account, intervention


def _stage_due_reminder(db: Session, assignment: ClassworkAssignment, now: datetime) -> str:
    recipient = _student_can_receive_reminder(db, assignment, now)
    if recipient is None:
        return "ineligible"
    account, _intervention = recipient
    action_url = study_support_action_url(assignment)
    published_at = _publication_anchor(db, assignment, account.user_id, action_url)
    if published_at is None or now < published_at + FIRST_REMINDER_AFTER:
        return "not_due"
    if assignment.publish_date is None:
        assignment.publish_date = published_at

    if now >= published_at + FINAL_REMINDER_AFTER:
        notification_type = "study_support_final_reminder"
        title = "Final Study Support Reminder"
        body = f"Your Study Support for {assignment.classwork.subject.subject_name} is still available."
    else:
        notification_type = "study_support_reminder"
        title = "Study Support Reminder"
        body = f"Your Study Support for {assignment.classwork.subject.subject_name} is ready when you are."

    if db.query(Notification.notification_id).filter_by(
        user_id=account.user_id,
        notification_type=notification_type,
        action_url=action_url,
    ).first() is not None:
        return "duplicate"
    stage_notification(db, NotificationCreate(
        user_id=account.user_id,
        notification_type=notification_type,
        title=title,
        body=body,
        action_url=action_url,
    ))
    return "sent"


def scan_study_support_reminders(
    db: Session,
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, int | bool]:
    """Process one bounded reminder batch; safe to invoke from a periodic scheduler."""
    current = _utc(now)
    result: dict[str, int | bool] = {
        "outside_delivery_window": False,
        "scanned": 0,
        "sent": 0,
        "not_due": 0,
        "ineligible": 0,
        "duplicate": 0,
        "failed": 0,
    }
    if not within_manila_school_hours(current):
        result["outside_delivery_window"] = True
        return result

    first_cutoff = current - FIRST_REMINDER_AFTER
    final_cutoff = current - FINAL_REMINDER_AFTER
    action_url_expression = (
        literal("/student/classworks/")
        + cast(ClassworkAssignment.classwork_assignment_id, String)
        + literal("?from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D")
        + cast(ClassworkAssignment.source_intervention_id, String)
    )

    def notification_exists(notification_type: str):
        return exists().where(
            Notification.user_id == Student.user_id,
            Notification.notification_type == notification_type,
            Notification.action_url == action_url_expression,
        )

    candidate_ids = [row[0] for row in (
        db.query(ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(Student, Student.student_id == ClassworkAssignment.recipient_student_id)
        .filter(
            ClassworkAssignment.recipient_student_id.isnot(None),
            ClassworkAssignment.source_intervention_id.isnot(None),
            ClassworkAssignment.is_published.is_(True),
            Classwork.is_published.is_(True),
            Classwork.is_archived.is_(False),
            or_(
                and_(
                    ClassworkAssignment.publish_date.is_(None),
                    notification_exists("study_support_available"),
                ),
                and_(
                    ClassworkAssignment.publish_date <= final_cutoff,
                    ~notification_exists("study_support_final_reminder"),
                ),
                and_(
                    ClassworkAssignment.publish_date > final_cutoff,
                    ClassworkAssignment.publish_date <= first_cutoff,
                    ~notification_exists("study_support_reminder"),
                ),
            ),
        )
        .order_by(ClassworkAssignment.classwork_assignment_id.asc())
        .limit(max(1, min(limit, 1000)))
        .all()
    )]

    for assignment_id in candidate_ids:
        try:
            assignment = (
                db.query(ClassworkAssignment)
                .options(joinedload(ClassworkAssignment.classwork).joinedload(Classwork.subject))
                .filter_by(classwork_assignment_id=assignment_id)
                .populate_existing()
                .with_for_update(skip_locked=True)
                .one_or_none()
            )
            if assignment is None:
                db.rollback()
                continue
            result["scanned"] = int(result["scanned"]) + 1
            outcome = _stage_due_reminder(db, assignment, current)
            result[outcome] = int(result[outcome]) + 1
            db.commit()
        except Exception:
            db.rollback()
            result["failed"] = int(result["failed"]) + 1
    return result


def run_study_support_reminder_scan(*, now: datetime | None = None, limit: int = 100) -> dict[str, int | bool]:
    """Create and close a database session for cron or another periodic scheduler."""
    from app.db.Session import SessionLocal

    db = SessionLocal()
    try:
        return scan_study_support_reminders(db, now=now, limit=limit)
    finally:
        db.close()


if __name__ == "__main__":
    scan_result = run_study_support_reminder_scan()
    print(json.dumps(scan_result, sort_keys=True))
    raise SystemExit(1 if scan_result["failed"] else 0)
