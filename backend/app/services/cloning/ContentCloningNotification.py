from __future__ import annotations

import logging
import uuid
from sqlalchemy import inspect
from sqlalchemy.orm import Session
from app.models.people.AcademicStaff import AcademicStaff

logger = logging.getLogger(__name__)


def staff_name(staff: AcademicStaff | None) -> str:
    if staff is None:
        return "Teacher"
    parts = [value for value in (staff.first_name, staff.middle_name, staff.last_name, staff.suffix) if value]
    return " ".join(parts) if parts else "Teacher"


def stage_cloning_notification(
    db: Session,
    *,
    user_id: uuid.UUID | None,
    notification_type: str,
    title: str,
    body: str,
    action_url: str,
):
    """Stage an in-app notification in the caller's active transaction for Content Cloning lifecycle events.
    
    The notification is flushed into the active transaction and commits atomically with the operation,
    preventing partial or inconsistent cloning state. Real database errors are not swallowed.
    """
    if not user_id:
        return None

    from app.services.NotificationService import stage_notification
    from app.schemas.Notification import NotificationCreate

    return stage_notification(
        db,
        NotificationCreate(
            user_id=user_id,
            notification_type=notification_type,  # type: ignore[arg-type]
            title=title,
            body=body,
            action_url=action_url,
        ),
    )


def send_cloning_notification(
    db: Session,
    *,
    user_id: uuid.UUID | None,
    notification_type: str,
    title: str,
    body: str,
    action_url: str,
):
    """Stage and commit an in-app notification for Content Cloning lifecycle events."""
    notif = stage_cloning_notification(
        db,
        user_id=user_id,
        notification_type=notification_type,
        title=title,
        body=body,
        action_url=action_url,
    )
    if notif is not None:
        db.commit()
    return notif
