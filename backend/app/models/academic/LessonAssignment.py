from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class LessonAssignment(Base):
    __tablename__ = "lesson_assignment"
    __table_args__ = (
        UniqueConstraint("lesson_id", "class_id", name="uq_lesson_assignment"),
    )

    lesson_assignment_id = Column(Integer, primary_key=True, autoincrement=True)
    lesson_id            = Column(Integer, ForeignKey("lesson.lesson_id", ondelete="CASCADE"), nullable=False)
    class_id             = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    assigned_by_staff_id = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    publish_date         = Column(DateTime(timezone=True))
    is_published         = Column(Boolean, default=False)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())

    lesson = relationship("Lesson", back_populates="assignments")
    class_ = relationship("Class", backref="lesson_assignments")
    staff  = relationship("AcademicStaff", backref="lesson_assignments")
