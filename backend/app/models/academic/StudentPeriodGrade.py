from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class StudentPeriodGrade(Base):
    __tablename__ = "student_period_grade"
    __table_args__ = (
        UniqueConstraint(
            "student_id",
            "class_id",
            "subject_id",
            "academic_period_id",
            name="uq_student_period_grade_scope",
        ),
        Index("ix_student_period_grade_student_id", "student_id"),
        Index("ix_student_period_grade_class_id", "class_id"),
        Index("ix_student_period_grade_subject_id", "subject_id"),
        Index("ix_student_period_grade_academic_period_id", "academic_period_id"),
    )

    period_grade_id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    class_id = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    academic_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    written_work_percent = Column(Numeric(6, 2), nullable=True)
    performance_task_percent = Column(Numeric(6, 2), nullable=True)
    periodical_assessment_percent = Column(Numeric(6, 2), nullable=True)
    initial_grade = Column(Numeric(6, 2), nullable=True)
    transmuted_grade = Column(Numeric(6, 2), nullable=True)
    final_period_grade = Column(Numeric(6, 2), nullable=True)
    is_finalized = Column(Boolean, default=False, nullable=False)
    finalized_at = Column(DateTime(timezone=True), nullable=True)
    finalized_by_staff_id = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    remarks = Column(Text, nullable=True)
    source_file_name = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("Student", backref="period_grades")
    class_ = relationship("Class", backref="period_grades")
    subject = relationship("Subject", backref="period_grades")
    academic_period = relationship("AcademicPeriod", backref="student_period_grades")
    finalized_by = relationship("AcademicStaff", backref="finalized_period_grades")
