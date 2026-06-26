"""add nullable student dob

Revision ID: 20260625_student_dob
Revises: 20260624_quiz_mvp_models
Create Date: 2026-06-25
"""

from alembic import op
import sqlalchemy as sa


revision = "20260625_student_dob"
down_revision = "20260624_quiz_mvp_models"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student", sa.Column("dob", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("student", "dob")
