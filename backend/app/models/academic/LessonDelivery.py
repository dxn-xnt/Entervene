from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.Class_ import Class
    from app.models.academic.Lesson import Lesson
    from app.models.academic.Subject import Subject
    from app.models.people.AcademicStaff import AcademicStaff


class LessonDelivery(Base):
    """Teacher-confirmed lesson delivery record scoped to class, subject, and grading period."""

    __tablename__ = "lesson_delivery"
    __table_args__ = (
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= delivered_at",
            name="ck_lesson_delivery_chronology",
        ),
        CheckConstraint(
            "(revoked_at IS NULL AND revoked_by_staff_id IS NULL) OR "
            "(revoked_at IS NOT NULL AND revoked_by_staff_id IS NOT NULL)",
            name="ck_lesson_delivery_revocation_pair",
        ),
        Index(
            "uq_lesson_delivery_active",
            "lesson_id",
            "class_id",
            "subject_id",
            "academic_period_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
            sqlite_where=text("revoked_at IS NULL"),
        ),
        Index(
            "ix_lesson_delivery_scope",
            "class_id",
            "subject_id",
            "academic_period_id",
        ),
        Index("ix_lesson_delivery_lesson_class", "lesson_id", "class_id"),
    )

    delivery_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lesson_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("lesson.lesson_id", ondelete="CASCADE"), nullable=False, index=True,
    )
    class_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False, index=True,
    )
    subject_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False, index=True,
    )
    academic_period_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False, index=True,
    )
    delivered_by_staff_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True,
    )
    delivered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by_staff_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True,
    )
    correction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    lesson: Mapped["Lesson"] = relationship("Lesson", backref="deliveries")
    class_: Mapped["Class"] = relationship("Class", backref="lesson_deliveries")
    subject: Mapped["Subject"] = relationship("Subject", backref="lesson_deliveries")
    academic_period: Mapped["AcademicPeriod"] = relationship("AcademicPeriod", backref="lesson_deliveries")
    delivered_by: Mapped["AcademicStaff | None"] = relationship(
        "AcademicStaff", foreign_keys=[delivered_by_staff_id],
    )
    revoked_by: Mapped["AcademicStaff | None"] = relationship(
        "AcademicStaff", foreign_keys=[revoked_by_staff_id],
    )
