from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class AIPrediction(Base):
    __tablename__ = "ai_prediction"
    __table_args__ = (
        CheckConstraint(
            "risk_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA')",
            name="ck_ai_prediction_risk_level",
        ),
        CheckConstraint(
            "data_status IN ('SUFFICIENT', 'INSUFFICIENT_DATA', 'COLD_START')",
            name="ck_ai_prediction_data_status",
        ),
        Index("ix_ai_prediction_student_id", "student_id"),
        Index("ix_ai_prediction_class_id", "class_id"),
        Index("ix_ai_prediction_subject_id", "subject_id"),
        Index("ix_ai_prediction_source_period_id", "source_period_id"),
        Index("ix_ai_prediction_target_period_id", "target_period_id"),
        Index("ix_ai_prediction_model_version_id", "model_version_id"),
    )

    prediction_id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    class_id = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    source_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    target_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    predicted_period_grade = Column(Numeric(6, 2), nullable=True)
    risk_score = Column(Numeric(8, 4), nullable=True)
    risk_level = Column(String(30), nullable=False)
    data_status = Column(String(30), nullable=False)
    model_version_id = Column(Integer, ForeignKey("ai_model_version.model_version_id", ondelete="RESTRICT"), nullable=True)
    generated_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("Student", backref="ai_predictions")
    class_ = relationship("Class", backref="ai_predictions")
    subject = relationship("Subject", backref="ai_predictions")
    source_period = relationship("AcademicPeriod", foreign_keys=[source_period_id], backref="source_predictions")
    target_period = relationship("AcademicPeriod", foreign_keys=[target_period_id], backref="target_predictions")
    model_version = relationship("AIModelVersion", backref="predictions")
