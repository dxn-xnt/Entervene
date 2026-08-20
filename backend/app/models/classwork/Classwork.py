from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class Classwork(Base):
    __tablename__ = "classwork"

    classwork_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    instructions: Mapped[str | None] = mapped_column(Text)
    classwork_type: Mapped[str] = mapped_column(String(50), nullable=False)   # READING, QUIZ, ASSIGNMENT, ACTIVITY
    classwork_category: Mapped[str | None] = mapped_column(String(50))        # WRITTEN_WORK, PERFORMANCE_TASK, QUARTERLY_ASSESSMENT
    activity_mode: Mapped[str] = mapped_column(String(20), default="ONLINE", server_default="ONLINE", nullable=False)  # ONLINE, MANUAL
    is_graded: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    total_points: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), default=100)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    show_scores: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, ForeignKey("subject.subject_id"), nullable=False)
    created_by_staff_id: Mapped[str] = mapped_column(String(20), ForeignKey("academic_staff.staff_id"), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


    subject: Mapped[object] = relationship("Subject", backref="classworks")
    staff: Mapped[object] = relationship("AcademicStaff", backref="classworks")
    attachments: Mapped[list["ClassworkAttachment"]] = relationship("ClassworkAttachment", back_populates="classwork", cascade="all, delete-orphan")
    assignments: Mapped[list["ClassworkAssignment"]] = relationship("ClassworkAssignment", back_populates="classwork", cascade="all, delete-orphan")
    lessons: Mapped[list["Lesson"]] = relationship("Lesson", secondary="classwork_lesson", backref="linked_classworks")
