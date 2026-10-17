from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class GradingTemplate(Base):
    __tablename__ = "grading_template"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'archived')", name="ck_grading_template_status"),
        CheckConstraint("passing_threshold >= 0 AND passing_threshold <= 100", name="ck_grading_template_passing_threshold"),
        UniqueConstraint("template_name", name="uq_grading_template_name"),
        Index("ix_grading_template_status", "status"),
    )

    grading_template_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_name: Mapped[str] = mapped_column(String(150), nullable=False)
    passing_threshold: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    subjects: Mapped[list[object]] = relationship("Subject", back_populates="grading_template")
    components: Mapped[list[object]] = relationship(
        "GradingTemplateComponent",
        back_populates="grading_template",
        cascade="all, delete-orphan",
        order_by="GradingTemplateComponent.display_order",
    )
