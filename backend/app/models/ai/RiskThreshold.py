from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, Numeric, String
from sqlalchemy.sql import func
from app.db.Base import Base


class RiskThreshold(Base):
    __tablename__ = "risk_threshold"
    __table_args__ = (
        CheckConstraint(
            "risk_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA')",
            name="ck_risk_threshold_risk_level",
        ),
    )

    threshold_id = Column(Integer, primary_key=True, autoincrement=True)
    threshold_name = Column(String(150), nullable=False)
    condition_type = Column(String(100), nullable=False)
    condition_value = Column(Numeric(10, 4), nullable=False)
    risk_level = Column(String(30), nullable=False)
    effective_from = Column(DateTime(timezone=True), nullable=False)
    effective_to = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
