"""
TeacherSubmissionNotificationService.py

Dynamic generation and synchronization of teacher submission notifications.
Aggregates ungraded student submissions for allowed classworks (assignment, activity, intervention),
excluding quizzes, exams, readings, and announcements.

Constraints:
- Exactly one submission notification per classwork.
- Updates existing notification on new submissions (count, date, unread status).
- Removes/deletes notification when no submissions remain to be graded.
- Template Title: "{subject.name}: {classwork.title} - {count} new submission(s)"
- Template Description: "{count} new student classwork submission(s) needs to be graded as of {date}"
- Singular when count is 1.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.submissions.StudentSubmission import StudentSubmission

ALLOWED_CLASSWORK_TYPES = {"ASSIGNMENT", "ACTIVITY"}
SUBMISSION_NOTIFICATION_TYPE = "submission"


def _format_date(dt: datetime) -> str:
    """Format date to 'MMM D, YYYY' without leading zero on day (e.g. 'Nov 23, 2026')."""
    month = dt.strftime("%b")
    day = dt.day
    year = dt.year
    return f"{month} {day}, {year}"


def _format_title(subject_name: str, classwork_title: str, count: int) -> str:
    suffix = "1 new submission" if count == 1 else f"{count} new submissions"
    return f"{subject_name}: {classwork_title} - {suffix}"


def _format_body(count: int, date_str: str) -> str:
    if count == 1:
        return f"1 new student classwork submission needs to be graded as of {date_str}"
    return f"{count} new student classwork submissions needs to be graded as of {date_str}"


def is_allowed_submission_classwork(classwork: Classwork) -> bool:
    """Check if classwork type is assignment, activity, or intervention."""
    if classwork.is_archived:
        return False
    c_type = (classwork.classwork_type or "").strip().upper()
    is_intervention = classwork.intervention_resource_origin_id is not None

    if is_intervention:
        # Interventions can be assignments or activities; exclude quizzes/readings
        return c_type in ALLOWED_CLASSWORK_TYPES or c_type not in ("QUIZ", "READING")

    # Exclude exams
    if classwork.exam_subtype is not None:
        return False

    return c_type in ALLOWED_CLASSWORK_TYPES


def check_and_generate_teacher_submission_notifications(
    db: Session,
    user_id: UUID | str,
) -> list[Notification]:
    """
    Check all active classworks for the teacher and generate/update/remove
    dynamic submission notifications.
    """
    if isinstance(user_id, str):
        try:
            user_uuid = UUID(user_id)
        except ValueError:
            return []
    else:
        user_uuid = user_id

    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_uuid).first()
    if not staff:
        return []

    # Get all non-archived classworks created by this teacher
    classworks = (
        db.query(Classwork)
        .filter(
            Classwork.created_by_staff_id == staff.staff_id,
            Classwork.is_archived == False,  # noqa: E712
        )
        .all()
    )

    created_or_updated: list[Notification] = []

    for cw in classworks:
        action_url = f"/teacher/classworks/{cw.classwork_id}"

        # If classwork is not an allowed type, clean up any stale notification
        if not is_allowed_submission_classwork(cw):
            stale = (
                db.query(Notification)
                .filter(
                    Notification.user_id == user_uuid,
                    Notification.notification_type == SUBMISSION_NOTIFICATION_TYPE,
                    Notification.action_url == action_url,
                )
                .first()
            )
            if stale:
                db.delete(stale)
            continue

        # Find assignments for this classwork
        assignments = (
            db.query(ClassworkAssignment)
            .filter(ClassworkAssignment.classwork_id == cw.classwork_id)
            .all()
        )
        if not assignments:
            stale = (
                db.query(Notification)
                .filter(
                    Notification.user_id == user_uuid,
                    Notification.notification_type == SUBMISSION_NOTIFICATION_TYPE,
                    Notification.action_url == action_url,
                )
                .first()
            )
            if stale:
                db.delete(stale)
            continue

        assignment_ids = [a.classwork_assignment_id for a in assignments]

        # Find all submissions for these assignments
        all_subs = (
            db.query(StudentSubmission)
            .filter(StudentSubmission.classwork_assignment_id.in_(assignment_ids))
            .all()
        )

        # Count submissions awaiting grading: status turned in and grade is None
        ungraded_subs = [
            s
            for s in all_subs
            if s.status in ("submitted", "late") and s.grade is None
        ]
        ungraded_count = len(ungraded_subs)

        existing = (
            db.query(Notification)
            .filter(
                Notification.user_id == user_uuid,
                Notification.notification_type == SUBMISSION_NOTIFICATION_TYPE,
                Notification.action_url == action_url,
            )
            .first()
        )

        # When no submissions remain to be graded, remove from Submissions tab
        if ungraded_count == 0:
            if existing:
                db.delete(existing)
            continue

        # Has submissions awaiting grading: construct templates
        latest_sub = max(
            ungraded_subs,
            key=lambda s: s.submitted_at or datetime.min.replace(tzinfo=timezone.utc),
        )
        latest_at = latest_sub.submitted_at or datetime.now(timezone.utc)
        date_str = _format_date(latest_at)

        subject = db.query(Subject).filter_by(subject_id=cw.subject_id).first()
        subject_name = subject.subject_name if subject else "Classwork"

        title = _format_title(subject_name, cw.title, ungraded_count)
        body = _format_body(ungraded_count, date_str)

        if existing:
            existing.title = title
            existing.body = body
            # If the notification was already read and new submissions arrive, mark it unread again
            if existing.read_at and latest_at > existing.read_at:
                existing.is_read = False
                existing.read_at = None
            existing.created_at = latest_at
            created_or_updated.append(existing)
        else:
            notif = Notification(
                notification_id=uuid.uuid4(),
                user_id=user_uuid,
                notification_type=SUBMISSION_NOTIFICATION_TYPE,
                title=title,
                body=body,
                action_url=action_url,
                is_read=False,
                created_at=latest_at,
                read_at=None,
            )
            db.add(notif)
            created_or_updated.append(notif)

    db.commit()
    return created_or_updated


def sync_teacher_submission_notifications_for_classwork(
    db: Session,
    classwork_id: int,
) -> Optional[list[Notification]]:
    """Synchronize submission notification for a specific classwork's teacher."""
    classwork = db.query(Classwork).filter_by(classwork_id=classwork_id).first()
    if not classwork:
        return None
    staff = db.query(AcademicStaff).filter_by(staff_id=classwork.created_by_staff_id).first()
    if not staff or not staff.user_id:
        return None
    return check_and_generate_teacher_submission_notifications(db, staff.user_id)


def sync_teacher_submission_notifications_for_assignment(
    db: Session,
    assignment_id: int,
) -> Optional[list[Notification]]:
    """Synchronize submission notification for an assignment's classwork."""
    assignment = db.query(ClassworkAssignment).filter_by(classwork_assignment_id=assignment_id).first()
    if not assignment:
        return None
    return sync_teacher_submission_notifications_for_classwork(db, assignment.classwork_id)
