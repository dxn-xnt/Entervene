from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class GradingTemplate(Base):
    __tablename__ = "grading_template"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'archived')", name="ck_grading_template_status"),
        Index("ix_grading_template_academic_level_id", "academic_level_id"),
        Index("ix_grading_template_subject_id", "subject_id"),
        Index("ix_grading_template_status", "status"),
    )

    grading_template_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    academic_level_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("academic_level.academic_level_id"),
        nullable=True,
    )
    subject_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("subject.subject_id"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    academic_level: Mapped[object | None] = relationship("AcademicLevel", back_populates="grading_templates")
    subject: Mapped[object | None] = relationship("Subject", back_populates="grading_templates")
    components: Mapped[list[object]] = relationship(
        "GradingTemplateComponent",
        back_populates="grading_template",
        cascade="all, delete-orphan",
        order_by="GradingTemplateComponent.display_order",
    )
