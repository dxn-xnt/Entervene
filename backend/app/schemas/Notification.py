from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Supported notification types
# ---------------------------------------------------------------------------
NotificationType = Literal[
    "assignment_due",
    "classwork_updated",
    "deadline_changed",
    "classwork_due_soon",
    "classwork_due_today",
    "classwork_overdue",
    "risk_alert",
    "announcement",
    "grade_released",
    "quiz_results_available",
    "submission_graded",
    "grade_submission_window_opened",
    "grade_submission_closing_soon",
    "intervention_candidate",
    "intervention_resolved",
    "intervention_reviewer_available",
    "intervention_assessment_submitted",
    "intervention_passed",
    "intervention_assessment_not_passed",
    "study_support_available",
    "study_support_reminder",
    "study_support_final_reminder",
    "repost_request_received",
    "repost_package_ready",
    "repost_request_declined",
    "repost_package_declined",
    "repost_accepted",
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
    notification_id: UUID | None = None
    user_id: UUID
    notification_type: NotificationType
    title: str
    body: str | None = None
    action_url: str | None = None
