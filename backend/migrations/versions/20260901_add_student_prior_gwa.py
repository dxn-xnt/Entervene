"""add nullable student prior_gwa

Revision ID: 20260901_student_prior_gwa
Revises: 20260830_grade_submission_log
Create Date: 2026-09-01
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20260901_student_prior_gwa"
down_revision: Union[str, Sequence[str], None] = "20260830_grade_submission_log"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("student", sa.Column("prior_gwa", sa.Numeric(precision=5, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column("student", "prior_gwa")
