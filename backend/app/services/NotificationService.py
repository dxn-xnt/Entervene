"""
NotificationService.py

Internal helper functions for creating and reading notifications.
These are called by other services (e.g. ClassworkService, RiskEngine)
and directly by the Notifications router.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.models.notifications.Notification import Notification
from app.schemas.Notification import NotificationCreate, NotificationListResponse, NotificationResponse


INTERVENTION_NOTIFICATION_TYPES = ("intervention_candidate", "intervention_resolved")


def _admin_account(db: Session, user_id: uuid.UUID) -> bool:
    return db.query(UserRoles.user_id).join(Role, UserRoles.role_id == Role.role_id).filter(
        UserRoles.user_id == user_id, func.lower(Role.role_name) == "admin",
    ).first() is not None


def _has_intervention_notifications(db: Session, user_id: uuid.UUID) -> bool:
    return db.query(Notification.notification_id).filter(
        Notification.user_id == user_id,
        Notification.notification_type.in_(INTERVENTION_NOTIFICATION_TYPES),
    ).first() is not None


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def stage_notification(db: Session, payload: NotificationCreate) -> Notification:
    """Add a notification to the caller's transaction without committing it."""
    record = Notification(
        notification_id=uuid.uuid4(),
        user_id=payload.user_id,
        notification_type=payload.notification_type,
        title=payload.title,
        body=payload.body,
        action_url=payload.action_url,
        is_read=False,
    )
    db.add(record)
    db.flush()
    return record


def create_notification(db: Session, payload: NotificationCreate) -> Notification:
    """Persist a new notification record. Called by other services."""
    record = stage_notification(db, payload)
    db.commit()
    db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def _to_uuid(val: uuid.UUID | str) -> uuid.UUID:
    if isinstance(val, uuid.UUID):
        return val
    return uuid.UUID(str(val))


def get_notifications_for_user(
    db: Session,
    user_id: uuid.UUID | str,
    limit: int = 50,
    unread_only: bool = False,
) -> NotificationListResponse:
    """Return notifications for a user, newest first."""
    uid = _to_uuid(user_id)
    query = db.query(Notification).filter(Notification.user_id == uid)
    unread_query = db.query(Notification).filter(Notification.user_id == uid)
    if _has_intervention_notifications(db, uid) and _admin_account(db, uid):
        query = query.filter(Notification.notification_type.notin_(INTERVENTION_NOTIFICATION_TYPES))
        unread_query = unread_query.filter(Notification.notification_type.notin_(INTERVENTION_NOTIFICATION_TYPES))

    if unread_only:
        query = query.filter(Notification.is_read == False)  # noqa: E712

    records = query.order_by(Notification.created_at.desc()).limit(limit).all()
    unread_count = unread_query.filter(
        Notification.is_read == False,  # noqa: E712
    ).count()

    return NotificationListResponse(
        unread_count=unread_count,
        notifications=[NotificationResponse.model_validate(r) for r in records],
    )


# ---------------------------------------------------------------------------
# Mark as read
# ---------------------------------------------------------------------------

def mark_notification_read(db: Session, notification_id: str, user_id: uuid.UUID | str) -> NotificationResponse:
    """Mark a single notification as read. Raises 404 if not found or not owned."""
    nid = _to_uuid(notification_id)
    uid = _to_uuid(user_id)
    record = db.query(Notification).filter(
        Notification.notification_id == nid,
        Notification.user_id == uid,
    ).first()

    if not record or (record.notification_type in INTERVENTION_NOTIFICATION_TYPES and _admin_account(db, uid)):
        raise HTTPException(status_code=404, detail="Notification not found")

    record.is_read = True
    record.read_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return NotificationResponse.model_validate(record)


def mark_all_notifications_read(db: Session, user_id: uuid.UUID | str) -> dict:
    """Mark every unread notification for a user as read."""
    uid = _to_uuid(user_id)
    query = db.query(Notification).filter(Notification.user_id == uid, Notification.is_read == False)  # noqa: E712
    if _has_intervention_notifications(db, uid) and _admin_account(db, uid):
        query = query.filter(Notification.notification_type.notin_(INTERVENTION_NOTIFICATION_TYPES))
    updated = query.all()
    now = datetime.now(timezone.utc)
    for record in updated:
        record.is_read = True
        record.read_at = now
    db.commit()
    return {"marked_read": len(updated)}
