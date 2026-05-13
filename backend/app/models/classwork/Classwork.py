from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey, Numeric
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class Classwork(Base):
    __tablename__ = "classwork"

    classwork_id         = Column(Integer, primary_key=True, autoincrement=True)
    title                = Column(String(255), nullable=False)
    description          = Column(Text)
    instructions         = Column(Text)
    classwork_type       = Column(String(50), nullable=False)   # QUIZ, ASSIGNMENT, ACTIVITY
    classwork_category   = Column(String(50))                   # WRITTEN_WORK, PERFORMANCE_TASK, PERIODICAL_EXAM
    total_points         = Column(Numeric(8, 2), default=100)
    is_locked            = Column(Boolean, default=False)
    is_published         = Column(Boolean, default=False)
    subject_id           = Column(Integer, ForeignKey("subject.subject_id"), nullable=False)
    created_by_staff_id  = Column(String(20), ForeignKey("academic_staff.staff_id"), nullable=False)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    subject     = relationship("Subject", backref="classworks")
    staff       = relationship("AcademicStaff", backref="classworks")
    attachments = relationship("ClassworkAttachment", back_populates="classwork", cascade="all, delete-orphan")
    assignments = relationship("ClassworkAssignment", back_populates="classwork", cascade="all, delete-orphan")
