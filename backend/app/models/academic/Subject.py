from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class Subject(Base):
    __tablename__ = "subject"

    subject_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    academic_level_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("academic_level.academic_level_id"), nullable=True)
    subject_name: Mapped[str] = mapped_column(String(150), nullable=False)
    subject_codename: Mapped[str | None] = mapped_column(String(50))
    grading_template_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("grading_template.grading_template_id", ondelete="RESTRICT"),
        nullable=False,
        default=1,
    )
    is_math_or_science: Mapped[bool | None] = mapped_column(Boolean, default=False)
    is_core: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str | None] = mapped_column(String(20), default="active")
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


    academic_level: Mapped[object] = relationship("AcademicLevel", back_populates="subjects")
    grading_template: Mapped[object] = relationship("GradingTemplate", back_populates="subjects")
    subject_loads: Mapped[list[object]] = relationship("SubjectLoad", back_populates="subject")
    subject_offerings: Mapped[list[object]] = relationship("SubjectOffering", back_populates="subject")
