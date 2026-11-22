"""Teacher notifications follow graded Intervention Assessment transitions."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.notifications.Notification import Notification
from app.services.intervention import InterventionNotificationService as notifications
from tests.test_classwork_submission_authorization import authz_context


def _assessment(context, monkeypatch):
    db = context["db"]
    intervention = Intervention(
        intervention_id=9999,
        student_id=context["student"].student_id,
        class_id=context["allowed_class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=context["period"].academic_period_id,
        source_prediction_id=9999,
        status="ACTIVE",
        diagnosis_snapshot={},
        remediation_plan={"score_adjustment_cap": 75},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=context["owner"].staff_id,
    )
    db.add(intervention)
    assignment = db.get(ClassworkAssignment, context["assignment"].classwork_assignment_id)
    assignment.recipient_student_id = context["student"].student_id
    assignment.source_intervention_id = intervention.intervention_id
    assignment.remediation_request_id = uuid4()
    assignment.classwork.is_graded = True
    db.commit()
    monkeypatch.setattr(
        notifications,
        "_responsible_teacher_identity",
        lambda *_args: (context["owner"].staff_id, context["accounts"]["owner"].user_id),
    )
    return assignment, context["submission"]


@pytest.mark.parametrize(
    ("reaches_threshold", "expected_type", "expected_title", "expected_event"),
    (
        (True, "intervention_passed", "Intervention Passed", "PASSED"),
        (False, "intervention_assessment_not_passed", "Intervention Assessment Not Passed", "NOT_PASSED"),
    ),
)
def test_finalized_result_sends_one_result_without_submitted_duplicate(
    authz_context,
    monkeypatch,
    reaches_threshold,
    expected_type,
    expected_title,
    expected_event,
):
    assignment, submission = _assessment(authz_context, monkeypatch)
    submission.status = "graded"
    submission.grade = 80
    monkeypatch.setattr(
        "app.services.grading.SubjectGradeProjectionService.calculate_subject_grade_projection",
        lambda *_args, **_kwargs: {
            "status": "AVAILABLE",
            "current_reaches_passing_threshold": reaches_threshold,
        },
    )

    assert notifications.stage_intervention_assessment_result(
        authz_context["db"], assignment, submission,
    ) == expected_event
    assert notifications.stage_intervention_assessment_result(
        authz_context["db"], assignment, submission,
    ) == expected_event
    authz_context["db"].commit()

    rows = authz_context["db"].query(Notification).all()
    assert len(rows) == 1
    assert rows[0].notification_type == expected_type
    assert rows[0].title == expected_title
    assert "Score: 80/100." in rows[0].body
    assert not authz_context["db"].query(Notification).filter_by(
        notification_type="intervention_assessment_submitted",
    ).first()


def test_unavailable_result_does_not_fall_back_to_submission_notification(authz_context, monkeypatch):
    assignment, submission = _assessment(authz_context, monkeypatch)
    submission.status = "graded"
    submission.grade = 80
    monkeypatch.setattr(
        "app.services.grading.SubjectGradeProjectionService.calculate_subject_grade_projection",
        lambda *_args, **_kwargs: {
            "status": "UNAVAILABLE",
            "current_reaches_passing_threshold": None,
        },
    )

    assert notifications.stage_intervention_assessment_result(
        authz_context["db"], assignment, submission,
    ) is None
    assert notifications.stage_intervention_assessment_result(
        authz_context["db"], assignment, submission,
    ) is None
    authz_context["db"].commit()

    rows = authz_context["db"].query(Notification).all()
    assert rows == []
