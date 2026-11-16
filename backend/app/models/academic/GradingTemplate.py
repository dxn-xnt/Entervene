from __future__ import annotations

from datetime import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class GradingTemplate(Base):
    __tablename__ = "grading_template"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'active', 'superseded', 'archived')", name="ck_grading_template_status"),
        CheckConstraint("passing_threshold >= 0 AND passing_threshold <= 100", name="ck_grading_template_passing_threshold"),
        UniqueConstraint("template_family_code", "revision", name="uq_grading_template_family_revision"),
        Index("ix_grading_template_status", "status"),
    )

    grading_template_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_name: Mapped[str] = mapped_column(String(150), nullable=False)
    template_family_code: Mapped[str] = mapped_column(
        String(100), nullable=False, default=lambda: f"template-{uuid.uuid4().hex}"
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    supersedes_template_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("grading_template.grading_template_id", ondelete="RESTRICT"), nullable=True
    )
    policy_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[object | None] = mapped_column(UUID(as_uuid=True), nullable=True)
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
    supersedes: Mapped[object | None] = relationship(
        "GradingTemplate", remote_side=[grading_template_id], foreign_keys=[supersedes_template_id]
    )
