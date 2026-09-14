"""Durable aliases: multiple idempotency keys can resolve to one execution."""
from sqlalchemy import Column, DateTime, ForeignKey, String, Integer
from sqlalchemy.sql import func
from app.db.Base import Base


class PredictionGenerationRequest(Base):
    __tablename__ = "prediction_generation_request"
    request_id = Column(String(100), primary_key=True)
    request_fingerprint = Column(String(64), nullable=False)
    prediction_id = Column(Integer, ForeignKey("ai_prediction.prediction_id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
