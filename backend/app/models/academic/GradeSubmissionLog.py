from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class GradeSubmissionLog(Base):
    __tablename__ = "grade_submission_log"
    __table_args__ = (
        Index("ix_grade_submission_log_period_grade_id", "student_period_grade_id"),
        Index("ix_grade_submission_log_student_id", "student_id"),
        Index("ix_grade_submission_log_scope", "class_id", "subject_id", "academic_period_id"),
        Index("ix_grade_submission_log_submitted_by", "submitted_by_staff_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_period_grade_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("student_period_grade.period_grade_id", ondelete="SET NULL"),
        nullable=True,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("student.student_id", ondelete="CASCADE"),
        nullable=False,
    )
    class_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("class.class_id", ondelete="CASCADE"),
        nullable=False,
    )
    subject_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("subject.subject_id", ondelete="CASCADE"),
        nullable=False,
    )
    academic_period_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Snapshot columns of grade components at the time of submission
    written_work_percent: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    performance_task_percent: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    quarterly_assessment_percent: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    initial_grade: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    transmuted_grade: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    final_period_grade: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)

    # Audit metadata
    submitted_by_staff_id: Mapped[str | None] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="SET NULL"),
        nullable=True,
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    submission_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="single",
    )  # 'single' | 'bulk'
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    student_period_grade = relationship("StudentPeriodGrade", backref="submission_logs")
    student = relationship("Student", backref="grade_submission_logs")
    class_ = relationship("Class", backref="grade_submission_logs")
    subject = relationship("Subject", backref="grade_submission_logs")
    academic_period = relationship("AcademicPeriod", backref="grade_submission_logs")
    submitted_by = relationship("AcademicStaff", foreign_keys=[submitted_by_staff_id], backref="submitted_grade_logs")
