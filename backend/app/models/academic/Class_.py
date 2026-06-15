from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base

class Class(Base):
    __tablename__ = "class"
    # Database constraints enforce the same academic-year adviser invariant
    # validated by the class-management services.
    __table_args__ = (
        UniqueConstraint("class_id", "academic_year_id", name="uq_class_class_id_academic_year_id"),
        UniqueConstraint("adviser_staff_id", "academic_year_id", name="uq_class_adviser_academic_year"),
    )

    class_id           = Column(Integer, primary_key=True, autoincrement=True)
    section_name       = Column(String(100), nullable=False)
    class_status       = Column(String(20), default="active")
    adviser_staff_id   = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    academic_year_id   = Column(Integer, ForeignKey("academic_year.academic_year_id"), nullable=False)
    academic_level_id  = Column(Integer, ForeignKey("academic_level.academic_level_id"), nullable=False)
    academic_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id"), nullable=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    updated_at         = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    adviser       = relationship("AcademicStaff", back_populates="advised_classes")
    academic_year = relationship("AcademicYear", back_populates="classes")
    academic_level = relationship("AcademicLevel", back_populates="classes")
    academic_period = relationship("AcademicPeriod", back_populates="classes")
    subject_loads  = relationship("SubjectLoad", back_populates="class_")
    student_classes = relationship("StudentClass", back_populates="class_")
