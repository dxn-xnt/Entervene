"""make subject_load staff_id nullable

Revision ID: 20260729_make_subject_load_staff_id_nullable
Revises: 20260729_add_ctu_master_schedule_fields
Create Date: 2026-07-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260729_make_subject_load_staff_id_nullable"
down_revision = "20260729_add_ctu_master_schedule_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "subject_load",
        "staff_id",
        existing_type=sa.String(length=20),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "subject_load",
        "staff_id",
        existing_type=sa.String(length=20),
        nullable=False,
    )
