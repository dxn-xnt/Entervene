"""Add current-term registry metadata and separate intervention fields.

Revision ID: 20260922_current_term_contract
Revises: 20260920_activity_rubrics
"""

from alembic import op
import sqlalchemy as sa


revision = "20260922_current_term_contract"
down_revision = "20260920_activity_rubrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_model_version", sa.Column("target_column", sa.String(150), nullable=True))
    op.add_column("ai_model_version", sa.Column("lifecycle_status", sa.String(20), nullable=False, server_default="DEVELOPMENT"))
    op.add_column("ai_model_version", sa.Column("production_validated", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("ai_model_version", sa.Column("independent_three_term_validation", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("ai_model_version", sa.Column("registry_metadata_json", sa.JSON(), nullable=True))
    op.execute("UPDATE ai_model_version SET lifecycle_status = 'CANDIDATE'")
    op.execute("UPDATE ai_model_version SET target_column = feature_schema_json->>'target_column' WHERE feature_schema_json IS NOT NULL")
    op.create_check_constraint(
        "ck_ai_model_version_lifecycle_status",
        "ai_model_version",
        "lifecycle_status IN ('DEVELOPMENT', 'CANDIDATE', 'PRODUCTION', 'ARCHIVED')",
    )
    op.drop_constraint("ck_ai_model_version_model_purpose", "ai_model_version", type_="check")
    op.create_check_constraint(
        "ck_ai_model_version_model_purpose",
        "ai_model_version",
        "model_purpose IN ('NEXT_PERIOD_BASELINE_FORECAST', 'CURRENT_PERIOD_FINAL_GRADE_PROJECTION', 'UNIFIED_CURRENT_TERM_PROJECTION', 'CURRENT_TERM_FINAL_GRADE_PROJECTION')",
    )
    op.add_column("ai_prediction", sa.Column("intervention_level", sa.String(30), nullable=True))
    op.add_column("ai_prediction", sa.Column("intervention_basis", sa.String(80), nullable=True))
    op.create_check_constraint(
        "ck_ai_prediction_intervention_level",
        "ai_prediction",
        "intervention_level IS NULL OR intervention_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK')",
    )


def downgrade() -> None:
    conn = op.get_bind()
    current_term_count = conn.execute(sa.text(
        "SELECT count(*) FROM ai_model_version WHERE model_purpose = 'CURRENT_TERM_FINAL_GRADE_PROJECTION'"
    )).scalar()
    if current_term_count:
        raise RuntimeError("Cannot downgrade while current-term model-version rows exist.")
    op.drop_constraint("ck_ai_prediction_intervention_level", "ai_prediction", type_="check")
    op.drop_column("ai_prediction", "intervention_basis")
    op.drop_column("ai_prediction", "intervention_level")
    op.drop_constraint("ck_ai_model_version_model_purpose", "ai_model_version", type_="check")
    op.create_check_constraint(
        "ck_ai_model_version_model_purpose",
        "ai_model_version",
        "model_purpose IN ('NEXT_PERIOD_BASELINE_FORECAST', 'CURRENT_PERIOD_FINAL_GRADE_PROJECTION', 'UNIFIED_CURRENT_TERM_PROJECTION')",
    )
    op.drop_constraint("ck_ai_model_version_lifecycle_status", "ai_model_version", type_="check")
    op.drop_column("ai_model_version", "registry_metadata_json")
    op.drop_column("ai_model_version", "independent_three_term_validation")
    op.drop_column("ai_model_version", "production_validated")
    op.drop_column("ai_model_version", "lifecycle_status")
    op.drop_column("ai_model_version", "target_column")
