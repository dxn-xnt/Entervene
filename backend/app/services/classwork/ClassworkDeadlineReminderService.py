"""Durable deadline reminders invoked by the external reminder runner."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import uuid
from sqlalchemy.orm import Session, joinedload

from app.models.academic.StudentCLass import StudentClass
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.notifications.Notification import Notification
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Notification import NotificationCreate
from app.services.NotificationService import stage_notification
from app.services.classwork.ClassworkAccessService import assignment_allows_student

_NAMESPACE = uuid.UUID("17ebee51-bc0e-4bfd-afbc-f73e7b8332d2")
_DONE = {"submitted", "graded", "late", "completed"}


def _utc(value: datetime | None) -> datetime:
    value = value or datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def scan_classwork_deadline_reminders(db: Session, *, now: datetime | None = None, limit: int = 100) -> dict[str, int]:
    current = _utc(now)
    result = {"scanned_assignments": 0, "sent": 0, "already_submitted": 0,
              "duplicate": 0, "ineligible": 0, "not_due": 0, "failed": 0}
    ids = [row[0] for row in db.query(ClassworkAssignment.classwork_assignment_id).join(
        Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id,
    ).filter(
        ClassworkAssignment.is_published.is_(True),
        ClassworkAssignment.due_date.between(current - timedelta(days=30), current + timedelta(hours=24)),
        Classwork.is_published.is_(True), Classwork.is_archived.is_(False),
    ).order_by(ClassworkAssignment.classwork_assignment_id).limit(max(1, min(limit, 1000))).all()]
    for assignment_id in ids:
        try:
            assignment = db.query(ClassworkAssignment).options(
                joinedload(ClassworkAssignment.classwork).joinedload(Classwork.subject),
            ).filter_by(classwork_assignment_id=assignment_id).with_for_update(skip_locked=True).one_or_none()
            if assignment is None:
                db.rollback()
                continue
            result["scanned_assignments"] += 1
            due = _utc(assignment.due_date)
            if current > due:
                event_type, title = "classwork_overdue", "Overdue"
            elif current.date() == due.date():
                event_type, title = "classwork_due_today", "Deadline Reminder"
            else:
                event_type, title = "classwork_due_soon", "Deadline Reminder"
            for enrollment in db.query(StudentClass).filter_by(
                class_id=assignment.class_id, enrollment_status="enrolled",
            ).all():
                student_id = enrollment.student_id
                if not assignment_allows_student(assignment, student_id):
                    result["ineligible"] += 1
                    continue
                if db.query(StudentSubmission.submission_id).filter(
                    StudentSubmission.classwork_assignment_id == assignment_id,
                    StudentSubmission.student_id == student_id,
                    StudentSubmission.status.in_(_DONE),
                ).first():
                    result["already_submitted"] += 1
                    continue
                student = db.get(Student, student_id)
                account = db.get(UserAccount, student.user_id) if student and student.user_id else None
                if account is None or account.account_status != "active":
                    result["ineligible"] += 1
                    continue
                notification_id = uuid.uuid5(
                    _NAMESPACE, f"{assignment_id}:{student_id}:{event_type}:{due.isoformat()}",
                )
                if db.get(Notification, notification_id) is not None:
                    result["duplicate"] += 1
                    continue
                subject = assignment.classwork.subject.subject_name if assignment.classwork.subject else "Classwork"
                stage_notification(db, NotificationCreate(
                    notification_id=notification_id, user_id=account.user_id,
                    notification_type=event_type, title=title,
                    body=f"{subject}: {assignment.classwork.title}. Deadline: {due.strftime('%b %d, %Y at %H:%M UTC')}.",
                    action_url=f"/student/classworks/{assignment_id}",
                ))
                result["sent"] += 1
            db.commit()
        except Exception:
            db.rollback()
            result["failed"] += 1
    return result


def run_classwork_deadline_reminder_scan(*, now: datetime | None = None, limit: int = 100) -> dict[str, int]:
    from app.db.Session import SessionLocal
    db = SessionLocal()
    try:
        return scan_classwork_deadline_reminders(db, now=now, limit=limit)
    finally:
        db.close()


if __name__ == "__main__":
    print(json.dumps(run_classwork_deadline_reminder_scan(), sort_keys=True))
