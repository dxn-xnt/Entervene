from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class SubmissionFeedbackDraft(Base):
    __tablename__ = "submission_feedback_draft"
    __table_args__ = (
        UniqueConstraint("submission_id", name="uq_submission_feedback_draft_submission"),
        Index("ix_submission_feedback_draft_status", "status"),
        Index("ix_submission_feedback_draft_queue", "status", "scheduled_for"),
    )

    draft_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("student_submission.submission_id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="QUEUED")
    staff_id: Mapped[str | None] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="SET NULL"),
        nullable=True,
    )
    draft_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    feedback_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail_level: Mapped[str] = mapped_column(String(20), default="GENERAL")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claim_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    submission: Mapped[object] = relationship("StudentSubmission", backref="feedback_draft_record")
