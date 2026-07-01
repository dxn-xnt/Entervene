"""add subject offering table

Revision ID: 20260702_subject_offering
Revises: 20260702_subject_catalog_fields
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260702_subject_offering"
down_revision = "20260702_subject_catalog_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subject_offering",
        sa.Column("subject_offering_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False),
        sa.Column("academic_year_id", sa.Integer(), sa.ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False),
        sa.Column("academic_level_id", sa.Integer(), sa.ForeignKey("academic_level.academic_level_id"), nullable=False),
        sa.Column("academic_period_id", sa.Integer(), sa.ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False),
        sa.Column("pathway", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "pathway IN ('stem_medical', 'stem_engineering', 'both')",
            name="ck_subject_offering_pathway",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'archived')",
            name="ck_subject_offering_status",
        ),
        sa.UniqueConstraint(
            "subject_id",
            "academic_year_id",
            "academic_level_id",
            "academic_period_id",
            "pathway",
            name="uq_subject_offering_scope_pathway",
        ),
    )
    op.alter_column("subject_offering", "status", server_default=None)
    op.create_index("ix_subject_offering_subject_id", "subject_offering", ["subject_id"])
    op.create_index("ix_subject_offering_academic_year_id", "subject_offering", ["academic_year_id"])
    op.create_index("ix_subject_offering_academic_level_id", "subject_offering", ["academic_level_id"])
    op.create_index("ix_subject_offering_academic_period_id", "subject_offering", ["academic_period_id"])
    op.create_index("ix_subject_offering_pathway", "subject_offering", ["pathway"])
    op.create_index("ix_subject_offering_status", "subject_offering", ["status"])


def downgrade() -> None:
    op.drop_index("ix_subject_offering_status", table_name="subject_offering")
    op.drop_index("ix_subject_offering_pathway", table_name="subject_offering")
    op.drop_index("ix_subject_offering_academic_period_id", table_name="subject_offering")
    op.drop_index("ix_subject_offering_academic_level_id", table_name="subject_offering")
    op.drop_index("ix_subject_offering_academic_year_id", table_name="subject_offering")
    op.drop_index("ix_subject_offering_subject_id", table_name="subject_offering")
    op.drop_table("subject_offering")
