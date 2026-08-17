from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship
from app.db.Base import Base


class Subject(Base):
    __tablename__ = "subject"

    subject_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    academic_level_id: Mapped[int | None] = Column(Integer, ForeignKey("academic_level.academic_level_id"), nullable=True)
    subject_name: Mapped[str] = Column(String(150), nullable=False)
    subject_codename: Mapped[str | None] = Column(String(50))
    # Deprecated free-text column — kept for rollback safety, superseded by subject_group_id FK.
    subject_group: Mapped[str | None] = Column(String(50))
    subject_group_id: Mapped[int | None] = Column(
        Integer,
        ForeignKey("subject_groups.subject_group_id", ondelete="RESTRICT"),
        nullable=True,
    )
    hours: Mapped[int | None] = Column(Integer)
    is_math_or_science: Mapped[bool | None] = Column(Boolean, default=False)
    is_core: Mapped[bool] = Column(Boolean, nullable=False, default=False)
    status: Mapped[str | None] = Column(String(20), default="active")
    default_grading_template: Mapped[str | None] = Column(String(100))
    description: Mapped[str | None] = Column(Text)
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    academic_level: Mapped[object] = relationship("AcademicLevel", back_populates="subjects")
    subject_group_rel: Mapped[object] = relationship("SubjectGroup", back_populates="subjects")
    subject_loads: Mapped[list[object]] = relationship("SubjectLoad", back_populates="subject")
    subject_offerings: Mapped[list[object]] = relationship("SubjectOffering", back_populates="subject")
    grading_templates: Mapped[list[object]] = relationship("GradingTemplate", back_populates="subject")
