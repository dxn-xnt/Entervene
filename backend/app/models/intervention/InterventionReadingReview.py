from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.Base import Base


class InterventionReadingReview(Base):
    """A student's one-time Reading review acknowledgment for an intervention."""

    __tablename__ = "intervention_reading_review"
    __table_args__ = (
        UniqueConstraint(
            "intervention_id",
            "reading_assignment_id",
            name="uq_intervention_reading_review_intervention_assignment",
        ),
        Index(
            "ix_intervention_reading_review_intervention",
            "intervention_id",
        ),
        Index(
            "ix_intervention_reading_review_reading_assignment",
            "reading_assignment_id",
        ),
        Index(
            "ix_intervention_reading_review_student",
            "student_id",
        ),
    )

    review_id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    intervention_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("intervention.intervention_id", ondelete="RESTRICT"),
        nullable=False,
    )
    reading_assignment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "classwork_assignment.classwork_assignment_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.student_id", ondelete="RESTRICT"),
        nullable=False,
    )
    acknowledged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
