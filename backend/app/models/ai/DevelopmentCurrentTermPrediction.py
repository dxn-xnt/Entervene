from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.Base import Base


class DevelopmentCurrentTermPrediction(Base):
    __tablename__ = "development_current_term_prediction"
    __table_args__ = (
        CheckConstraint("source_period_id = target_period_id", name="ck_development_current_term_same_period"),
        CheckConstraint("revision > 0", name="ck_development_current_term_revision_positive"),
        CheckConstraint("risk_score IS NULL", name="ck_development_current_term_no_risk_score"),
        CheckConstraint(
            "intervention_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK')",
            name="ck_development_current_term_intervention_level",
        ),
        UniqueConstraint(
            "student_id", "class_id", "subject_id", "source_period_id", "target_period_id",
            "model_version_id", "revision", name="uq_development_current_term_scope_revision",
        ),
        Index("ix_development_current_term_model_version_id", "model_version_id"),
    )

    prediction_id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    class_id = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    source_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    target_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    model_version_id = Column(Integer, ForeignKey("ai_model_version.model_version_id", ondelete="RESTRICT"), nullable=False)
    revision = Column(Integer, nullable=False)
    predicted_period_grade = Column(Numeric(6, 2), nullable=False)
    intervention_level = Column(String(30), nullable=False)
    intervention_basis = Column(String(80), nullable=False)
    risk_score = Column(Numeric(8, 4), nullable=True)
    evidence_snapshot = Column(JSON, nullable=False)
    generated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
