from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship
from app.db.Base import Base


class Classwork(Base):
    __tablename__ = "classwork"

    classwork_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = Column(String(255), nullable=False)
    description: Mapped[str | None] = Column(Text)
    instructions: Mapped[str | None] = Column(Text)
    classwork_type: Mapped[str] = Column(String(50), nullable=False)   # READING, QUIZ, ASSIGNMENT, ACTIVITY
    classwork_category: Mapped[str | None] = Column(String(50))        # WRITTEN_WORK, PERFORMANCE_TASK, PERIODICAL_EXAM
    total_points: Mapped[Decimal | None] = Column(Numeric(8, 2), default=100)
    is_locked: Mapped[bool] = Column(Boolean, default=False)
    is_published: Mapped[bool] = Column(Boolean, default=False)
    is_archived: Mapped[bool] = Column(Boolean, default=False, nullable=False)
    subject_id: Mapped[int] = Column(Integer, ForeignKey("subject.subject_id"), nullable=False)
    created_by_staff_id: Mapped[str] = Column(String(20), ForeignKey("academic_staff.staff_id"), nullable=False)
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    subject: Mapped[object] = relationship("Subject", backref="classworks")
    staff: Mapped[object] = relationship("AcademicStaff", backref="classworks")
    attachments: Mapped[list["ClassworkAttachment"]] = relationship("ClassworkAttachment", back_populates="classwork", cascade="all, delete-orphan")
    assignments: Mapped[list["ClassworkAssignment"]] = relationship("ClassworkAssignment", back_populates="classwork", cascade="all, delete-orphan")
