"""add show_scores to classwork

Revision ID: d31025bd1360
Revises: 27ae3176cae2
Create Date: 2026-08-02 14:24:15.925335

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd31025bd1360'
down_revision: Union[str, Sequence[str], None] = '27ae3176cae2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cw_cols = [c['name'] for c in inspector.get_columns('classwork')]
    if 'show_scores' not in cw_cols:
        op.add_column('classwork', sa.Column('show_scores', sa.Boolean(), server_default='true', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('classwork', 'show_scores')
    # ### end Alembic commands ###
