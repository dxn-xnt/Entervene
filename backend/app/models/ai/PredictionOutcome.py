from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class PredictionOutcome(Base):
    __tablename__ = "prediction_outcome"
    __table_args__ = (
        Index("ix_prediction_outcome_prediction_id", "prediction_id"),
    )

    outcome_id = Column(Integer, primary_key=True, autoincrement=True)
    prediction_id = Column(Integer, ForeignKey("ai_prediction.prediction_id", ondelete="CASCADE"), nullable=False)
    actual_period_grade = Column(Numeric(6, 2), nullable=True)
    actual_risk_status = Column(String(30), nullable=True)
    prediction_error = Column(Numeric(8, 2), nullable=True)
    absolute_error = Column(Numeric(8, 2), nullable=True)
    actual_passed = Column(Boolean, nullable=True)
    actual_risk_label = Column(String(30), nullable=True)
    outcome_status = Column(String(30), nullable=True)
    evaluated_at = Column(DateTime(timezone=True), nullable=True)
    intervention_given = Column(Boolean, nullable=True)
    intervention_result = Column(Text, nullable=True)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())

    prediction = relationship("AIPrediction", backref="outcomes")
