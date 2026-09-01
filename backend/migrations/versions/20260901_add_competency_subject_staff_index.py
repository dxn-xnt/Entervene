"""add composite index on competency subject_id and created_by_staff_id

Revision ID: 20260901_comp_subject_staff_idx
Revises: 20260901_student_prior_gwa
Create Date: 2026-09-01
"""

from typing import Sequence, Union
from alembic import op


revision: str = "20260901_comp_subject_staff_idx"
down_revision: Union[str, Sequence[str], None] = "20260901_student_prior_gwa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_competency_subject_staff ON competency (subject_id, created_by_staff_id);"
    )


def downgrade() -> None:
    op.execute(
        "DROP INDEX IF EXISTS ix_competency_subject_staff;"
    )
