from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship

from app.db.Base import Base


class SubjectGroup(Base):
    """Admin-managed subject group with its own passing threshold.

    Groups are soft-deleted via ``is_active = False`` rather than hard-deleted,
    because existing subjects may reference a group.  The FK on ``subject``
    uses ON DELETE RESTRICT so a direct SQL hard-delete is blocked at the
    database level.
    """

    __tablename__ = "subject_groups"
    __table_args__ = (
        UniqueConstraint("name", name="uq_subject_groups_name"),
    )

    subject_group_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = Column(String(100), nullable=False)
    passing_threshold: Mapped[float] = Column(Numeric(5, 2), nullable=False, default=83)
    is_active: Mapped[bool] = Column(Boolean, nullable=False, default=True)
    display_order: Mapped[int] = Column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    subjects: Mapped[list[object]] = relationship("Subject", back_populates="subject_group_rel")
