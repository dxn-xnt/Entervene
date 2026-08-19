from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import uuid

from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, Numeric, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class StudentSubmission(Base):
    __tablename__ = "student_submission"
    __table_args__ = (
        Index("ix_student_submission_assignment_student", "classwork_assignment_id", "student_id"),
    )

    submission_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    classwork_assignment_id: Mapped[int] = mapped_column(Integer, ForeignKey("classwork_assignment.classwork_assignment_id", ondelete="CASCADE"), nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending, submitted, graded, late, missed
    grade: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    feedback: Mapped[str | None] = mapped_column(Text)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    graded_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id"), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

    student: Mapped[object] = relationship("Student", backref="submissions")
    classwork_assignment: Mapped[object] = relationship("ClassworkAssignment", back_populates="submissions")
    graded_by: Mapped[object] = relationship("AcademicStaff", backref="graded_submissions")
    attachments: Mapped[list[object]] = relationship("SubmissionAttachment", back_populates="submission", cascade="all, delete-orphan")

