from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Supported notification types
# ---------------------------------------------------------------------------
NotificationType = Literal[
    "assignment_due",
    "risk_alert",
    "announcement",
    "grade_released",
    "submission_graded",
    "grade_submission_window_opened",
    "grade_submission_closing_soon",
]


# ---------------------------------------------------------------------------
# Outbound (read) schemas
# ---------------------------------------------------------------------------

class NotificationResponse(BaseModel):
    notification_id: UUID
    notification_type: str
    title: str
    body: str | None
    action_url: str | None
    is_read: bool
    created_at: datetime | None
    read_at: datetime | None

    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    unread_count: int
    notifications: list[NotificationResponse]


# ---------------------------------------------------------------------------
# Inbound (write) schemas – used internally by services that create
# notifications (e.g. when an assignment is published or risk is detected).
# ---------------------------------------------------------------------------

class NotificationCreate(BaseModel):
    user_id: UUID
    notification_type: NotificationType
    title: str
    body: str | None = None
    action_url: str | None = None
