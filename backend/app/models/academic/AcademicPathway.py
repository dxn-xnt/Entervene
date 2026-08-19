from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class AcademicPathway(Base):
    __tablename__ = "academic_pathway"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deped_cluster_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("deped_cluster.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    deped_cluster: Mapped[object | None] = relationship("DepedCluster", back_populates="pathways")
    classes: Mapped[list[object]] = relationship("Class", back_populates="pathway")
    offering_pathways: Mapped[list[object]] = relationship("SubjectOfferingPathway", back_populates="pathway", cascade="all, delete-orphan")
