"""Focused creation, recipient, feed, and deduplication checks for Study Support."""

from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Notifications import router as notifications_router
from app.db.Session import get_db
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.notifications.Notification import Notification
from app.services.NotificationService import get_notifications_for_user
from app.services.intervention.InterventionRemediationService import PlanUpdate, save_plan
from app.services.intervention.TeacherInterventionService import activate_teacher_candidate
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_intervention_support_materials import _activate
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _support_notices(db):
    return db.query(Notification).filter_by(notification_type="study_support_available").all()


def _attach_active_student_account(ctx):
    account = UserAccount(
        user_id=uuid4(),
        email=f"study-support-student-{uuid4().hex[:8]}@example.test",
        account_status="active",
    )
    ctx["db"].add(account)
    ctx["db"].flush()
    ctx["student"].user_id = account.user_id
    ctx["db"].commit()
    return account


def test_activation_notifies_only_target_student_and_feed_delivers_deep_link(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    student_account = _attach_active_student_account(ctx)
    other = UserAccount(
        user_id=uuid4(),
        email=f"study-support-other-{uuid4().hex[:8]}@example.test",
        account_status="active",
    )
    db.add(other)
    db.commit()

    activate_teacher_candidate(db, _staff(ctx), _id(ctx))

    notices = _support_notices(db)
    assert len(notices) == 1
    notice = notices[0]
    assert notice.user_id == student_account.user_id
    assert notice.action_url == f"/student/interventions/view?intervention={_id(ctx)}"
    assert notice.title == "New Study Support Available"
    assert ctx["subject"].subject_name in notice.body

    target_feed = get_notifications_for_user(db, student_account.user_id)
    assert [item.notification_id for item in target_feed.notifications] == [notice.notification_id]
    assert get_notifications_for_user(db, other.user_id).notifications == []

    app = FastAPI()
    app.include_router(notifications_router, prefix="/api/v1/notifications")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "role": "student", "sub": str(student_account.user_id),
    }
    response = TestClient(app).get("/api/v1/notifications")
    assert response.status_code == 200
    assert [item["notification_id"] for item in response.json()["notifications"]] == [
        str(notice.notification_id),
    ]


def test_reading_assignment_backfills_once_and_ordinary_plan_edits_do_not_duplicate(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    student_account = _attach_active_student_account(ctx)
    _activate(ctx)  # Simulate an active intervention created before this notification hook.
    reading = Classwork(
        title="Focused Study Support reading",
        classwork_type="READING",
        is_graded=False,
        is_published=True,
        is_archived=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
    )
    db.add(reading)
    db.commit()

    body = PlanUpdate(
        teacher_choice="CLASSWORK",
        selected_resources=[{"kind": "CLASSWORK", "id": reading.classwork_id}],
    )
    save_plan(db, _staff(ctx), _id(ctx), body)
    save_plan(db, _staff(ctx), _id(ctx), body)
    save_plan(db, _staff(ctx), _id(ctx), body.model_copy(update={"score_adjustment_cap": 35}))

    notices = _support_notices(db)
    assert len(notices) == 1
    assert notices[0].user_id == student_account.user_id
    assert notices[0].action_url == f"/student/interventions/view?intervention={_id(ctx)}"


def _notifications_client(db, user_id, role="student"):
    app = FastAPI()
    app.include_router(notifications_router, prefix="/api/v1/notifications")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "role": role, "sub": str(user_id),
    }
    return TestClient(app)


def test_student_feed_safely_backfills_existing_active_intervention_once(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    student_account = _attach_active_student_account(ctx)
    other = UserAccount(
        user_id=uuid4(),
        email=f"study-support-other-{uuid4().hex[:8]}@example.test",
        account_status="active",
    )
    db.add(other)
    db.commit()

    # CANDIDATE interventions must never be backfilled to students.
    student_client = _notifications_client(db, student_account.user_id)
    assert student_client.get("/api/v1/notifications").json()["notifications"] == []
    assert _support_notices(db) == []

    # Existing ACTIVE intervention created before activation notices existed.
    _activate(ctx)
    assert _support_notices(db) == []

    other_client = _notifications_client(db, other.user_id)
    assert other_client.get("/api/v1/notifications").json()["notifications"] == []
    assert _support_notices(db) == []

    first = student_client.get("/api/v1/notifications")
    second = student_client.get("/api/v1/notifications")
    assert first.status_code == 200
    assert second.status_code == 200
    assert len(first.json()["notifications"]) == 1
    assert len(second.json()["notifications"]) == 1
    assert first.json()["notifications"][0]["action_url"] == (
        f"/student/interventions/view?intervention={_id(ctx)}"
    )
    assert len(_support_notices(db)) == 1


def test_student_feed_backfill_skips_when_legacy_activity_notice_already_exists(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    student_account = _attach_active_student_account(ctx)
    _activate(ctx)
    db.add(Notification(
        notification_id=uuid4(),
        user_id=student_account.user_id,
        notification_type="study_support_available",
        title="New Study Support Available",
        body="New Study Support is ready for you.",
        action_url=(
            "/student/classworks/77"
            f"?from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D{_id(ctx)}"
        ),
        is_read=True,
    ))
    db.commit()

    resp = _notifications_client(db, student_account.user_id).get("/api/v1/notifications")
    assert resp.status_code == 200
    assert len(resp.json()["notifications"]) == 1
    assert len(_support_notices(db)) == 1


