"""Add confirmed year-specific general-average policy and passing-policy audit.

Revision ID: 20261022_passing_policy_audit
Revises: 20261020_content_cloning_domain
"""

from alembic import op
import sqlalchemy as sa


revision = "20261022_passing_policy_audit"
down_revision = "20261020_content_cloning_domain"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Deliberately empty of rows: administrators must confirm initialization.
    op.create_table(
        "academic_year_passing_policy",
        sa.Column("academic_year_id", sa.Integer(), nullable=False),
        sa.Column("general_average_threshold", sa.Numeric(5, 2), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("general_average_threshold >= 0 AND general_average_threshold <= 100", name="ck_academic_year_passing_policy_range"),
        sa.CheckConstraint("version > 0", name="ck_academic_year_passing_policy_version"),
        sa.ForeignKeyConstraint(["academic_year_id"], ["academic_year.academic_year_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by"], ["user_account.user_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("academic_year_id"),
    )
    op.create_table(
        "passing_policy_audit",
        sa.Column("audit_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("policy_scope", sa.String(length=24), nullable=False),
        sa.Column("academic_year_id", sa.Integer(), nullable=False),
        sa.Column("grading_template_id", sa.Integer(), nullable=True),
        sa.Column("source_academic_year_id", sa.Integer(), nullable=True),
        sa.Column("source_version", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("old_threshold", sa.Numeric(5, 2), nullable=True),
        sa.Column("new_threshold", sa.Numeric(5, 2), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("policy_scope IN ('template', 'general_average')", name="ck_passing_policy_audit_scope"),
        sa.CheckConstraint("old_threshold IS NULL OR (old_threshold >= 0 AND old_threshold <= 100)", name="ck_passing_policy_audit_old_range"),
        sa.CheckConstraint("new_threshold >= 0 AND new_threshold <= 100", name="ck_passing_policy_audit_new_range"),
        sa.CheckConstraint("(policy_scope = 'template' AND grading_template_id IS NOT NULL) OR (policy_scope = 'general_average' AND grading_template_id IS NULL)", name="ck_passing_policy_audit_target"),
        sa.ForeignKeyConstraint(["academic_year_id"], ["academic_year.academic_year_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["grading_template_id"], ["grading_template.grading_template_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_academic_year_id"], ["academic_year.academic_year_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user_account.user_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("audit_id"),
        sa.UniqueConstraint("policy_scope", "academic_year_id", "grading_template_id", "revision", name="uq_passing_policy_audit_revision"),
    )
    op.create_index("ix_passing_policy_audit_year_scope", "passing_policy_audit", ["academic_year_id", "policy_scope"])


def downgrade() -> None:
    op.drop_index("ix_passing_policy_audit_year_scope", table_name="passing_policy_audit")
    op.drop_table("passing_policy_audit")
    op.drop_table("academic_year_passing_policy")
