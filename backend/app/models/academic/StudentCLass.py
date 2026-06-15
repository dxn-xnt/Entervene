from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class StudentClass(Base):
    __tablename__ = "student_class"
    # A student may have many historical class records, but only one assignment
    # per academic year. Services validate this early; the constraint enforces it.
    __table_args__ = (
        UniqueConstraint("student_id", "class_id", name="uq_student_class"),
        UniqueConstraint("student_id", "academic_year_id", name="uq_student_class_student_academic_year"),
        ForeignKeyConstraint(
            ["class_id", "academic_year_id"],
            ["class.class_id", "class.academic_year_id"],
            name="fk_student_class_class_academic_year",
            ondelete="CASCADE",
        ),
    )

    student_class_id  = Column(Integer, primary_key=True, autoincrement=True)
    student_id        = Column(UUID(as_uuid=True), ForeignKey("student.student_id"), nullable=False)
    class_id          = Column(Integer, nullable=False)
    academic_year_id  = Column(Integer, nullable=False)
    enrollment_status = Column(String(20), default="enrolled")
    enrolled_at       = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("Student", back_populates="student_classes")
    class_  = relationship("Class", back_populates="student_classes")
