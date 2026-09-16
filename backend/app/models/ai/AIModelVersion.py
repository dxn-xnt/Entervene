from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Index, Integer, JSON, Numeric, String, text
from sqlalchemy.sql import func
from app.db.Base import Base


class AIModelVersion(Base):
    __tablename__ = "ai_model_version"
    __table_args__ = (
        CheckConstraint("model_type IN ('REGRESSOR', 'CLASSIFIER', 'ANOMALY')", name="ck_ai_model_version_model_type"),
        Index("ix_ai_model_version_model_name_type", "model_name", "model_type"),
        Index(
            "uq_ai_model_version_active_model",
            "model_name",
            "model_type",
            unique=True,
            postgresql_where=text("is_active = true"),
            sqlite_where=text("is_active = 1"),
        ),
    )

    model_version_id = Column(Integer, primary_key=True, autoincrement=True)
    model_name = Column(String(150), nullable=False)
    model_type = Column(String(30), nullable=False)
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
