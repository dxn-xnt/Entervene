from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship
from app.db.Base import Base


class Lesson(Base):
    __tablename__ = "lesson"

    lesson_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = Column(String(255), nullable=False)
    description: Mapped[str | None] = Column(Text)
    content: Mapped[str | None] = Column(Text)
    order_index: Mapped[int] = Column(Integer, default=1)
    is_published: Mapped[bool] = Column(Boolean, default=False)
    is_draft: Mapped[bool] = Column(Boolean, default=True)
    is_locked: Mapped[bool] = Column(Boolean, default=False)
    is_archived: Mapped[bool] = Column(Boolean, default=False)
    created_by_staff_id: Mapped[str | None] = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    subject_id: Mapped[int] = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff: Mapped[object] = relationship("AcademicStaff", backref="lessons")
    subject: Mapped[object] = relationship("Subject", backref="lessons")
    attachments: Mapped[list["LessonAttachment"]] = relationship("LessonAttachment", back_populates="lesson", cascade="all, delete-orphan")
    assignments: Mapped[list["LessonAssignment"]] = relationship("LessonAssignment", back_populates="lesson", cascade="all, delete-orphan")
