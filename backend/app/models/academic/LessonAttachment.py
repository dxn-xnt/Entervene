from sqlalchemy import Column, String, Integer, BigInteger, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class LessonAttachment(Base):
    __tablename__ = "lesson_attachment"

    lesson_attachment_id = Column(Integer, primary_key=True, autoincrement=True)
    lesson_id            = Column(Integer, ForeignKey("lesson.lesson_id", ondelete="CASCADE"), nullable=False)
    file_name            = Column(String(255), nullable=False)
    file_path            = Column(Text, nullable=False)
    file_type            = Column(String(100))
    file_size            = Column(BigInteger, nullable=False)
    uploaded_at          = Column(DateTime(timezone=True), server_default=func.now())

    lesson = relationship("Lesson", back_populates="attachments")
