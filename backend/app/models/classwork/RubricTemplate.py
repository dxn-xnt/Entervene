from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.Base import Base


class RubricTemplate(Base):
    __tablename__ = "rubric_template"
    __table_args__ = (UniqueConstraint("owner_staff_id", "name", name="uq_rubric_template_owner_name"),)

    rubric_template_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_staff_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    levels: Mapped[list[dict]] = mapped_column(JSON, nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
