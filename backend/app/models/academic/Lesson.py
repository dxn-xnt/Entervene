from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Integer, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.academic.LessonAssignment import LessonAssignment
    from app.models.academic.LessonAttachment import LessonAttachment


class Lesson(Base):
    __tablename__ = "lesson"

    lesson_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str | None] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=1)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    subject_id: Mapped[int] = mapped_column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff: Mapped[object] = relationship("AcademicStaff", backref="lessons")
    subject: Mapped[object] = relationship("Subject", backref="lessons")
    attachments: Mapped[list["LessonAttachment"]] = relationship("LessonAttachment", back_populates="lesson", cascade="all, delete-orphan")
    assignments: Mapped[list["LessonAssignment"]] = relationship("LessonAssignment", back_populates="lesson", cascade="all, delete-orphan")
