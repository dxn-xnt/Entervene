from sqlalchemy import Column, String, Date, Boolean, Integer, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class AcademicPeriod(Base):
    __tablename__ = "academic_period"

    academic_period_id = Column(Integer, primary_key=True, autoincrement=True)
    period_name        = Column(String(100), nullable=False)
    period_type        = Column(String(20), nullable=False)   # 'QUARTER' or 'SEMESTER'
    start_date         = Column(Date, nullable=False)
    end_date           = Column(Date, nullable=False)
    is_active          = Column(Boolean, default=False)
    academic_year_id   = Column(Integer, ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())

    academic_year = relationship("AcademicYear", back_populates="periods")
    subject_loads = relationship("SubjectLoad", back_populates="period")
    classes       = relationship("Class", back_populates="academic_period")