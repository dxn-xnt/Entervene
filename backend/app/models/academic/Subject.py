from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class Subject(Base):
    __tablename__ = "subject"

    subject_id        = Column(Integer, primary_key=True, autoincrement=True)
    subject_name      = Column(String(150), nullable=False)
    subject_codename  = Column(String(50))
    description       = Column(Text)
    status            = Column(String(20), default="active")
    academic_level_id = Column(Integer, ForeignKey("academic_level.academic_level_id"), nullable=False)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    academic_level = relationship("AcademicLevel", back_populates="subjects")
    subject_loads  = relationship("SubjectLoad", back_populates="subject")