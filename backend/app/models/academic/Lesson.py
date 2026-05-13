from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class Lesson(Base):
    __tablename__ = "lesson"

    lesson_id          = Column(Integer, primary_key=True, autoincrement=True)
    title              = Column(String(255), nullable=False)
    description        = Column(Text)
    content            = Column(Text)
    order_index        = Column(Integer, default=1)
    is_published       = Column(Boolean, default=False)
    is_locked          = Column(Boolean, default=False)
    created_by_staff_id = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    subject_id         = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    updated_at         = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff       = relationship("AcademicStaff", backref="lessons")
    subject     = relationship("Subject", backref="lessons")
    attachments = relationship("LessonAttachment", back_populates="lesson", cascade="all, delete-orphan")
    assignments = relationship("LessonAssignment", back_populates="lesson", cascade="all, delete-orphan")
