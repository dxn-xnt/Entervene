"""add reading_focused_seconds to student_submission

Revision ID: 20260821_add_reading_focused_seconds
Revises: 20260821_add_classwork_is_graded
Create Date: 2026-08-21 01:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260821_add_reading_focused_seconds'
down_revision: Union[str, Sequence[str], None] = '20260821_add_classwork_is_graded'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sub_cols = [c['name'] for c in inspector.get_columns('student_submission')]
    if 'reading_focused_seconds' not in sub_cols:
        op.add_column(
            'student_submission',
            sa.Column('reading_focused_seconds', sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    sub_cols = [c['name'] for c in inspector.get_columns('student_submission')]
    if 'reading_focused_seconds' in sub_cols:
        op.drop_column('student_submission', 'reading_focused_seconds')
