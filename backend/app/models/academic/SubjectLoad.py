from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base

class SubjectLoad(Base):
    __tablename__ = "subject_load"

    subject_load_id        = Column(Integer, primary_key=True, autoincrement=True)
    staff_id               = Column(String(20), ForeignKey("academic_staff.staff_id"), nullable=True)
    subject_id             = Column(Integer, ForeignKey("subject.subject_id"), nullable=False)
    class_id               = Column(Integer, ForeignKey("class.class_id"), nullable=False)
    academic_period_id     = Column(Integer, ForeignKey("academic_period.academic_period_id"), nullable=False)
    start_time             = Column(String(10), nullable=True)
    end_time               = Column(String(10), nullable=True)
    days_of_week           = Column(JSON, nullable=True)
    status                 = Column(String(20), default="draft")
    version                = Column(Integer, default=1, nullable=False)
    is_active_version      = Column(Boolean, default=True, nullable=False)
    is_locked              = Column(Boolean, default=False)
    locked_at              = Column(DateTime(timezone=True), nullable=True)
    published_at           = Column(DateTime(timezone=True), nullable=True)
    published_by           = Column(String(50), nullable=True)
    last_modified_by       = Column(String(50), nullable=True)
    draft_notes            = Column(String(255), nullable=True)
    continued_from_load_id = Column(Integer, ForeignKey("subject_load.subject_load_id"), nullable=True)
    created_at             = Column(DateTime(timezone=True), server_default=func.now())
    updated_at             = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff          = relationship("AcademicStaff", back_populates="subject_loads")
    subject        = relationship("Subject", back_populates="subject_loads")
    class_         = relationship("Class", back_populates="subject_loads")
    period         = relationship("AcademicPeriod", back_populates="subject_loads")
    continued_from = relationship("SubjectLoad", remote_side="SubjectLoad.subject_load_id")