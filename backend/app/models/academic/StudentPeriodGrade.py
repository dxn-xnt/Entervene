from __future__ import annotations
from datetime import datetime
from decimal import Decimal
import uuid
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class StudentPeriodGrade(Base):
    __tablename__ = "student_period_grade"
    __table_args__ = (
        UniqueConstraint(
            "student_id",
            "class_id",
            "subject_id",
            "academic_period_id",
            name="uq_student_period_grade_scope",
        ),
        Index("ix_student_period_grade_student_id", "student_id"),
        Index("ix_student_period_grade_class_id", "class_id"),
        Index("ix_student_period_grade_subject_id", "subject_id"),
        Index("ix_student_period_grade_academic_period_id", "academic_period_id"),
    )

    period_grade_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    academic_period_id: Mapped[int] = mapped_column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    written_work_percent: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    performance_task_percent: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    quarterly_assessment_percent: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    initial_grade: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    transmuted_grade: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    final_period_grade: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    is_finalized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finalized_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

    student = relationship("Student", backref="period_grades")
    class_ = relationship("Class", backref="period_grades")
    subject = relationship("Subject", backref="period_grades")
    academic_period = relationship("AcademicPeriod", backref="student_period_grades")
    finalized_by = relationship("AcademicStaff", backref="finalized_period_grades")

