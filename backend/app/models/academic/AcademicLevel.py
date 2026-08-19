from __future__ import annotations
from datetime import datetime

from sqlalchemy import String, Integer, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class AcademicLevel(Base):
    __tablename__ = "academic_level"

    academic_level_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    level_name: Mapped[str] = mapped_column(String(100), nullable=False)
    grade_level: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


    subjects = relationship("Subject", back_populates="academic_level")
    classes  = relationship("Class", back_populates="academic_level")
    subject_offerings = relationship("SubjectOffering", back_populates="academic_level")
    grading_templates = relationship("GradingTemplate", back_populates="academic_level")
