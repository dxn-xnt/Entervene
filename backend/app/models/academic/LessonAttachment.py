from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, String, Integer, BigInteger, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, relationship
from app.db.Base import Base


class LessonAttachment(Base):
    __tablename__ = "lesson_attachment"

    lesson_attachment_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    lesson_id: Mapped[int] = Column(Integer, ForeignKey("lesson.lesson_id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = Column(String(255), nullable=False)
    file_path: Mapped[str] = Column(Text, nullable=False)
    file_type: Mapped[str | None] = Column(String(100))
    file_size: Mapped[int] = Column(BigInteger, nullable=False)
    uploaded_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())

    lesson: Mapped["Lesson"] = relationship("Lesson", back_populates="attachments")
