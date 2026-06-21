from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class StudentAssessmentScore(Base):
    __tablename__ = "student_assessment_score"
    __table_args__ = (
        CheckConstraint(
            "score_status IN ('RECORDED', 'MISSING_NOT_ENCODED', 'ABSENT', 'NOT_APPLICABLE')",
            name="ck_student_assessment_score_status",
        ),
        UniqueConstraint("assessment_id", "student_id", name="uq_student_assessment_score_assessment_student"),
        Index("ix_student_assessment_score_assessment_id", "assessment_id"),
        Index("ix_student_assessment_score_student_id", "student_id"),
    )

    score_id = Column(Integer, primary_key=True, autoincrement=True)
    assessment_id = Column(Integer, ForeignKey("assessment_item.assessment_id", ondelete="CASCADE"), nullable=False)
    student_id = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    raw_score = Column(Numeric(8, 2), nullable=True)
    score_status = Column(String(30), nullable=False, default="RECORDED")
    encoded_at = Column(DateTime(timezone=True), server_default=func.now())

    assessment = relationship("AssessmentItem", backref="student_scores")
    student = relationship("Student", backref="assessment_scores")
