from enum import Enum
from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Index, Integer, JSON, Numeric, String, text
from sqlalchemy.sql import func
from app.db.Base import Base


class ModelPurpose(str, Enum):
    NEXT_PERIOD_BASELINE_FORECAST = "NEXT_PERIOD_BASELINE_FORECAST"
    CURRENT_PERIOD_FINAL_GRADE_PROJECTION = "CURRENT_PERIOD_FINAL_GRADE_PROJECTION"
    UNIFIED_CURRENT_TERM_PROJECTION = "UNIFIED_CURRENT_TERM_PROJECTION"


class AIModelVersion(Base):
    """Registry table for trained machine learning model artifacts.

    Semantics of is_active:
    is_active = True denotes the single approved, validated active artifact for that
    specific model_purpose (enforced by partial unique index uq_ai_model_version_active_purpose).
    It does NOT mean automatic connection to live teacher/student production traffic.
    Live prediction routing remains explicitly decoupled and driven by caller purpose requirements.
    """
    __tablename__ = "ai_model_version"
    __table_args__ = (
        CheckConstraint("model_type IN ('REGRESSOR', 'CLASSIFIER', 'ANOMALY')", name="ck_ai_model_version_model_type"),
        CheckConstraint(
            (
                f"model_purpose IN ("
                f"'{ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value}', "
                f"'{ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value}', "
                f"'{ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value}'"
                f")"
            ),
            name="ck_ai_model_version_model_purpose",
        ),
        Index("ix_ai_model_version_model_name_type", "model_name", "model_type"),
        Index(
            "uq_ai_model_version_active_purpose",
            "model_purpose",
            unique=True,
            postgresql_where=text("is_active = true"),
            sqlite_where=text("is_active = 1"),
        ),
    )

    model_version_id = Column(Integer, primary_key=True, autoincrement=True)
    model_name = Column(String(150), nullable=False)
    model_type = Column(String(30), nullable=False)
    model_purpose = Column(String(64), nullable=False, default=ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value)
    algorithm = Column(String(150), nullable=False)
    trained_at = Column(DateTime(timezone=True), server_default=func.now())
    training_row_count = Column(Integer, nullable=True)
    test_row_count = Column(Integer, nullable=True)
    mae = Column(Numeric(10, 4), nullable=True)
    rmse = Column(Numeric(10, 4), nullable=True)
    r2_score = Column(Numeric(10, 4), nullable=True)
    feature_schema_json = Column(JSON, nullable=True)
    artifact_path = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=False, nullable=False)
