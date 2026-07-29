"""add paired_class_id and period_template_group to class, and create period_template table

Revision ID: 20260729_add_ctu_master_schedule_fields
Revises: 20260728_add_activity_mode
Create Date: 2026-07-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260729_add_ctu_master_schedule_fields"
down_revision = "20260728_add_activity_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add CTU columns to class table
    op.add_column(
        "class",
        sa.Column("paired_class_id", sa.Integer(), sa.ForeignKey("class.class_id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column(
        "class",
        sa.Column("period_template_group", sa.String(length=50), nullable=False, server_default="JHS_45MIN"),
    )

    # Create period_template table
    op.create_table(
        "period_template",
        sa.Column("template_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("template_group", sa.String(length=50), nullable=False),
        sa.Column("period_number", sa.Integer(), nullable=False),
        sa.Column("period_label", sa.String(length=50), nullable=False),
        sa.Column("start_time", sa.String(length=5), nullable=False),
        sa.Column("end_time", sa.String(length=5), nullable=False),
        sa.Column("duration_mins", sa.Integer(), nullable=False),
        sa.Column("is_break", sa.Boolean(), server_default="false"),
    )


def downgrade() -> None:
    op.drop_table("period_template")
    op.drop_column("class", "period_template_group")
    op.drop_column("class", "paired_class_id")
