from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class TeacherRiskReview(Base):
    __tablename__ = "teacher_risk_review"
    __table_args__ = (
        CheckConstraint(
            "review_decision IN ('CONFIRMED_RISK', 'DISMISSED_RISK', 'NEEDS_MORE_DATA', 'INTERVENTION_ASSIGNED', 'ESCALATED')",
            name="ck_teacher_risk_review_decision",
        ),
        Index("ix_teacher_risk_review_prediction_id", "prediction_id"),
        Index("ix_teacher_risk_review_student_id", "student_id"),
        Index("ix_teacher_risk_review_reviewed_by_staff_id", "reviewed_by_staff_id"),
    )

    review_id = Column(Integer, primary_key=True, autoincrement=True)
    prediction_id = Column(Integer, ForeignKey("ai_prediction.prediction_id", ondelete="CASCADE"), nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    reviewed_by_staff_id = Column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    review_decision = Column(String(30), nullable=False)
    teacher_notes = Column(Text, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), server_default=func.now())

    prediction = relationship("AIPrediction", backref="teacher_reviews")
    student = relationship("Student", backref="teacher_risk_reviews")
    reviewed_by = relationship("AcademicStaff", backref="risk_reviews")
