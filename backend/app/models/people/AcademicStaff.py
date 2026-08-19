from __future__ import annotations
import uuid
from datetime import date
from sqlalchemy import String, Date, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class AcademicStaff(Base):
    __tablename__ = "academic_staff"

    staff_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    middle_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    suffix: Mapped[str | None] = mapped_column(String(10), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    hired_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    employment_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user_account.user_id", ondelete="SET NULL"), unique=True, nullable=True)

    __table_args__ = (
        Index("ix_academic_staff_user_id", "user_id"),
    )

    advised_classes = relationship("Class", back_populates="adviser")
    subject_loads   = relationship("SubjectLoad", back_populates="staff")
    user_account    = relationship("UserAccount")

