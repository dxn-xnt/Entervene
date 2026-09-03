from __future__ import annotations

import uuid
from datetime import date as date_type, datetime

from sqlalchemy import String, Text, Date, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base


class AttendanceRecord(Base):
    __tablename__ = "attendance_record"
    __table_args__ = (
        UniqueConstraint("student_id", "class_id", "subject_id", "date", name="uq_attendance_student_class_subject_date"),
    )

    attendance_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False, index=True)
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=True)
    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="present")  # present, absent, late, excused
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    student: Mapped[object] = relationship("Student")
    class_: Mapped[object] = relationship("Class")
    subject: Mapped[object] = relationship("Subject")
    recorded_by: Mapped[object] = relationship("AcademicStaff")


class LeaveRequest(Base):
    __tablename__ = "leave_request"

    leave_request_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False, index=True)
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False, index=True)
    start_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    end_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending, approved, rejected
    reviewed_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    student: Mapped[object] = relationship("Student")
    class_: Mapped[object] = relationship("Class")
    reviewed_by: Mapped[object] = relationship("AcademicStaff")

