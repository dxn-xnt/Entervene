"""add allow late submissions to classwork assignments

Revision ID: 20260701_allow_late_submissions
Revises: 20260701_merge_quiz_active_term
Create Date: 2026-07-01
"""

from alembic import op
import sqlalchemy as sa


revision = "20260701_allow_late_submissions"
down_revision = "20260701_merge_quiz_active_term"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "classwork_assignment",
        sa.Column("allow_late_submissions", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("classwork_assignment", "allow_late_submissions", server_default=None)


def downgrade() -> None:
    op.drop_column("classwork_assignment", "allow_late_submissions")
