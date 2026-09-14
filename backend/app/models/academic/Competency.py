from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.academic.Lesson import Lesson
    from app.models.academic.Subject import Subject
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.people.AcademicStaff import AcademicStaff


class Competency(Base):
    __tablename__ = "competency"
    __table_args__ = (
        Index("ix_competency_subject_staff", "subject_id", "created_by_staff_id"),
    )

    competency_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    competency_code: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    target_hours: Mapped[int | None] = mapped_column(Integer, default=0, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Foreign Keys
    subject_id: Mapped[int] = mapped_column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False, index=True)
    academic_period_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)

    # Timestamps
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    subject: Mapped["Subject"] = relationship("Subject", backref="competencies")
    academic_period: Mapped["AcademicPeriod | None"] = relationship("AcademicPeriod", backref="competencies")
    staff: Mapped["AcademicStaff | None"] = relationship("AcademicStaff", backref="competencies")
    lessons: Mapped[list["Lesson"]] = relationship("Lesson", back_populates="competency")
