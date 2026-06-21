from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class AIPredictionFeature(Base):
    __tablename__ = "ai_prediction_feature"
    __table_args__ = (
        CheckConstraint(
            "direction IN ('INCREASES_RISK', 'DECREASES_RISK', 'NEUTRAL')",
            name="ck_ai_prediction_feature_direction",
        ),
        CheckConstraint(
            "explanation_method IN ('RULE', 'PERMUTATION', 'SHAP', 'OTHER')",
            name="ck_ai_prediction_feature_explanation_method",
        ),
        Index("ix_ai_prediction_feature_prediction_id", "prediction_id"),
    )

    feature_id = Column(Integer, primary_key=True, autoincrement=True)
    prediction_id = Column(Integer, ForeignKey("ai_prediction.prediction_id", ondelete="CASCADE"), nullable=False)
    feature_name = Column(String(150), nullable=False)
    feature_value = Column(Numeric(12, 4), nullable=True)
    feature_contribution = Column(Numeric(12, 6), nullable=True)
    direction = Column(String(30), nullable=False)
    feature_rank = Column(Integer, nullable=True)
    explanation_method = Column(String(30), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    prediction = relationship("AIPrediction", backref="features")
