from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.Base import Base


class PeriodTemplateRevision(Base):
    __tablename__ = "period_template_revision"
    __table_args__ = (
        UniqueConstraint(
            "base_template_group",
            "academic_year_id",
            "revision_number",
            name="uq_period_template_revision_number",
        ),
        UniqueConstraint("version_template_group", name="uq_period_template_revision_group"),
    )

    revision_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    base_template_group: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    version_template_group: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    academic_year_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

