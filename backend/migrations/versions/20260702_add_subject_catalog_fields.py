"""add subject catalog fields

Revision ID: 20260702_subject_catalog_fields
Revises: 20260701_allow_late_submissions
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260702_subject_catalog_fields"
down_revision = "20260701_allow_late_submissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("subject", sa.Column("subject_group", sa.String(length=50), nullable=True))
    op.add_column("subject", sa.Column("hours", sa.Integer(), nullable=True))
    op.add_column("subject", sa.Column("default_grading_template", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("subject", "default_grading_template")
    op.drop_column("subject", "hours")
    op.drop_column("subject", "subject_group")
