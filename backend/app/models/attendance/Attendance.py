from __future__ import annotations

from sqlalchemy import Column, String, Text, Date, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.db.Base import Base


class AttendanceRecord(Base):
    __tablename__ = "attendance_record"
    __table_args__ = (
        UniqueConstraint("student_id", "class_id", "date", name="uq_attendance_student_class_date"),
    )

    attendance_id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False, index=True)
    class_id = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=True)
    date = Column(Date, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="present")  # present, absent, late, excused
    remarks = Column(Text, nullable=True)
    recorded_by_staff_id = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    student = relationship("Student")
    class_ = relationship("Class")
    subject = relationship("Subject")
    recorded_by = relationship("AcademicStaff")


class LeaveRequest(Base):
    __tablename__ = "leave_request"

    leave_request_id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False, index=True)
    class_id = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False, index=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="pending")  # pending, approved, rejected
    reviewed_by_staff_id = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    student = relationship("Student")
    class_ = relationship("Class")
    reviewed_by = relationship("AcademicStaff")
