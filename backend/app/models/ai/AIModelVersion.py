from enum import Enum

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Index, Integer, JSON, Numeric, String, text
from sqlalchemy.sql import func
from app.db.Base import Base


class ModelPurpose(str, Enum):
    NEXT_PERIOD_BASELINE_FORECAST = "NEXT_PERIOD_BASELINE_FORECAST"
    CURRENT_PERIOD_FINAL_GRADE_PROJECTION = "CURRENT_PERIOD_FINAL_GRADE_PROJECTION"
    UNIFIED_CURRENT_TERM_PROJECTION = "UNIFIED_CURRENT_TERM_PROJECTION"
    CURRENT_TERM_FINAL_GRADE_PROJECTION = "CURRENT_TERM_FINAL_GRADE_PROJECTION"


def _legacy_purpose_default(context):
    return {
        "entervene_next_period_grade_rf": ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        "entervene_current_period_grade_rf_v1": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
    }.get(context.get_current_parameters()["model_name"])


class AIModelVersion(Base):
    __tablename__ = "ai_model_version"
    __table_args__ = (
        CheckConstraint("model_type IN ('REGRESSOR', 'CLASSIFIER', 'ANOMALY')", name="ck_ai_model_version_model_type"),
        CheckConstraint(
            "model_purpose IN ('NEXT_PERIOD_BASELINE_FORECAST', 'CURRENT_PERIOD_FINAL_GRADE_PROJECTION', 'UNIFIED_CURRENT_TERM_PROJECTION', 'CURRENT_TERM_FINAL_GRADE_PROJECTION')",
            name="ck_ai_model_version_model_purpose",
        ),
        CheckConstraint(
            "lifecycle_status IN ('DEVELOPMENT', 'CANDIDATE', 'PRODUCTION', 'ARCHIVED')",
            name="ck_ai_model_version_lifecycle_status",
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
    model_purpose = Column(String(64), nullable=False, default=_legacy_purpose_default)
    algorithm = Column(String(150), nullable=False)
    target_column = Column(String(150), nullable=True)
    lifecycle_status = Column(String(20), nullable=False, server_default="DEVELOPMENT")
    production_validated = Column(Boolean, nullable=False, server_default=text("false"))
    independent_three_term_validation = Column(Boolean, nullable=False, server_default=text("false"))
    registry_metadata_json = Column(JSON, nullable=True)
    trained_at = Column(DateTime(timezone=True), server_default=func.now())
    training_row_count = Column(Integer, nullable=True)
    test_row_count = Column(Integer, nullable=True)
    mae = Column(Numeric(10, 4), nullable=True)
    rmse = Column(Numeric(10, 4), nullable=True)
    r2_score = Column(Numeric(10, 4), nullable=True)
    feature_schema_json = Column(JSON, nullable=True)
    artifact_path = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=False, nullable=False)
