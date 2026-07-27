from sqlalchemy import Column, String, Date, Boolean, Integer, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class AcademicYear(Base):
    __tablename__ = "academic_year"

    academic_year_id = Column(Integer, primary_key=True, autoincrement=True)
    year_label       = Column(String(20), nullable=False)
    start_date       = Column(Date, nullable=False)
    end_date         = Column(Date, nullable=False)
    is_active        = Column(Boolean, default=False)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    periods = relationship("AcademicPeriod", back_populates="academic_year")
    classes = relationship("Class", back_populates="academic_year")
    subject_offerings = relationship("SubjectOffering", back_populates="academic_year")
