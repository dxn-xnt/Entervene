from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class StudentSubmission(Base):
    __tablename__ = "student_submission"

    submission_id           = Column(Integer, primary_key=True, autoincrement=True)
    student_id              = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    classwork_assignment_id = Column(Integer, ForeignKey("classwork_assignment.classwork_assignment_id", ondelete="CASCADE"), nullable=False)
    submitted_at            = Column(DateTime(timezone=True))
    status                  = Column(String(30), default="pending")  # pending, submitted, graded, late, missed
    grade                   = Column(Numeric(8, 2))
    feedback                = Column(Text)
    attempt_count           = Column(Integer, default=0)
    graded_at               = Column(DateTime(timezone=True))
    graded_by_staff_id      = Column(String(20), ForeignKey("academic_staff.staff_id"), nullable=True)
    created_at              = Column(DateTime(timezone=True), server_default=func.now())

    student              = relationship("Student", backref="submissions")
    classwork_assignment = relationship("ClassworkAssignment", back_populates="submissions")
    graded_by            = relationship("AcademicStaff", backref="graded_submissions")
    attachments          = relationship("SubmissionAttachment", back_populates="submission", cascade="all, delete-orphan")
