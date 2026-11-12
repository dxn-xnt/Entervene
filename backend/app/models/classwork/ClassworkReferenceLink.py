from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base


class ClassworkReferenceLink(Base):
    __tablename__ = "classwork_reference_link"
    __table_args__ = (UniqueConstraint("classwork_id", "position", name="uq_classwork_reference_link_position"),)

    classwork_reference_link_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classwork_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    classwork: Mapped[Classwork] = relationship("Classwork", back_populates="reference_links")
