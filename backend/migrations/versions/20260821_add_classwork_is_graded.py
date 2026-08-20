"""add is_graded to classwork

Revision ID: 20260821_add_classwork_is_graded
Revises: e0119a67e334
Create Date: 2026-08-21 00:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260821_add_classwork_is_graded'
down_revision: Union[str, Sequence[str], None] = 'e0119a67e334'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cw_cols = [c['name'] for c in inspector.get_columns('classwork')]
    if 'is_graded' not in cw_cols:
        op.add_column(
            'classwork',
            sa.Column('is_graded', sa.Boolean(), server_default='true', nullable=False),
        )
    # Ensure all existing READING classworks are set to is_graded = FALSE
    op.execute("UPDATE classwork SET is_graded = FALSE WHERE UPPER(classwork_type) = 'READING'")


def downgrade() -> None:
    """Downgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cw_cols = [c['name'] for c in inspector.get_columns('classwork')]
    if 'is_graded' in cw_cols:
        op.drop_column('classwork', 'is_graded')
