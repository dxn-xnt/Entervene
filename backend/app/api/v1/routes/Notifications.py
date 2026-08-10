from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.v1.routes.Auth import get_current_user
from app.db.Session import get_db
from app.schemas.Notification import NotificationListResponse, NotificationResponse
from app.services.NotificationService import (
    get_notifications_for_user,
    mark_all_notifications_read,
    mark_notification_read,
)

router = APIRouter()


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    unread_only: bool = Query(False, description="Return only unread notifications"),
    limit: int = Query(50, ge=1, le=200, description="Max number of notifications to return"),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Fetch the authenticated user's notifications, ordered newest-first.

    - `unread_only=true` filters to unread only.
    - `limit` caps the result set (default 50, max 200).
    """
    user_id = current_user["sub"]
    return get_notifications_for_user(db=db, user_id=user_id, limit=limit, unread_only=unread_only)


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
def read_notification(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a single notification as read. Returns 404 if it doesn't belong to the caller."""
    user_id = current_user["sub"]
    return mark_notification_read(db=db, notification_id=notification_id, user_id=user_id)


@router.patch("/read-all", response_model=dict)
def read_all_notifications(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark ALL of the authenticated user's unread notifications as read at once."""
    user_id = current_user["sub"]
    return mark_all_notifications_read(db=db, user_id=user_id)
