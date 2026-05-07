from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base

class SubjectLoad(Base):
    __tablename__ = "subject_load"
    __table_args__ = (
        UniqueConstraint("staff_id", "subject_id", "class_id", "academic_period_id",
                         name="uq_subject_load"),
    )

    subject_load_id        = Column(Integer, primary_key=True, autoincrement=True)
    staff_id               = Column(String(20), ForeignKey("academic_staff.staff_id"), nullable=False)
    subject_id             = Column(Integer, ForeignKey("subject.subject_id"), nullable=False)
    class_id               = Column(Integer, ForeignKey("class.class_id"), nullable=False)
    academic_period_id     = Column(Integer, ForeignKey("academic_period.academic_period_id"), nullable=False)
    status                 = Column(String(20), default="active")
    is_locked              = Column(Boolean, default=False)
    locked_at              = Column(DateTime(timezone=True), nullable=True)
    continued_from_load_id = Column(Integer, ForeignKey("subject_load.subject_load_id"), nullable=True)
    created_at             = Column(DateTime(timezone=True), server_default=func.now())
    updated_at             = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    staff          = relationship("AcademicStaff", back_populates="subject_loads")
    subject        = relationship("Subject", back_populates="subject_loads")
    class_         = relationship("Class", back_populates="subject_loads")
    period         = relationship("AcademicPeriod", back_populates="subject_loads")
    continued_from = relationship("SubjectLoad", remote_side="SubjectLoad.subject_load_id")