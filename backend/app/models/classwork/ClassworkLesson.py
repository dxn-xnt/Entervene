from sqlalchemy import Column, Integer, ForeignKey
from app.db.Base import Base

class ClassworkLesson(Base):
    """Junction table: links a Classwork to a Lesson (many-to-many)."""
    __tablename__ = "classwork_lesson"

    classwork_id = Column(Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), primary_key=True)
    lesson_id    = Column(Integer, ForeignKey("lesson.lesson_id",    ondelete="CASCADE"), primary_key=True)
