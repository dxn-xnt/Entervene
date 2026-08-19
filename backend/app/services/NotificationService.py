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
from sqlalchemy.orm import Session

from app.models.notifications.Notification import Notification
from app.schemas.Notification import NotificationCreate, NotificationListResponse, NotificationResponse


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def create_notification(db: Session, payload: NotificationCreate) -> Notification:
    """Persist a new notification record. Called by other services."""
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
    db.commit()
    db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def get_notifications_for_user(
    db: Session,
    user_id: str,
    limit: int = 50,
    unread_only: bool = False,
) -> NotificationListResponse:
    """Return notifications for a user, newest first."""
    query = db.query(Notification).filter(Notification.user_id == user_id)

    if unread_only:
        query = query.filter(Notification.is_read == False)  # noqa: E712

    records = query.order_by(Notification.created_at.desc()).limit(limit).all()
    unread_count = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.is_read == False,  # noqa: E712
    ).count()

    return NotificationListResponse(
        unread_count=unread_count,
        notifications=[NotificationResponse.model_validate(r) for r in records],
    )


# ---------------------------------------------------------------------------
# Mark as read
# ---------------------------------------------------------------------------

def mark_notification_read(db: Session, notification_id: str, user_id: str) -> NotificationResponse:
    """Mark a single notification as read. Raises 404 if not found or not owned."""
    record = db.query(Notification).filter(
        Notification.notification_id == notification_id,
        Notification.user_id == user_id,
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail="Notification not found")

    record.is_read = True
    record.read_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return NotificationResponse.model_validate(record)


def mark_all_notifications_read(db: Session, user_id: str) -> dict:
    """Mark every unread notification for a user as read."""
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        .all()
    )
    now = datetime.now(timezone.utc)
    for record in updated:
        record.is_read = True
        record.read_at = now
    db.commit()
    return {"marked_read": len(updated)}
