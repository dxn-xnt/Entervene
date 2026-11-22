"""merge heads

Revision ID: cfa32ed6db83
Revises: 20261121_merge_quiz_and_scope, 20261122_add_homeroom_attendance_unique_index
Create Date: 2026-11-22 09:18:05.107004

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cfa32ed6db83'
down_revision: Union[str, Sequence[str], None] = ('20261121_merge_quiz_and_scope', '20261122_add_homeroom_attendance_unique_index')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
