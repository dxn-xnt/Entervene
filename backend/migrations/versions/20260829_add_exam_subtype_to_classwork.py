"""add exam_subtype to classwork

Revision ID: 20260829_exam_subtype
Revises: 20260827_add_batch_id_to_teacher_substitution
Create Date: 2026-08-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260829_exam_subtype"
down_revision = "20260827_add_batch_id_to_teacher_substitution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("classwork", sa.Column("exam_subtype", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("classwork", "exam_subtype")
