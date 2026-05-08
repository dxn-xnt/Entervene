from sqlalchemy import Column, String, Integer, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class AcademicLevel(Base):
    __tablename__ = "academic_level"

    academic_level_id = Column(Integer, primary_key=True, autoincrement=True)
    level_name        = Column(String(100), nullable=False)
    grade_level       = Column(Integer, nullable=False)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    subjects = relationship("Subject", back_populates="academic_level")
    classes  = relationship("Class", back_populates="academic_level")