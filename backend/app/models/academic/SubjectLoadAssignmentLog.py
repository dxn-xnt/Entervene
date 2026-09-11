from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base

class SubjectLoadAssignmentLog(Base):
    __tablename__ = "subject_load_assignment_log"

    log_id             = Column(Integer, primary_key=True, autoincrement=True)
    logical_load_id    = Column(String(64), nullable=False, index=True)
    subject_load_id    = Column(Integer, ForeignKey("subject_load.subject_load_id", ondelete="SET NULL"), nullable=True)
    class_id           = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    subject_id         = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    academic_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    old_staff_id       = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    new_staff_id       = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    changed_by         = Column(String(50), nullable=False)
    change_reason      = Column(String(255), nullable=True)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())

    subject_load = relationship("SubjectLoad")
    class_       = relationship("Class")
    subject      = relationship("Subject")
    period       = relationship("AcademicPeriod")
    old_staff    = relationship("AcademicStaff", foreign_keys=[old_staff_id])
    new_staff    = relationship("AcademicStaff", foreign_keys=[new_staff_id])
