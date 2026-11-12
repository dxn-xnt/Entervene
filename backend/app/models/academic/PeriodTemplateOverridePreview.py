from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.Base import Base


class PeriodTemplateOverridePreview(Base):
    __tablename__ = "period_template_override_preview"

    preview_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    academic_year_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False
    )
    academic_period_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False
    )
    base_template_group: Mapped[str] = mapped_column(String(50), nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    impact: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

