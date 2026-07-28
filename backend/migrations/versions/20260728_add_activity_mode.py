"""add activity_mode column to classwork table

Revision ID: 20260728_add_activity_mode
Revises: 20260728_add_class_pathway
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa


revision = "20260728_add_activity_mode"
down_revision = "20260728_add_class_pathway"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "classwork",
        sa.Column("activity_mode", sa.String(length=20), nullable=False, server_default="ONLINE"),
    )


def downgrade() -> None:
    op.drop_column("classwork", "activity_mode")
