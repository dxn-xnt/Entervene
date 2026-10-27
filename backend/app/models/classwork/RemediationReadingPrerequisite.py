from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.Base import Base


class RemediationReadingPrerequisite(Base):
    """Immutable ordered Reading prerequisite for one remediation assignment."""

    __tablename__ = "remediation_reading_prerequisite"
    __table_args__ = (
        UniqueConstraint(
            "remediation_assignment_id",
            "display_order",
            name="uq_remediation_reading_prerequisite_order",
        ),
        UniqueConstraint(
            "remediation_assignment_id",
            "reading_assignment_id",
            name="uq_remediation_reading_prerequisite_reading",
        ),
        CheckConstraint(
            "display_order > 0",
            name="ck_remediation_reading_prerequisite_order_positive",
        ),
        Index(
            "ix_remediation_reading_prerequisite_remediation",
            "remediation_assignment_id",
        ),
        Index(
            "ix_remediation_reading_prerequisite_reading_assignment",
            "reading_assignment_id",
        ),
    )

    prerequisite_id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    remediation_assignment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "classwork_assignment.classwork_assignment_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    reading_classwork_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("classwork.classwork_id", ondelete="RESTRICT"),
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
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
