from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship
from app.db.Base import Base


class ClassworkAssignment(Base):
    __tablename__ = "classwork_assignment"
    __table_args__ = (
        UniqueConstraint("classwork_id", "class_id", name="uq_classwork_assignment"),
        Index("ix_classwork_assignment_class_published_due", "class_id", "is_published", "due_date"),
        Index("ix_classwork_assignment_classwork_id", "classwork_id"),
    )

    classwork_assignment_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    classwork_id: Mapped[int] = Column(Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False)
    class_id: Mapped[int] = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    assigned_by_staff_id: Mapped[str] = Column(String(20), ForeignKey("academic_staff.staff_id"), nullable=False)
    publish_date: Mapped[datetime | None] = Column(DateTime(timezone=True))
    due_date: Mapped[datetime | None] = Column(DateTime(timezone=True))
    lock_date: Mapped[datetime | None] = Column(DateTime(timezone=True))
    is_published: Mapped[bool] = Column(Boolean, default=False)
    is_locked: Mapped[bool] = Column(Boolean, default=False)
    max_attempts: Mapped[int] = Column(Integer, default=1)
    assigned_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    classwork: Mapped["Classwork"] = relationship("Classwork", back_populates="assignments")
    class_: Mapped[object] = relationship("Class", backref="classwork_assignments")
    staff: Mapped[object] = relationship("AcademicStaff", backref="classwork_assignments")
    submissions: Mapped[list[object]] = relationship("StudentSubmission", back_populates="classwork_assignment", cascade="all, delete-orphan")
