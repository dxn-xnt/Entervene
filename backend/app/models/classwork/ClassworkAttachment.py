from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship
from app.db.Base import Base


class ClassworkAttachment(Base):
    __tablename__ = "classwork_attachment"
    __table_args__ = (
        CheckConstraint(
            "file_size > 0 AND file_size <= CASE "
            "WHEN LOWER(TRIM(COALESCE(file_type, ''))) IN "
            "('video/mp4', 'video/webm', 'video/quicktime') "
            "THEN 104857600 ELSE 10485760 END",
            name="classwork_attachment_size_check",
        ),
    )

    classwork_attachment_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    classwork_id: Mapped[int] = Column(Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = Column(String(255), nullable=False)
    file_path: Mapped[str] = Column(Text, nullable=False)
    file_type: Mapped[str | None] = Column(String(100))
    file_size: Mapped[int] = Column(BigInteger, nullable=False)
    uploaded_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())

    classwork: Mapped["Classwork"] = relationship("Classwork", back_populates="attachments")
