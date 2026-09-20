from __future__ import annotations

from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base


class ActivityRubricLevel(Base):
    __tablename__ = "activity_rubric_level"
    rubric_level_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classwork_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False, index=True
    )
    level_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    points: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    classwork: Mapped[object] = relationship("Classwork", back_populates="rubric_levels")
