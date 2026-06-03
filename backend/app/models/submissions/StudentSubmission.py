from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey, Numeric, Index
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship
from app.db.Base import Base


class StudentSubmission(Base):
    __tablename__ = "student_submission"
    __table_args__ = (
        Index("ix_student_submission_assignment_student", "classwork_assignment_id", "student_id"),
    )

    submission_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[UUID] = Column(PGUUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    classwork_assignment_id: Mapped[int] = Column(Integer, ForeignKey("classwork_assignment.classwork_assignment_id", ondelete="CASCADE"), nullable=False)
    submitted_at: Mapped[datetime | None] = Column(DateTime(timezone=True))
    status: Mapped[str] = Column(String(30), default="pending")  # pending, submitted, graded, late, missed
    grade: Mapped[Decimal | None] = Column(Numeric(8, 2))
    feedback: Mapped[str | None] = Column(Text)
    attempt_count: Mapped[int] = Column(Integer, default=0)
    graded_at: Mapped[datetime | None] = Column(DateTime(timezone=True))
    graded_by_staff_id: Mapped[str | None] = Column(String(20), ForeignKey("academic_staff.staff_id"), nullable=True)
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())

    student: Mapped[object] = relationship("Student", backref="submissions")
    classwork_assignment: Mapped[object] = relationship("ClassworkAssignment", back_populates="submissions")
    graded_by: Mapped[object] = relationship("AcademicStaff", backref="graded_submissions")
    attachments: Mapped[list[object]] = relationship("SubmissionAttachment", back_populates="submission", cascade="all, delete-orphan")
