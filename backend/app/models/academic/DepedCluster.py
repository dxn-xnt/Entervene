from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class DepedCluster(Base):
    __tablename__ = "deped_cluster"

    id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = Column(String(50), unique=True, nullable=False)
    name: Mapped[str] = Column(String(150), nullable=False)
    category: Mapped[str] = Column(String(20), nullable=False, default="ACADEMIC")  # ACADEMIC or TECH_PRO
    sort_order: Mapped[int] = Column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    pathways: Mapped[list[object]] = relationship("AcademicPathway", back_populates="deped_cluster")
