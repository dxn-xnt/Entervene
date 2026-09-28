"""Intervention notification delivery follows durable prediction transitions."""

from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.intervention.Intervention import Intervention
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.services.NotificationService import get_notifications_for_user, mark_all_notifications_read, mark_notification_read
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention import InterventionNotificationService as notifications
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_intervention_candidate_sync import _setup


def _teacher(db, staff_id: str, *, admin: bool = False):
    user = UserAccount(user_id=uuid4(), email=f"{staff_id.lower()}@example.test")
    staff = AcademicStaff(staff_id=staff_id, first_name=staff_id, last_name="Teacher", user_id=user.user_id)
    db.add_all([user, staff])
    db.flush()
    db.add(UserRoles(user_id=user.user_id, role_id=1))
    if admin:
        db.add(UserRoles(user_id=user.user_id, role_id=2))
    db.flush()
    return staff


@pytest.fixture
def notified_context(current_period_context, monkeypatch):
    ctx = current_period_context
    db = ctx["db"]
    db.add_all([Role(role_id=1, role_name="teacher"), Role(role_id=2, role_name="admin")])
    db.flush()
    db.add(UserRoles(user_id=ctx["staff"].user_id, role_id=1))
    db.add(StudentClass(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled",
    ))
    load = SubjectLoad(
        staff_id=ctx["staff"].staff_id, class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id, academic_period_id=ctx["period"].academic_period_id,
        status="published", is_active_version=True,
    )
    db.add(load)
    db.commit()
    ctx["load"] = load
    ctx["model_id"] = _setup(ctx, monkeypatch, [84, 84, 88, 74])
    return ctx


def _items(ctx):
    ctx["db"].expire_all()
    return ctx["db"].query(Notification).order_by(Notification.created_at, Notification.notification_id).all()


def test_new_candidate_notifies_only_responsible_teacher_with_exact_link(notified_context):
    ctx = notified_context
    other = _teacher(ctx["db"], "T-UNRELATED")
    ctx["db"].commit()
    result = _run(ctx, ctx["model_id"])
    candidate = ctx["db"].query(Intervention).one()
    items = _items(ctx)
    assert len(items) == 1
    notice = items[0]
    assert notice.user_id == ctx["staff"].user_id and notice.user_id != other.user_id
    assert notice.notification_type == "intervention_candidate"
    assert notice.action_url == f"/teacher/interventions?candidate={candidate.intervention_id}"
    assert notice.is_read is False
    assert ctx["student"].first_name in notice.body and ctx["subject"].subject_name in notice.body
    assert "84" in notice.body and "Evidence is available" in notice.body
    assert result["prediction_id"] == candidate.source_prediction_id


def test_unchanged_and_later_low_revision_do_not_duplicate_notification(notified_context, monkeypatch):
    ctx = notified_context
    _run(ctx, ctx["model_id"])
    assert _run(ctx, ctx["model_id"])["unchanged"] is True
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 74)
    _run(ctx, ctx["model_id"])
    assert [item.notification_type for item in _items(ctx)] == ["intervention_candidate"]


def test_improvement_resolves_and_notifies_once_but_no_open_intervention_does_not(notified_context):
    ctx = notified_context
    _run(ctx, ctx["model_id"])
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    _run(ctx, ctx["model_id"])
    add_activity(ctx, "WRITTEN_WORK", 6, 10)
    _run(ctx, ctx["model_id"])
    candidate = ctx["db"].query(Intervention).first()
    assert candidate.status == "RESOLVED" and candidate.resolution_reason == "IMPROVED_PREDICTION"
    items = _items(ctx)
    assert sorted(item.notification_type for item in items) == ["intervention_candidate", "intervention_resolved"]
    resolved = next(item for item in items if item.notification_type == "intervention_resolved")
    assert resolved.user_id == ctx["staff"].user_id
    assert "criteria are no longer met" in resolved.body and "history" in resolved.body
    assert resolved.action_url == "/teacher/interventions"
    assert _run(ctx, ctx["model_id"])["unchanged"] is True
    assert len(_items(ctx)) == 2


def test_high_grade_without_open_intervention_sends_nothing(notified_context, monkeypatch):
    ctx = notified_context
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 88)
    _run(ctx, ctx["model_id"])
    assert ctx["db"].query(Intervention).count() == 0
    assert _items(ctx) == []


def test_insufficient_evidence_creates_no_false_improvement_notification(notified_context):
    ctx = notified_context
    _run(ctx, ctx["model_id"])
    for submission in ctx["db"].query(StudentSubmission).all()[1:]:
        submission.grade = None
    ctx["db"].commit()
    blocked = _run(ctx, ctx["model_id"])
    assert blocked["prediction_status"] == "INSUFFICIENT_EVIDENCE"
    assert [item.notification_type for item in _items(ctx)] == ["intervention_candidate"]


def test_notification_failure_rolls_back_prediction_and_candidate(notified_context, monkeypatch):
    ctx = notified_context
    original = notifications.stage_notification
    def fail_after_staging(db, payload):
        original(db, payload)
        raise RuntimeError("notification failed")
    monkeypatch.setattr(notifications, "stage_notification", fail_after_staging)
    with pytest.raises(RuntimeError, match="notification failed"):
        _run(ctx, ctx["model_id"])
    ctx["db"].expire_all()
    assert ctx["db"].query(Intervention).count() == 0
    assert ctx["db"].query(Notification).count() == 0


def test_active_substitute_receives_notification_primary_on_leave_does_not(notified_context):
    ctx = notified_context
    substitute = _teacher(ctx["db"], "T-SUBSTITUTE")
    ctx["db"].add(TeacherSubstitution(
        subject_load_id=ctx["load"].subject_load_id,
        original_staff_id=ctx["staff"].staff_id,
        substitute_staff_id=substitute.staff_id,
        start_date=date.today() - timedelta(days=1), end_date=date.today() + timedelta(days=1),
        status="active",
    ))
    ctx["db"].commit()
    _run(ctx, ctx["model_id"])
    assert [item.user_id for item in _items(ctx)] == [substitute.user_id]


def test_admin_membership_never_receives_intervention_notification(notified_context):
    ctx = notified_context
    ctx["db"].add(UserRoles(user_id=ctx["staff"].user_id, role_id=2))
    ctx["db"].commit()
    _run(ctx, ctx["model_id"])
    assert _items(ctx) == []


def test_admin_cannot_read_or_mark_accidental_intervention_row(notified_context):
    ctx = notified_context
    user_id = ctx["staff"].user_id
    ctx["db"].add(UserRoles(user_id=user_id, role_id=2))
    accidental = Notification(
        notification_id=uuid4(), user_id=user_id, notification_type="intervention_candidate",
        title="Accidental candidate", action_url="/teacher/interventions?candidate=99", is_read=False,
    )
    ordinary = Notification(
        notification_id=uuid4(), user_id=user_id, notification_type="announcement",
        title="Existing announcement", is_read=False,
    )
    ctx["db"].add_all([accidental, ordinary])
    ctx["db"].commit()
    listed = get_notifications_for_user(ctx["db"], user_id)
    assert [item.title for item in listed.notifications] == ["Existing announcement"]
    assert listed.unread_count == 1
    with pytest.raises(HTTPException) as exc:
        mark_notification_read(ctx["db"], str(accidental.notification_id), user_id)
    assert exc.value.status_code == 404
    assert mark_all_notifications_read(ctx["db"], user_id) == {"marked_read": 1}
    ctx["db"].expire_all()
    assert accidental.is_read is False and ordinary.is_read is True


def test_teacher_in_different_subject_scope_is_not_notified(notified_context):
    ctx = notified_context
    other = _teacher(ctx["db"], "T-OTHER-SCOPE")
    ctx["db"].add(SubjectLoad(
        staff_id=other.staff_id, class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id, academic_period_id=ctx["next_period"].academic_period_id,
        status="published", is_active_version=True,
    ))
    ctx["db"].commit()
    _run(ctx, ctx["model_id"])
    assert [item.user_id for item in _items(ctx)] == [ctx["staff"].user_id]
