from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship

from app.db.Base import Base


class Notification(Base):
    __tablename__ = "notification"

    notification_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("user_account.user_id", ondelete="CASCADE"), nullable=False, index=True)

    # What type of notification: "assignment_due" | "risk_alert" | "announcement" | "grade_released" | "submission_graded"
    notification_type = Column(String(60), nullable=False)

    # Human-readable title shown in the notification bell
    title = Column(String(255), nullable=False)

    # Optional longer body text
    body = Column(Text, nullable=True)

    # Optional deep-link so the frontend can navigate directly to the relevant page
    action_url = Column(String(500), nullable=True)

    # Whether the user has seen/dismissed this notification
    is_read = Column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = Column(DateTime(timezone=True), nullable=True)
