"""
GradeSubmissionNotificationService.py

Service for checking and generating grade submission window notifications for teachers:
1. Window Opened: Triggered when today >= period.end_date - 7 days.
2. Closing Soon: Triggered when today >= period.end_date + 5 days (2 days before close)
   if any student in the teacher's load is not yet finalized.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff


GRADE_SUBMISSION_WINDOW_DAYS = 7
GRADE_SUBMISSION_CLOSING_WARNING_DAYS = 2

GRADE_SUBMISSION_WINDOW_OPENED_TYPE = "grade_submission_window_opened"
GRADE_SUBMISSION_CLOSING_SOON_TYPE = "grade_submission_closing_soon"


def build_grade_submission_action_url(academic_period_id: int) -> str:
    """Canonical action URL for grade submission notifications."""
    return f"/teacher/grades?academic_period_id={academic_period_id}"


def check_and_generate_grade_submission_notifications(
    db: Session,
    user_id: UUID | str,
    as_of_date: Optional[date] = None,
) -> list[Notification]:
    """
    Check academic period timing and student finalization status for a teacher,
    generating "Window Opened" and "Closing Soon" notifications if applicable.
    
    Dedup is strictly scoped to (user_id, academic_period_id, notification_type).
    """
    if isinstance(user_id, str):
        user_uuid = UUID(user_id)
    else:
        user_uuid = user_id

    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_uuid).first()
    if not staff:
        return []

    today = as_of_date or date.today()
    created_notifications: list[Notification] = []

    periods = db.query(AcademicPeriod).all()

    for period in periods:
        if not period.end_date:
            continue

        end_d = period.end_date
        if isinstance(end_d, str):
            end_d = date.fromisoformat(end_d)
        elif isinstance(end_d, datetime):
            end_d = end_d.date()

        open_date = end_d - timedelta(days=GRADE_SUBMISSION_WINDOW_DAYS)
        close_date = end_d + timedelta(days=GRADE_SUBMISSION_WINDOW_DAYS)
        closing_soon_date = end_d + timedelta(
            days=GRADE_SUBMISSION_WINDOW_DAYS - GRADE_SUBMISSION_CLOSING_WARNING_DAYS
        )

        # Skip if today is outside the overall submission window [open_date, close_date]
        if today < open_date or today > close_date:
            continue

        # Check if teacher has active subject loads in this period
        loads = (
            db.query(SubjectLoad)
            .filter(
                SubjectLoad.staff_id == staff.staff_id,
                SubjectLoad.academic_period_id == period.academic_period_id,
            )
            .all()
        )
        if not loads:
            continue

        action_url = build_grade_submission_action_url(period.academic_period_id)

        # ----------------------------------------------------------------------
        # 1. Window Opened Notification
        # ----------------------------------------------------------------------
        if today >= open_date:
            existing_opened = (
                db.query(Notification)
                .filter(
                    Notification.user_id == user_uuid,
                    Notification.notification_type == GRADE_SUBMISSION_WINDOW_OPENED_TYPE,
                    Notification.action_url == action_url,
                )
                .first()
            )
            if not existing_opened:
                formatted_close = close_date.strftime("%B %d, %Y")
                notif = Notification(
                    notification_id=uuid.uuid4(),
                    user_id=user_uuid,
                    notification_type=GRADE_SUBMISSION_WINDOW_OPENED_TYPE,
                    title=f"Grade Submission Window Open — {period.period_name}",
                    body=(
                        f"Grade submission to the class adviser for {period.period_name} is now open. "
                        f"The submission window closes on {formatted_close}."
                    ),
                    action_url=action_url,
                    is_read=False,
                )
                db.add(notif)
                created_notifications.append(notif)

        # ----------------------------------------------------------------------
        # 2. Closing Soon Notification
        # ----------------------------------------------------------------------
        if today >= closing_soon_date:
            # Check enrolled vs finalized count across all loads of this teacher
            total_enrolled = 0
            total_finalized = 0

            for load in loads:
                enrolled_students = (
                    db.query(StudentClass.student_id)
                    .filter(
                        StudentClass.class_id == load.class_id,
                        StudentClass.enrollment_status == "enrolled",
                    )
                    .all()
                )
                enrolled_ids = {row[0] for row in enrolled_students}
                total_enrolled += len(enrolled_ids)

                if enrolled_ids:
                    finalized_students = (
                        db.query(StudentPeriodGrade.student_id)
                        .filter(
                            StudentPeriodGrade.class_id == load.class_id,
                            StudentPeriodGrade.subject_id == load.subject_id,
                            StudentPeriodGrade.academic_period_id == period.academic_period_id,
                            StudentPeriodGrade.is_finalized == True,  # noqa: E712
                            StudentPeriodGrade.student_id.in_(enrolled_ids),
                        )
                        .all()
                    )
                    total_finalized += len(finalized_students)

            # Fire if any student is unfinalized (partial counts as pending)
            if total_enrolled > 0 and total_finalized < total_enrolled:
                existing_closing = (
                    db.query(Notification)
                    .filter(
                        Notification.user_id == user_uuid,
                        Notification.notification_type == GRADE_SUBMISSION_CLOSING_SOON_TYPE,
                        Notification.action_url == action_url,
                    )
                    .first()
                )
                if not existing_closing:
                    pending_count = total_enrolled - total_finalized
                    formatted_close = close_date.strftime("%B %d, %Y")
                    notif = Notification(
                        notification_id=uuid.uuid4(),
                        user_id=user_uuid,
                        notification_type=GRADE_SUBMISSION_CLOSING_SOON_TYPE,
                        title=f"Grade Submission Closing Soon — {period.period_name}",
                        body=(
                            f"The grade submission window for {period.period_name} closes on {formatted_close}. "
                            f"You have {pending_count} student grade(s) pending finalization."
                        ),
                        action_url=action_url,
                        is_read=False,
                    )
                    db.add(notif)
                    created_notifications.append(notif)

    if created_notifications:
        db.commit()
        for n in created_notifications:
            db.refresh(n)

    return created_notifications
