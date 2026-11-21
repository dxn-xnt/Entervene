"""Focused reminder policy checks for targeted Study Support assignments."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models.intervention.Intervention import Intervention
from app.models.intervention.PracticeAssessment import PracticeAssessment
from app.models.intervention.PracticeAttempt import PracticeAttempt
from app.models.notifications.Notification import Notification
from app.services.intervention.StudySupportReminderService import (
    legacy_study_support_action_url,
    scan_study_support_reminders,
    stage_intervention_study_support_available,
    stage_study_support_available,
    within_manila_school_hours,
)
from tests.test_classwork_submission_authorization import authz_context


PUBLISHED_AT = datetime(2026, 11, 19, 0, 0, tzinfo=timezone.utc)
FIRST_SCAN = datetime(2026, 11, 23, 0, 0, tzinfo=timezone.utc)  # Monday, 08:00 Manila
FINAL_SCAN = datetime(2026, 11, 24, 0, 0, tzinfo=timezone.utc)  # Tuesday, 08:00 Manila


def _support(context):
    db = context["db"]
    intervention = Intervention(
        intervention_id=9811,
        student_id=context["student"].student_id,
        class_id=context["allowed_class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=context["period"].academic_period_id,
        source_prediction_id=9811,
        status="ACTIVE",
        diagnosis_snapshot={},
        activated_at=PUBLISHED_AT - timedelta(days=1),
        activated_by_staff_id=context["owner"].staff_id,
    )
    db.add(intervention)
    assignment = context["assignment"]
    assignment.recipient_student_id = context["student"].student_id
    assignment.source_intervention_id = intervention.intervention_id
    assignment.remediation_request_id = uuid4()
    assignment.publish_date = PUBLISHED_AT
    assignment.is_published = True
    assignment.is_locked = False
    assignment.due_date = None
    assignment.lock_date = None
    assignment.allow_late_submissions = False
    assignment.classwork.is_published = True
    assignment.classwork.is_archived = False
    assignment.classwork.is_locked = False
    assignment.classwork.is_graded = True
    submission = context["submission"]
    submission.status = "pending"
    submission.submitted_at = None
    submission.attempt_count = 0
    submission.grade = None
    db.commit()
    return intervention, assignment, submission


def _reminders(context):
    return context["db"].query(Notification).filter(
        Notification.notification_type.in_((
            "study_support_reminder",
            "study_support_final_reminder",
        )),
    ).order_by(Notification.created_at.asc(), Notification.notification_type.asc()).all()


@pytest.mark.parametrize("producer_order", ("activation_first", "assignment_first"))
def test_activation_and_targeted_publication_share_one_availability_event(
    authz_context, producer_order,
):
    intervention, assignment, _submission = _support(authz_context)
    db = authz_context["db"]

    producers = {
        "activation": lambda: stage_intervention_study_support_available(db, intervention),
        "assignment": lambda: stage_study_support_available(
            db, assignment, assignment.classwork, authz_context["subject"].subject_id,
            now=PUBLISHED_AT,
        ),
    }
    order = (
        ("activation", "assignment")
        if producer_order == "activation_first"
        else ("assignment", "activation")
    )

    assert producers[order[0]]() is True
    assert producers[order[1]]() is False
    db.commit()

    notices = db.query(Notification).filter_by(
        notification_type="study_support_available",
    ).all()
    assert len(notices) == 1
    assert str(intervention.intervention_id) in notices[0].action_url


def test_first_and_final_reminders_are_student_safe_linked_and_duplicate_safe(authz_context):
    _intervention, assignment, _submission = _support(authz_context)

    first = scan_study_support_reminders(authz_context["db"], now=FIRST_SCAN)
    repeated_first = scan_study_support_reminders(authz_context["db"], now=FIRST_SCAN)
    final = scan_study_support_reminders(authz_context["db"], now=FINAL_SCAN)
    repeated_final = scan_study_support_reminders(authz_context["db"], now=FINAL_SCAN)

    assert first["sent"] == 1
    assert repeated_first["sent"] == 0 and repeated_first["scanned"] == 0
    assert final["sent"] == 1
    assert repeated_final["sent"] == 0 and repeated_final["scanned"] == 0
    rows = _reminders(authz_context)
    assert [row.notification_type for row in rows] == [
        "study_support_final_reminder",
        "study_support_reminder",
    ]
    assert {row.title for row in rows} == {
        "Study Support Reminder",
        "Final Study Support Reminder",
    }
    assert all("intervention" not in f"{row.title} {row.body}".lower() for row in rows)
    assert all(
        row.action_url == (
            "/student/interventions/view?intervention=9811"
            f"&activity={assignment.classwork_assignment_id}"
        )
        for row in rows
    )


@pytest.mark.parametrize(
    "outside",
    (
        datetime(2026, 11, 22, 4, 0, tzinfo=timezone.utc),   # Sunday noon Manila
        datetime(2026, 11, 22, 23, 59, tzinfo=timezone.utc), # Monday 07:59 Manila
        datetime(2026, 11, 23, 9, 0, tzinfo=timezone.utc),   # Monday 17:00 Manila
    ),
)
def test_delivery_window_defers_weekends_and_outside_school_hours(outside):
    assert not within_manila_school_hours(outside)
    assert within_manila_school_hours(FIRST_SCAN)


def test_submitted_practice_assessment_does_not_stop_required_assessment_reminder(authz_context):
    intervention, _assignment, _submission = _support(authz_context)
    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        title="Ungraded check",
        status="PUBLISHED",
        created_by_staff_id=authz_context["owner"].staff_id,
    )
    authz_context["db"].add(assessment)
    authz_context["db"].flush()
    authz_context["db"].add(PracticeAttempt(
        practice_assessment_id=assessment.practice_assessment_id,
        student_id=authz_context["student"].student_id,
        attempt_number=1,
        status="SUBMITTED",
        assessment_version=1,
        total_score=Decimal("1"),
        max_score=Decimal("1"),
        score_percentage=Decimal("100"),
        passing_threshold_snapshot=Decimal("75"),
        is_passed=True,
        question_order=[],
        completed_at=FIRST_SCAN - timedelta(hours=1),
    ))
    authz_context["db"].commit()

    result = scan_study_support_reminders(authz_context["db"], now=FIRST_SCAN)

    assert result["sent"] == 1
    assert [row.notification_type for row in _reminders(authz_context)] == ["study_support_reminder"]


def test_first_scan_after_five_days_sends_only_the_final_reminder(authz_context):
    _support(authz_context)

    result = scan_study_support_reminders(authz_context["db"], now=FINAL_SCAN)

    assert result["sent"] == 1
    assert [row.notification_type for row in _reminders(authz_context)] == [
        "study_support_final_reminder",
    ]


@pytest.mark.parametrize(
    "stop_reason",
    ("submitted", "inactive", "unpublished", "archived", "expired", "locked"),
)
def test_reminders_stop_when_support_is_no_longer_actionable(authz_context, stop_reason):
    intervention, assignment, submission = _support(authz_context)
    if stop_reason == "submitted":
        submission.status = "submitted"
        submission.submitted_at = FIRST_SCAN - timedelta(hours=1)
    elif stop_reason == "inactive":
        intervention.status = "RESOLVED"
        intervention.resolution_reason = "IMPROVED_PREDICTION"
        intervention.resolved_at = FIRST_SCAN - timedelta(hours=1)
    elif stop_reason == "unpublished":
        assignment.is_published = False
    elif stop_reason == "archived":
        assignment.classwork.is_archived = True
    elif stop_reason == "expired":
        assignment.due_date = FIRST_SCAN - timedelta(seconds=1)
        assignment.allow_late_submissions = False
    elif stop_reason == "locked":
        assignment.is_locked = True
    authz_context["db"].commit()

    result = scan_study_support_reminders(authz_context["db"], now=FIRST_SCAN)

    assert result["sent"] == 0
    assert _reminders(authz_context) == []


def test_legacy_action_url_notifications_prevent_duplicates_and_preserve_anchor(authz_context):
    _intervention, assignment, _submission = _support(authz_context)
    db = authz_context["db"]
    student_user_id = authz_context["accounts"]["student"].user_id
    legacy_url = legacy_study_support_action_url(assignment)

    # Legacy availability notice acts as publication anchor and deduplicates re-staging.
    assignment.publish_date = None
    db.add(Notification(
        notification_id=uuid4(),
        user_id=student_user_id,
        notification_type="study_support_available",
        title="New Study Support Available",
        body="New Study Support is ready for you.",
        action_url=legacy_url,
        is_read=False,
        created_at=PUBLISHED_AT,
    ))
    db.commit()

    assert stage_study_support_available(
        db, assignment, assignment.classwork, authz_context["subject"].subject_id, now=FIRST_SCAN,
    ) is False
    assert db.query(Notification).filter_by(notification_type="study_support_available").count() == 1

    # Legacy reminder prevents duplicate first reminder.
    db.add(Notification(
        notification_id=uuid4(),
        user_id=student_user_id,
        notification_type="study_support_reminder",
        title="Study Support Reminder",
        body="Your Study Support is ready when you are.",
        action_url=legacy_url,
        is_read=False,
        created_at=FIRST_SCAN - timedelta(hours=1),
    ))
    db.commit()

    first = scan_study_support_reminders(db, now=FIRST_SCAN)
    assert first["sent"] == 0
    assert len(_reminders(authz_context)) == 1

    # Final reminder still sends once using the canonical URL, and does not duplicate.
    final = scan_study_support_reminders(db, now=FINAL_SCAN)
    repeated_final = scan_study_support_reminders(db, now=FINAL_SCAN)
    assert final["sent"] == 1
    assert repeated_final["sent"] == 0
    reminders = _reminders(authz_context)
    assert len(reminders) == 2
    assert {row.notification_type for row in reminders} == {
        "study_support_reminder",
        "study_support_final_reminder",
    }

