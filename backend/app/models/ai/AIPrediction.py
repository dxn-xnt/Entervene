from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


RISK_ASSESSMENT_EVALUATED = "EVALUATED"
RISK_ASSESSMENT_NOT_EVALUATED_CURRENT = "NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL"
RISK_ASSESSMENT_INSUFFICIENT_EVIDENCE = "INSUFFICIENT_RISK_EVIDENCE"


class AIPrediction(Base):
    __tablename__ = "ai_prediction"
    __table_args__ = (
        CheckConstraint("revision > 0", name="ck_ai_prediction_revision_positive"),
        Index("uq_prediction_scope_revision", "student_id", "class_id", "subject_id", "source_period_id", "target_period_id", "model_version_id", "revision", unique=True),
        Index("uq_prediction_legacy_scope_revision", "student_id", "class_id", "subject_id", "source_period_id", "target_period_id", "revision", unique=True,
              postgresql_where=text("model_version_id IS NULL"), sqlite_where=text("model_version_id IS NULL")),
        CheckConstraint(
            "risk_level IS NULL OR risk_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA')",
            name="ck_ai_prediction_risk_level",
        ),
        CheckConstraint(
            "data_status IS NULL OR data_status IN ('SUFFICIENT', 'INSUFFICIENT_DATA', 'COLD_START')",
            name="ck_ai_prediction_data_status",
        ),
        CheckConstraint(
            "risk_assessment_status IN ('EVALUATED', 'NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL', 'INSUFFICIENT_RISK_EVIDENCE')",
            name="ck_ai_prediction_risk_assessment_status",
        ),
        Index("ix_ai_prediction_student_id", "student_id"),
        Index("ix_ai_prediction_class_id", "class_id"),
        Index("ix_ai_prediction_subject_id", "subject_id"),
        Index("ix_ai_prediction_source_period_id", "source_period_id"),
        Index("ix_ai_prediction_target_period_id", "target_period_id"),
        Index("ix_ai_prediction_model_version_id", "model_version_id"),
    )

    prediction_id = Column(Integer, primary_key=True, autoincrement=True)
    revision = Column(Integer, nullable=False, default=1, server_default="1")
    student_id = Column(UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False)
    class_id = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    source_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    target_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    predicted_period_grade = Column(Numeric(6, 2), nullable=True)
    risk_score = Column(Numeric(8, 4), nullable=True)
    risk_level = Column(String(30), nullable=True)
    data_status = Column(String(30), nullable=True)
    risk_assessment_status = Column(
        String(60),
        nullable=False,
        default=RISK_ASSESSMENT_EVALUATED,
        server_default=RISK_ASSESSMENT_EVALUATED,
    )
    model_version_id = Column(Integer, ForeignKey("ai_model_version.model_version_id", ondelete="RESTRICT"), nullable=True)
    # Null is retained for legacy predictions. New audited generation will save
    # a versioned evidence payload in a later Phase-1 service change.
    evidence_snapshot = Column(JSON, nullable=True)
    generation_request_id = Column(String(100), nullable=True, unique=True)
    generated_at = Column(DateTime(timezone=True), server_default=func.now())

    student = relationship("Student", backref="ai_predictions")
    class_ = relationship("Class", backref="ai_predictions")
    subject = relationship("Subject", backref="ai_predictions")
    source_period = relationship("AcademicPeriod", foreign_keys=[source_period_id], backref="source_predictions")
    target_period = relationship("AcademicPeriod", foreign_keys=[target_period_id], backref="target_predictions")
    model_version = relationship("AIModelVersion", backref="predictions")
