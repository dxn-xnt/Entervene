from __future__ import annotations

from datetime import datetime
from sqlalchemy import Column, String, Integer, Boolean, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped
from app.db.Base import Base


class PeriodTemplateSlot(Base):
    __tablename__ = "period_template_slot"

    slot_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    template_group: Mapped[str] = Column(String(50), nullable=False, index=True)
    slot_name: Mapped[str] = Column(String(100), nullable=False)
    slot_type: Mapped[str] = Column(String(20), default="CLASS", nullable=False)  # CLASS | RECESS | LUNCH | HOMEROOM
    start_time: Mapped[str] = Column(String(10), nullable=False)
    end_time: Mapped[str] = Column(String(10), nullable=False)
    is_locked_break: Mapped[bool] = Column(Boolean, default=False, nullable=False)
    display_order: Mapped[int] = Column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
