from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class GradingTemplateComponent(Base):
    __tablename__ = "grading_template_component"
    __table_args__ = (
        CheckConstraint("weight > 0", name="ck_grading_template_component_weight_positive"),
        UniqueConstraint(
            "grading_template_id",
            "display_order",
            name="uq_grading_template_component_order",
        ),
        Index("ix_grading_template_component_template_id", "grading_template_id"),
    )

    component_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    grading_template_id: Mapped[int] = Column(
        Integer,
        ForeignKey("grading_template.grading_template_id", ondelete="CASCADE"),
        nullable=False,
    )
    component_name: Mapped[str] = Column(String(100), nullable=False)
    weight: Mapped[object] = Column(Numeric(6, 2), nullable=False)
    display_order: Mapped[int] = Column(Integer, nullable=False)
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    grading_template: Mapped[object] = relationship("GradingTemplate", back_populates="components")
