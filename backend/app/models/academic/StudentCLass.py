from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class StudentClass(Base):
    __tablename__ = "student_class"
    __table_args__ = (
        UniqueConstraint("student_id", "class_id", name="uq_student_class"),
    )

    student_class_id  = Column(Integer, primary_key=True, autoincrement=True)
    student_id        = Column(UUID(as_uuid=True), ForeignKey("student.student_id"), nullable=False)
    class_id          = Column(Integer, ForeignKey("class.class_id"), nullable=False)
    enrollment_status = Column(String(20), default="enrolled")
    enrolled_at       = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("Student", back_populates="student_classes")
    class_  = relationship("Class", back_populates="student_classes")