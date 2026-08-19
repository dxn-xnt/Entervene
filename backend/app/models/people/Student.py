from __future__ import annotations
import uuid
from datetime import date
from sqlalchemy import String, Text, Integer, CheckConstraint, ForeignKey, Index, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class Student(Base):
    __tablename__ = "student"

    student_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    student_lrn: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    suffix: Mapped[str | None] = mapped_column(String(10), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # guardian_id       = Column(UUID(as_uuid=True))   # not in DB yet
    academic_level_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("academic_level.academic_level_id", ondelete="RESTRICT"), nullable=True)
    # import_log_id     = Column(Integer)              # not in DB yet
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user_account.user_id", ondelete="SET NULL"), unique=True, nullable=True)

    __table_args__ = (
        CheckConstraint("length(student_lrn) = 12", name="lrn_check"),
        Index("ix_student_academic_level_id", "academic_level_id"),
        Index("ix_student_user_id", "user_id"),
    )

    student_classes = relationship("StudentClass", back_populates="student")
    academic_level = relationship("AcademicLevel")
    user_account = relationship("UserAccount")

