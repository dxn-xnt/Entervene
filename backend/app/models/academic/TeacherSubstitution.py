import uuid
from datetime import date as date_type, datetime

from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class TeacherSubstitution(Base):
    __tablename__ = "teacher_substitution"

    substitution_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    subject_load_id: Mapped[int] = mapped_column(Integer, ForeignKey("subject_load.subject_load_id", ondelete="RESTRICT"), nullable=False)
    original_staff_id: Mapped[str] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False)
    substitute_staff_id: Mapped[str] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False)
    start_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    end_date: Mapped[date_type | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")  # active, completed, cancelled
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_admin_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    ended_by_admin_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


    subject_load: Mapped[object] = relationship("SubjectLoad", backref="substitutions")
    original_staff: Mapped[object] = relationship("AcademicStaff", foreign_keys=[original_staff_id], backref="substitutions_as_original")
    substitute_staff: Mapped[object] = relationship("AcademicStaff", foreign_keys=[substitute_staff_id], backref="substitutions_as_substitute")
    created_by_admin: Mapped[object] = relationship("AcademicStaff", foreign_keys=[created_by_admin_id])
    ended_by_admin: Mapped[object] = relationship("AcademicStaff", foreign_keys=[ended_by_admin_id])
