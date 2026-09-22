"""Isolated append-only storage for development current-term predictions.

Revision ID: 20260922_development_prediction
Revises: 20260922_current_term_contract
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260922_development_prediction"
down_revision = "20260922_current_term_contract"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "development_current_term_prediction",
        sa.Column("prediction_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_period_id", sa.Integer(), sa.ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_period_id", sa.Integer(), sa.ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False),
        sa.Column("model_version_id", sa.Integer(), sa.ForeignKey("ai_model_version.model_version_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("predicted_period_grade", sa.Numeric(6, 2), nullable=False),
        sa.Column("intervention_level", sa.String(30), nullable=False),
        sa.Column("intervention_basis", sa.String(80), nullable=False),
        sa.Column("risk_score", sa.Numeric(8, 4), nullable=True),
        sa.Column("evidence_snapshot", sa.JSON(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("source_period_id = target_period_id", name="ck_development_current_term_same_period"),
        sa.CheckConstraint("revision > 0", name="ck_development_current_term_revision_positive"),
        sa.CheckConstraint("risk_score IS NULL", name="ck_development_current_term_no_risk_score"),
        sa.CheckConstraint(
            "intervention_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK')",
            name="ck_development_current_term_intervention_level",
        ),
        sa.UniqueConstraint(
            "student_id", "class_id", "subject_id", "source_period_id", "target_period_id",
            "model_version_id", "revision", name="uq_development_current_term_scope_revision",
        ),
    )
    op.create_index(
        "ix_development_current_term_model_version_id",
        "development_current_term_prediction", ["model_version_id"],
    )


def downgrade() -> None:
    conn = op.get_bind()
    count = conn.execute(sa.text("SELECT count(*) FROM development_current_term_prediction")).scalar()
    if count:
        raise RuntimeError("Cannot downgrade while development prediction history exists.")
    op.drop_index("ix_development_current_term_model_version_id", table_name="development_current_term_prediction")
    op.drop_table("development_current_term_prediction")
